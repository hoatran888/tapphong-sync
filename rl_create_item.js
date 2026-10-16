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

  const upsertInventoryItem = (data) => {
    const existingId = findItemBySku(data.sku);

    // isDynamic: false — required for price sublist (static sublist, getLineCount returns -1 in dynamic mode)
    const item = existingId
      ? record.load({ type: record.Type.INVENTORY_ITEM, id: existingId, isDynamic: false })
      : record.create({ type: record.Type.INVENTORY_ITEM, isDynamic: false });

    // Core identity
    item.setValue({ fieldId: 'itemid',      value: data.sku });
    item.setValue({ fieldId: 'displayname', value: data.displayName || data.sku });
    item.setValue({ fieldId: 'upccode',     value: data.barcode || '' });

    // Units of measure
    if (data.uomInternalId && Number(data.uomInternalId) > 1)
      item.setValue({ fieldId: 'stockunit', value: Number(data.uomInternalId) });

    // Dimensions & weight
    if (data.weightKg)  item.setValue({ fieldId: 'weight', value: Number(data.weightKg) });
    if (data.lengthCm)  item.setValue({ fieldId: 'length', value: Number(data.lengthCm) });
    if (data.widthCm)   item.setValue({ fieldId: 'width',  value: Number(data.widthCm) });
    if (data.heightCm)  item.setValue({ fieldId: 'height', value: Number(data.heightCm) });

    // Retail price — find Base Price line in price sublist by name
    if (data.retailPrice) {
      const price     = Number(data.retailPrice);
      const lineCount = item.getLineCount({ sublistId: 'price' });
      let   found     = false;
      for (let i = 0; i < lineCount; i++) {
        const levelText = item.getSublistText({ sublistId: 'price', fieldId: 'pricelevel', line: i });
        if (levelText === 'Base Price') {
          item.setSublistValue({ sublistId: 'price', fieldId: 'price', line: i, value: price });
          found = true;
          break;
        }
      }
      log.audit({ title: 'Pricing', details: `sku=${data.sku} lines=${lineCount} basePriceFound=${found} price=${price}` });
    }

    // Cost price
    if (data.costPrice) item.setValue({ fieldId: 'cost', value: Number(data.costPrice) });

    // Inventory
    if (data.casePackQty)
      item.setValue({ fieldId: 'reordermultiple', value: Number(data.casePackQty) });

    // Accounting
    if (data.assetAccountId  && Number(data.assetAccountId)  > 100)
      item.setValue({ fieldId: 'assetaccount',  value: Number(data.assetAccountId) });
    if (data.incomeAccountId && Number(data.incomeAccountId) > 100)
      item.setValue({ fieldId: 'incomeaccount', value: Number(data.incomeAccountId) });
    if (data.cogsAccountId   && Number(data.cogsAccountId)   > 100)
      item.setValue({ fieldId: 'cogsaccount',   value: Number(data.cogsAccountId) });

    const savedId = item.save({ ignoreMandatoryFields: true });
    log.audit({
      title:   existingId ? 'Item Updated' : 'Item Created',
      details: `internalId=${savedId}, sku=${data.sku}`,
    });
    return savedId;
  };

  return { post };
});
