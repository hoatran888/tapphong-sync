/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const post = (body) => {
    try {
      const internalId = upsertInventoryItem(body);
      return { success: true, internalId };
    } catch (e) {
      log.error({ title: 'RESTlet error', details: e.message });
      return { success: false, error: e.message };
    }
  };

  const findItemBySku = (sku) => {
    const found = search.create({
      type:    search.Type.INVENTORY_ITEM,
      filters: [['itemid', 'is', sku]],
      columns: ['internalid'],
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? found[0].getValue('internalid') : null;
  };

  // ── load unit abbreviation → internalId map from a Units Type record ─────────
  const getUnitIds = (unitsTypeId) => {
    if (!unitsTypeId || Number(unitsTypeId) <= 0) return {};
    const ut = record.load({ type: record.Type.UNITS_TYPE, id: Number(unitsTypeId) });
    const lineCount = ut.getLineCount({ sublistId: 'uom' });
    const map = {};
    for (let i = 0; i < lineCount; i++) {
      const abbr = ut.getSublistValue({ sublistId: 'uom', fieldId: 'abbreviation', line: i });
      const id   = ut.getSublistValue({ sublistId: 'uom', fieldId: 'internalid',   line: i });
      if (abbr) map[abbr] = id;
    }
    log.audit({ title: 'UnitIds', details: JSON.stringify(map) });
    return map;
  };

  // ── set price level by display name, optionally also matching unit ────────────
  const setPriceLevel = (item, levelName, price, unitId) => {
    if (!price || Number(price) <= 0) return;
    const lineCount = item.getLineCount({ sublistId: 'price' });
    for (let i = 0; i < lineCount; i++) {
      const text = item.getSublistText({ sublistId: 'price', fieldId: 'pricelevel', line: i });
      if (text !== levelName) continue;
      if (unitId) {
        const lineUnit = item.getSublistValue({ sublistId: 'price', fieldId: 'unit', line: i });
        if (Number(lineUnit) !== Number(unitId)) continue;
      }
      item.setSublistValue({ sublistId: 'price', fieldId: 'price', line: i, value: Number(price) });
      return;
    }
    log.audit({ title: 'Pricing', details: `Price level "${levelName}"${unitId ? ` unit=${unitId}` : ''} not found for sku=${item.getValue('itemid')}` });
  };

  // ── set reorder point + preferred stock (requires isDynamic: true) ────────────
  const setLocationData = (item, locationId, reorderPoint, preferredStock) => {
    if (!locationId || Number(locationId) <= 0) return;
    const locId = Number(locationId);

    const lineCount = item.getLineCount({ sublistId: 'locations' });
    let lineIndex = -1;
    for (let i = 0; i < lineCount; i++) {
      const val = item.getSublistValue({ sublistId: 'locations', fieldId: 'location', line: i });
      if (Number(val) === locId) { lineIndex = i; break; }
    }

    if (lineIndex === -1) {
      log.audit({ title: 'Location Skip', details: `locationId=${locId} not found in ${lineCount} lines` });
      return;
    }

    item.selectLine({ sublistId: 'locations', line: lineIndex });
    if (reorderPoint > 0)
      item.setCurrentSublistValue({ sublistId: 'locations', fieldId: 'reorderpoint',       value: Number(reorderPoint) });
    if (preferredStock > 0)
      item.setCurrentSublistValue({ sublistId: 'locations', fieldId: 'preferredstocklevel', value: Number(preferredStock) });
    item.commitLine({ sublistId: 'locations' });

    log.audit({ title: 'Location', details: `locationId=${locId} reorder=${reorderPoint} preferred=${preferredStock}` });
  };

  const upsertInventoryItem = (data) => {
    log.audit({ title: 'Received Data', details: JSON.stringify(data) });
    const existingId = findItemBySku(data.sku);

    // ── Pass 1: body fields + pricing (isDynamic: false required for price sublist) ──
    const item = existingId
      ? record.load({ type: record.Type.INVENTORY_ITEM, id: existingId, isDynamic: false })
      : record.create({ type: record.Type.INVENTORY_ITEM, isDynamic: false });

    // ── Core identity ──
    item.setValue({ fieldId: 'itemid',      value: data.sku });
    item.setValue({ fieldId: 'displayname', value: data.displayName || data.sku });
    item.setValue({ fieldId: 'upccode',     value: data.barcode || '' });

    // ── Units of measure ──
    let saleUnitId = null;
    if (data.unitsTypeId && Number(data.unitsTypeId) > 0) {
      item.setValue({ fieldId: 'unitstype', value: Number(data.unitsTypeId) });
      const unitIds = getUnitIds(data.unitsTypeId);
      if (data.stockUnit    && unitIds[data.stockUnit])    item.setValue({ fieldId: 'stockunit',    value: unitIds[data.stockUnit] });
      if (data.saleUnit     && unitIds[data.saleUnit])     item.setValue({ fieldId: 'saleunit',     value: unitIds[data.saleUnit] });
      if (data.purchaseUnit && unitIds[data.purchaseUnit]) item.setValue({ fieldId: 'purchaseunit', value: unitIds[data.purchaseUnit] });
      saleUnitId = data.saleUnit ? unitIds[data.saleUnit] : null;
    } else if (data.stockUomId && Number(data.stockUomId) > 1) {
      item.setValue({ fieldId: 'stockunit', value: Number(data.stockUomId) });
    }

    // ── Dimensions & weight ──
    if (data.weightKg) item.setValue({ fieldId: 'weight', value: Number(data.weightKg) });
    if (data.lengthCm) item.setValue({ fieldId: 'length', value: Number(data.lengthCm) });
    if (data.widthCm)  item.setValue({ fieldId: 'width',  value: Number(data.widthCm) });
    if (data.heightCm) item.setValue({ fieldId: 'height', value: Number(data.heightCm) });

    // ── Pricing (price sublist) — pass saleUnitId when UOM is in use ──
    setPriceLevel(item, 'Base Price',        data.retailPrice,    saleUnitId);
    setPriceLevel(item, 'Alternate Price 2', data.wholesalePrice, saleUnitId);
    setPriceLevel(item, 'Online Price',      data.onlinePrice,    saleUnitId);

    // ── Cost & lead time ──
    if (data.costPrice)    item.setValue({ fieldId: 'cost',              value: Number(data.costPrice) });
    if (data.leadTimeDays) item.setValue({ fieldId: 'purchaseleadtime',  value: Number(data.leadTimeDays) });

    // Disable auto-calculate so per-location reorder/preferred stock can be set manually
    if (data.locations && data.locations.length > 0) {
      item.setValue({ fieldId: 'autoreorderpoint',   value: false });
      item.setValue({ fieldId: 'autopreferredstock', value: false });
    }

    // ── Pieces per carton ──
    const caseQty = data.piecesPerCarton || data.casePackQty;
    if (caseQty) item.setValue({ fieldId: 'reordermultiple', value: Number(caseQty) });

    // ── Accounting ──
    if (data.assetAccountId  && Number(data.assetAccountId)  > 100)
      item.setValue({ fieldId: 'assetaccount',  value: Number(data.assetAccountId) });
    if (data.incomeAccountId && Number(data.incomeAccountId) > 100)
      item.setValue({ fieldId: 'incomeaccount', value: Number(data.incomeAccountId) });
    if (data.cogsAccountId   && Number(data.cogsAccountId)   > 100)
      item.setValue({ fieldId: 'cogsaccount',   value: Number(data.cogsAccountId) });

    item.setValue({ fieldId: 'isapproved', value: true });
    if (data.subsidiaryIds && data.subsidiaryIds.length > 0) {
      item.setValue({ fieldId: 'subsidiary', value: data.subsidiaryIds.map(Number) });
    }

    const savedId = item.save({ ignoreMandatoryFields: true });
    log.audit({ title: existingId ? 'Item Updated' : 'Item Created', details: `internalId=${savedId}, sku=${data.sku}` });

    // ── Pass 2: location data (isDynamic: true required for machine sublist) ──────
    if (data.locations && data.locations.length > 0) {
      try {
        const item2 = record.load({ type: record.Type.INVENTORY_ITEM, id: savedId, isDynamic: true });
        for (const loc of data.locations) {
          setLocationData(item2, loc.locationId, loc.reorderPoint, loc.preferredStock);
        }
        item2.save({ ignoreMandatoryFields: true });
        log.audit({ title: 'Locations Saved', details: `sku=${data.sku} count=${data.locations.length}` });
      } catch (locErr) {
        log.error({ title: 'Location pass skipped', details: locErr.message });
      }
    }

    return savedId;
  };

  return { post };
});
