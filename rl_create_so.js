/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const post = (body) => {
    try {
      const result = upsertSalesOrder(body);
      return { success: true, ...result };
    } catch (e) {
      log.error({ title: 'SO RESTlet error', details: JSON.stringify({ message: e.message, name: e.name, stack: e.stack }) });
      return { success: false, error: e.message };
    }
  };

  const findItemBySku = (sku) => {
    const found = search.create({
      type:    search.Type.INVENTORY_ITEM,
      filters: [['itemid', 'is', sku]],
      columns: ['internalid'],
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? Number(found[0].getValue('internalid')) : null;
  };

  const findSOByReference = (soNumber) => {
    try {
      const found = search.create({
        type:    search.Type.SALES_ORDER,
        filters: [['otherrefnum', 'contains', soNumber], 'AND', ['mainline', 'is', 'T']],
        columns: ['internalid'],
      }).run().getRange({ start: 0, end: 1 });
      return found.length ? { internalId: Number(found[0].getValue('internalid')) } : null;
    } catch (e) {
      log.audit({ title: 'SO Search Skip', details: e.message });
      return null;
    }
  };

  // ── find customer by ID or name ───────────────────────────────────────────
  const findCustomer = (nsCustomerId, name) => {
    if (nsCustomerId) return Number(nsCustomerId);
    if (!name) return null;
    const found = search.create({
      type:    search.Type.CUSTOMER,
      filters: [['entityid', 'is', name]],
      columns: ['internalid'],
    }).run().getRange({ start: 0, end: 1 });
    if (found.length) {
      const id = Number(found[0].getValue('internalid'));
      log.audit({ title: 'Customer Found', details: `name=${name} internalId=${id}` });
      return id;
    }
    return null;
  };

  const upsertSalesOrder = (data) => {
    log.audit({ title: 'SO Received', details: `soNumber=${data.soNumber} lines=${(data.lines || []).length}` });

    // ── resolve customer ──
    const customerId = findCustomer(data.nsCustomerId, data.customerName);
    if (!customerId) throw new Error(`Customer not found: "${data.customerName}" — add nsCustomerId to the SO sheet or create the customer in NetSuite first`);

    const existing = findSOByReference(data.soNumber);
    log.audit({ title: 'SO Lookup', details: existing ? `found internalId=${existing.internalId}` : 'not found, will create' });

    const so = existing
      ? record.load({ type: record.Type.SALES_ORDER, id: existing.internalId, isDynamic: true })
      : record.transform({
          fromType:  record.Type.CUSTOMER,
          fromId:    customerId,
          toType:    record.Type.SALES_ORDER,
          isDynamic: true,
        });

    // ── Header ──
    if (data.tranDate)   so.setValue({ fieldId: 'trandate',    value: new Date(data.tranDate) });
    if (data.shipDate)   so.setValue({ fieldId: 'shipdate',    value: new Date(data.shipDate) });
    if (data.locationId) so.setValue({ fieldId: 'location',    value: Number(data.locationId) });
    if (data.memo)       so.setValue({ fieldId: 'memo',        value: data.memo });
    so.setValue({ fieldId: 'otherrefnum', value: data.soNumber });

    // ── Clear existing lines when updating ──
    if (existing) {
      const lineCount = so.getLineCount({ sublistId: 'item' });
      for (let i = lineCount - 1; i >= 0; i--) {
        so.removeLine({ sublistId: 'item', line: i });
      }
    }

    // ── Add lines ──
    let linesAdded = 0;
    for (const line of (data.lines || [])) {
      if (!line.sku || !line.quantity) continue;

      const itemId = findItemBySku(line.sku);
      if (!itemId) {
        log.audit({ title: 'SO Line Skip', details: `SKU not found: ${line.sku}` });
        continue;
      }

      so.selectNewLine({ sublistId: 'item' });
      so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item',     value: itemId });
      so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: Number(line.quantity) });
      if (line.rate)        so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate',        value: Number(line.rate) });
      if (line.description) so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: line.description });
      if (line.locationId)  so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location',    value: Number(line.locationId) });
      so.commitLine({ sublistId: 'item' });
      linesAdded++;
    }

    const savedId = so.save({ ignoreMandatoryFields: true });
    const action  = existing ? 'updated' : 'created';
    log.audit({ title: `SO ${action}`, details: `internalId=${savedId}, soNumber=${data.soNumber}, lines=${linesAdded}, customer=${customerId}` });

    return { internalId: savedId, soNumber: data.soNumber, action, customerId };
  };

  return { post };
});
