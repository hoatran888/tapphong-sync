/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const post = (body) => {
    try {
      if (body.listAccounts) return { success: true, accounts: listAccounts() };
      const result = createAdjustment(body);
      return { success: true, ...result };
    } catch (e) {
      log.error({ title: 'Inv Adjustment RESTlet error', details: e.message });
      return { success: false, error: e.message };
    }
  };

  const listAccounts = () => {
    const results = search.create({
      type:    'account',
      filters: [['isinactive', 'is', 'F'], 'AND',
                ['type', 'anyof', 'Cost', 'Expense', 'OthExpense', 'Inventory']],
      columns: ['internalid', 'number', 'name', 'type'],
    }).run().getRange({ start: 0, end: 200 });
    return results.map(r => ({
      id:     r.getValue('internalid'),
      number: r.getValue('number'),
      name:   r.getValue('name'),
      type:   r.getValue('type'),
    }));
  };

  const findItemBySku = (sku) => {
    const found = search.create({
      type:    search.Type.INVENTORY_ITEM,
      filters: [['itemid', 'is', sku]],
      columns: ['internalid', 'stockunit'],
    }).run().getRange({ start: 0, end: 1 });
    if (!found.length) return null;
    return {
      id:        Number(found[0].getValue('internalid')),
      stockUnit: found[0].getValue('stockunit') ? Number(found[0].getValue('stockunit')) : null,
    };
  };

  // Default GL accounts per adjustment type — override via data.accountId
  const DEFAULT_ACCOUNTS = {
    CYCLE_COUNT: null,  // NS will use default inventory adjustment account
    DAMAGED:     null,
    LOST:        null,
    FOUND:       null,
    WRITE_OFF:   null,
  };

  const createAdjustment = (data) => {
    const { adjustmentType, sku, locationId, memo, accountId } = data;

    const validTypes = ['CYCLE_COUNT', 'DAMAGED', 'LOST', 'FOUND', 'WRITE_OFF'];
    if (!validTypes.includes(adjustmentType)) {
      throw new Error(`Invalid adjustmentType "${adjustmentType}". Must be one of: ${validTypes.join(', ')}`);
    }
    if (!sku) throw new Error('sku is required');

    const item = findItemBySku(sku);
    if (!item) throw new Error(`Item not found for SKU: ${sku}`);
    const { id: itemId, stockUnit } = item;

    // For CYCLE_COUNT: newQuantity sets absolute qty. Others: adjustQtyBy is the delta.
    const isCycleCount = adjustmentType === 'CYCLE_COUNT';
    if (isCycleCount && data.newQuantity == null) throw new Error('newQuantity is required for CYCLE_COUNT');
    if (!isCycleCount && data.adjustQtyBy == null) throw new Error('adjustQtyBy is required for this adjustment type');

    const resolvedAccountId = accountId || DEFAULT_ACCOUNTS[adjustmentType];

    log.audit({ title: 'Inv Adjustment', details: `type=${adjustmentType} sku=${sku} itemId=${itemId} stockUnit=${stockUnit}` });

    const adj = record.create({ type: record.Type.INVENTORY_ADJUSTMENT, isDynamic: true });

    if (resolvedAccountId && Number(resolvedAccountId) > 0) adj.setValue({ fieldId: 'account', value: Number(resolvedAccountId) });
    if (memo) adj.setValue({ fieldId: 'memo', value: memo });
    adj.setValue({ fieldId: 'trandate', value: new Date() });

    adj.selectNewLine({ sublistId: 'inventory' });
    adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item', value: itemId, ignoreFieldChange: true });
    if (stockUnit) {
      adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'units', value: stockUnit, ignoreFieldChange: true });
    }
    if (locationId && Number(locationId) > 0) {
      adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'location', value: Number(locationId), ignoreFieldChange: true });
    }
    if (isCycleCount) {
      adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'newquantity', value: Number(data.newQuantity) });
    } else {
      adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'adjustqtyby', value: Number(data.adjustQtyBy) });
    }
    if (memo) adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'memo', value: memo });
    adj.commitLine({ sublistId: 'inventory' });

    const savedId = adj.save({ ignoreMandatoryFields: true });
    log.audit({ title: 'Inv Adjustment Created', details: `internalId=${savedId} type=${adjustmentType} sku=${sku}` });

    return { internalId: savedId, adjustmentType, sku, action: 'created' };
  };

  return { post };
});
