/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log', 'N/query'], (record, search, log, query) => {

  const post = (body) => {
    const diag = [];
    try {
      const result = createReceipt(body, diag);
      return { success: true, ...result, diag };
    } catch (e) {
      log.error({ title: 'Receipt RESTlet error', details: e.message });
      return { success: false, error: e.message, diag };
    }
  };

  const findPOByRef = (poNumber, diag) => {
    try {
      const rows = query.runSuiteQL({
        query: `SELECT id, status FROM transaction WHERE type = 'PurchOrd' AND otherrefnum = '${poNumber.replace(/'/g, "''")}' ORDER BY id DESC`,
      }).asMappedResults();
      diag.push(`findPOByRef: found ${rows.length} row(s) for ${poNumber}: ${JSON.stringify(rows)}`);
      const receivable = ['B', 'D', 'E', 'F', 'PurchOrd:B', 'PurchOrd:D', 'PurchOrd:E', 'PurchOrd:F'];
      const match = rows.find(r => receivable.includes(r.status));
      return match ? Number(match.id) : null;
    } catch (e) {
      log.error({ title: 'findPOByRef error', details: e.message });
      return null;
    }
  };

  const findExistingReceipt = (poId) => {
    try {
      const found = search.create({
        type:    search.Type.ITEM_RECEIPT,
        filters: [['createdfrom', 'anyof', poId], 'AND', ['mainline', 'is', 'T']],
        columns: ['internalid'],
      }).run().getRange({ start: 0, end: 1 });
      return found.length ? Number(found[0].getValue('internalid')) : null;
    } catch (e) {
      return null;
    }
  };

  const resolveLocation = (poId, requestedLocationId) => {
    const poHeader = search.create({
      type:    search.Type.PURCHASE_ORDER,
      filters: [['internalid', 'anyof', poId], 'AND', ['mainline', 'is', 'T']],
      columns: ['location'],
    }).run().getRange({ start: 0, end: 1 });
    const poLocation = poHeader.length ? poHeader[0].getValue('location') : null;
    if (poLocation) return poLocation;

    const poLines = search.create({
      type:    search.Type.PURCHASE_ORDER,
      filters: [['internalid', 'anyof', poId], 'AND', ['mainline', 'is', 'F'], 'AND', ['taxline', 'is', 'F']],
      columns: ['item'],
    }).run().getRange({ start: 0, end: 1 });
    const firstItemId = poLines.length ? poLines[0].getValue('item') : null;

    if (firstItemId) {
      try {
        const balRows = query.runSuiteQL({
          query: `SELECT location FROM InventoryBalance WHERE item = ${firstItemId} ORDER BY quantityonhand DESC`,
        }).asMappedResults();
        if (balRows.length && balRows[0].location) return String(balRows[0].location);
      } catch (e) { /* fall through */ }
    }

    return requestedLocationId || null;
  };

  const createReceipt = (data, diag = []) => {
    const poNumber = data.poNumber || (data.soNumber ? data.soNumber.replace(/^SO-/, 'PO-') : null);
    if (!poNumber) throw new Error('poNumber or soNumber is required');
    log.audit({ title: 'Receipt Request', details: `poNumber=${poNumber}, soNumber=${data.soNumber || ''}` });

    const poId = data.poId ? Number(data.poId) : findPOByRef(poNumber, diag);
    if (!poId) throw new Error(`PO not found or not in receivable status: ${poNumber}`);

    if (!data.force) {
      const existingId = findExistingReceipt(poId);
      if (existingId) {
        log.audit({ title: 'Receipt Exists', details: `internalId=${existingId}` });
        return { internalId: existingId, poNumber, action: 'exists' };
      }
    }

    const locationId = resolveLocation(poId, data.locationId);
    diag.push(`poId=${poId}, locationId=${locationId}`);

    const receipt = record.transform({
      fromType:  record.Type.PURCHASE_ORDER,
      fromId:    poId,
      toType:    record.Type.ITEM_RECEIPT,
      isDynamic: true,
    });

    if (locationId) receipt.setValue({ fieldId: 'location', value: Number(locationId) });

    const lineCount = receipt.getLineCount({ sublistId: 'item' });
    diag.push(`lines=${lineCount}, receiptLoc=${receipt.getValue({ fieldId: 'location' })}`);
    for (let i = 0; i < lineCount; i++) {
      receipt.selectLine({ sublistId: 'item', line: i });
      const itemId    = receipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' });
      const qty       = receipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' });
      const rcvBefore = receipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive' });
      if (locationId) {
        try { receipt.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: Number(locationId) }); }
        catch (e) { diag.push(`line[${i}]: set loc error: ${e.message}`); }
      }
      receipt.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: true });
      const rcvAfter = receipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive' });
      diag.push(`line[${i}]: item=${itemId}, qty=${qty}, rcvBefore=${rcvBefore}, rcvAfter=${rcvAfter}`);
      receipt.commitLine({ sublistId: 'item' });
    }

    if (data.receiveDate) receipt.setValue({ fieldId: 'trandate', value: new Date(data.receiveDate) });
    if (data.memo)        receipt.setValue({ fieldId: 'memo',     value: data.memo });

    const savedId = receipt.save({ ignoreMandatoryFields: true, enableSourcing: false });
    log.audit({ title: 'Receipt Created', details: `internalId=${savedId}, poNumber=${poNumber}` });

    return { internalId: savedId, poNumber, action: 'created' };
  };

  return { post };
});
