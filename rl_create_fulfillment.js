/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log', 'N/query'], (record, search, log, query) => {

  const post = (body) => {
    const diag = [];
    try {
      const result = createFulfillment(body, diag);
      return { success: true, ...result, diag };
    } catch (e) {
      log.error({ title: 'Fulfillment RESTlet error', details: e.message });
      return { success: false, error: e.message, diag };
    }
  };

  const findSOByRef = (soNumber) => {
    const found = search.create({
      type:    search.Type.SALES_ORDER,
      filters: [['otherrefnum', 'is', soNumber], 'AND', ['mainline', 'is', 'T'], 'AND', ['status', 'anyof', 'SalesOrd:B', 'SalesOrd:D', 'SalesOrd:E', 'SalesOrd:F']],
      columns: [search.createColumn({ name: 'internalid', sort: search.Sort.DESC })],
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? Number(found[0].getValue('internalid')) : null;
  };

  const findExistingFulfillment = (soId) => {
    try {
      const found = search.create({
        type:    search.Type.ITEM_FULFILLMENT,
        filters: [['createdfrom', 'anyof', soId], 'AND', ['mainline', 'is', 'T']],
        columns: ['internalid'],
      }).run().getRange({ start: 0, end: 1 });
      return found.length ? Number(found[0].getValue('internalid')) : null;
    } catch (e) {
      return null;
    }
  };

  // Resolve the location where inventory actually exists for the first item on the SO
  const resolveLocation = (soId, requestedLocationId) => {
    // 1. Try SO header location
    const soHeader = search.create({
      type:    search.Type.SALES_ORDER,
      filters: [['internalid', 'anyof', soId], 'AND', ['mainline', 'is', 'T']],
      columns: ['location'],
    }).run().getRange({ start: 0, end: 1 });
    const soLocation = soHeader.length ? soHeader[0].getValue('location') : null;
    if (soLocation) return soLocation;

    // 2. Find first item on SO and look up its inventory balance location
    const soLines = search.create({
      type:    search.Type.SALES_ORDER,
      filters: [['internalid', 'anyof', soId], 'AND', ['mainline', 'is', 'F'], 'AND', ['taxline', 'is', 'F']],
      columns: ['item'],
    }).run().getRange({ start: 0, end: 1 });
    const firstItemId = soLines.length ? soLines[0].getValue('item') : null;

    if (firstItemId) {
      try {
        const balRows = query.runSuiteQL({
          query: `SELECT location FROM InventoryBalance WHERE item = ${firstItemId} ORDER BY quantityonhand DESC`,
        }).asMappedResults();
        if (balRows.length && balRows[0].location) return String(balRows[0].location);
      } catch (e) { /* fall through */ }
    }

    // 3. Fall back to caller-supplied or env default
    return requestedLocationId || null;
  };

  // Returns { itemId → itemid(sku) } for the given NS item internal IDs
  const getItemSkuMap = (itemIds, diag) => {
    const unique = [...new Set(itemIds.map(String).filter(Boolean))];
    if (!unique.length) return {};
    try {
      const rows = query.runSuiteQL({
        query: `SELECT id, itemid FROM item WHERE id IN (${unique.join(',')})`,
      }).asMappedResults();
      const map = {};
      for (const r of rows) map[String(r.id)] = r.itemid || String(r.id);
      diag.push(`itemSkuMap: ${JSON.stringify(map)}`);
      return map;
    } catch (e) {
      diag.push(`getItemSkuMap error: ${e.message}`);
      return {};
    }
  };

  const createFulfillment = (data, diag = []) => {
    const soNumber = data.soNumber;
    log.audit({ title: 'Fulfillment Request', details: `soNumber=${soNumber}, skus=${JSON.stringify(data.skus || [])}` });

    const soId = data.soId ? Number(data.soId) : findSOByRef(soNumber);
    if (!soId) throw new Error(`SO not found or not approved: ${soNumber}`);

    if (!data.force) {
      const existingId = findExistingFulfillment(soId);
      if (existingId) {
        log.audit({ title: 'Fulfillment Exists', details: `internalId=${existingId}` });
        return { internalId: existingId, soNumber, action: 'exists' };
      }
    }

    const locationId = resolveLocation(soId, data.locationId);
    diag.push(`soId=${soId}, locationId=${locationId}`);

    const fulfillment = record.transform({
      fromType:  record.Type.SALES_ORDER,
      fromId:    soId,
      toType:    record.Type.ITEM_FULFILLMENT,
      isDynamic: true,
    });

    if (locationId) fulfillment.setValue({ fieldId: 'location', value: Number(locationId) });

    const lineCount = fulfillment.getLineCount({ sublistId: 'item' });
    diag.push(`lines=${lineCount}, fulfillmentLoc=${fulfillment.getValue({ fieldId: 'location' })}`);

    // First pass: collect all item internal IDs (read-only)
    const lineItemIds = [];
    for (let i = 0; i < lineCount; i++) {
      fulfillment.selectLine({ sublistId: 'item', line: i });
      lineItemIds.push(String(fulfillment.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' })));
    }

    // Build SKU filter set if caller supplied specific SKUs
    const skuSet = (data.skus && data.skus.length)
      ? new Set(data.skus.map(s => s.toUpperCase()))
      : null;
    const itemSkuMap = skuSet ? getItemSkuMap(lineItemIds, diag) : {};

    // Second pass: set itemreceive per line
    for (let i = 0; i < lineCount; i++) {
      fulfillment.selectLine({ sublistId: 'item', line: i });
      const itemId  = lineItemIds[i];
      const qty     = fulfillment.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' });
      const itemSku = (itemSkuMap[itemId] || '').toUpperCase();
      const shouldFulfill = !skuSet || skuSet.has(itemSku);

      if (locationId) {
        try { fulfillment.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: Number(locationId) }); }
        catch (e) { diag.push(`line[${i}]: set loc error: ${e.message}`); }
      }
      fulfillment.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: shouldFulfill });
      diag.push(`line[${i}]: item=${itemId} sku=${itemSku} qty=${qty} fulfill=${shouldFulfill}`);
      fulfillment.commitLine({ sublistId: 'item' });
    }

    if (data.shipDate) fulfillment.setValue({ fieldId: 'trandate',   value: new Date(data.shipDate) });
    if (data.memo)     fulfillment.setValue({ fieldId: 'memo',       value: data.memo });
    fulfillment.setValue({ fieldId: 'shipstatus', value: 'C' });

    const savedId = fulfillment.save({ ignoreMandatoryFields: true, enableSourcing: false });
    log.audit({ title: 'Fulfillment Created', details: `internalId=${savedId}, soNumber=${soNumber}` });

    return { internalId: savedId, soNumber, action: 'created' };
  };

  return { post };
});
