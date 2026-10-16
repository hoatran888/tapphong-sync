/**
 * @NScriptType Suitelet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const onRequest = (ctx) => {
    if (ctx.request.method !== 'POST') {
      ctx.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      ctx.response.write(JSON.stringify({ error: 'Only POST method is supported' }));
      return;
    }

    try {
      const body = JSON.parse(ctx.request.body);
      const internalId = upsertInventoryItem(body);
      ctx.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      ctx.response.write(JSON.stringify({ success: true, internalId }));
    } catch (e) {
      log.error({ title: 'sl_create_item error', details: e.message });
      ctx.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      ctx.response.write(JSON.stringify({ success: false, error: e.message }));
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

    const item = existingId
      ? record.load({ type: record.Type.INVENTORY_ITEM, id: existingId, isDynamic: true })
      : record.create({ type: record.Type.INVENTORY_ITEM, isDynamic: true });

    // Core identity
    item.setValue({ fieldId: 'itemid',      value: data.sku });
    item.setValue({ fieldId: 'displayname', value: data.displayName || data.sku });
    item.setValue({ fieldId: 'upccode',     value: data.barcode || '' });

    // Units of measure
    if (data.uomInternalId)
      item.setValue({ fieldId: 'stockunit', value: Number(data.uomInternalId) });

    // Dimensions & weight
    if (data.weightKg)  item.setValue({ fieldId: 'weight', value: Number(data.weightKg) });
    if (data.lengthCm)  item.setValue({ fieldId: 'length', value: Number(data.lengthCm) });
    if (data.widthCm)   item.setValue({ fieldId: 'width',  value: Number(data.widthCm) });
    if (data.heightCm)  item.setValue({ fieldId: 'height', value: Number(data.heightCm) });

    // Pricing
    if (data.retailPrice) item.setValue({ fieldId: 'baseprice', value: Number(data.retailPrice) });
    if (data.costPrice)   item.setValue({ fieldId: 'cost',      value: Number(data.costPrice) });

    // Inventory
    if (data.casePackQty)
      item.setValue({ fieldId: 'reordermultiple', value: Number(data.casePackQty) });

    // Accounting — only set if provided and non-zero
    if (data.assetAccountId  && Number(data.assetAccountId)  !== 0)
      item.setValue({ fieldId: 'assetaccount',  value: Number(data.assetAccountId) });
    if (data.incomeAccountId && Number(data.incomeAccountId) !== 0)
      item.setValue({ fieldId: 'incomeaccount', value: Number(data.incomeAccountId) });
    if (data.cogsAccountId   && Number(data.cogsAccountId)   !== 0)
      item.setValue({ fieldId: 'cogsaccount',   value: Number(data.cogsAccountId) });

    const savedId = item.save({ ignoreMandatoryFields: true });
    log.audit({
      title:   existingId ? 'Item Updated' : 'Item Created',
      details: `internalId=${savedId}, sku=${data.sku}`,
    });
    return savedId;
  };

  return { onRequest };
});
