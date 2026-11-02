/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const post = (body) => {
    try {
      const result = upsertPurchaseOrder(body);
      return { success: true, ...result };
    } catch (e) {
      log.error({ title: 'PO RESTlet error', details: JSON.stringify({ message: e.message, name: e.name, stack: e.stack }) });
      return { success: false, error: e.message };
    }
  };

  // ── find tax code internal ID by name ────────────────────────────────────────
  const findTaxCode = (name) => {
    const found = search.create({
      type:    'salestaxitem',
      filters: [['name', 'is', name]],
      columns: ['internalid'],
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? Number(found[0].getValue('internalid')) : null;
  };

  // ── find inventory item internal ID by SKU ────────────────────────────────────
  const findItemBySku = (sku) => {
    const found = search.create({
      type:    search.Type.INVENTORY_ITEM,
      filters: [['itemid', 'is', sku]],
      columns: ['internalid'],
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? Number(found[0].getValue('internalid')) : null;
  };

  // ── find existing PO by our reference number (stored in otherrefnum) ──────────
  const findPOByReference = (poNumber, vendorId) => {
    const filters = [
      ['otherrefnum', 'is', poNumber], 'AND',
      ['mainline',    'is', true],     'AND',
      ['status', 'noneof', 'PurchOrd:G'],
    ];
    if (vendorId) filters.push('AND', ['entity', 'anyof', String(vendorId)]);
    const found = search.create({
      type:    search.Type.PURCHASE_ORDER,
      filters,
      columns: ['internalid', 'tranid'],
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? {
      internalId: Number(found[0].getValue('internalid')),
      tranId:     found[0].getValue('tranid'),
    } : null;
  };

  const upsertPurchaseOrder = (data) => {
    log.audit({ title: 'PO Received', details: `poNumber=${data.poNumber} lines=${data.lines.length}` });

    const existing = findPOByReference(data.poNumber, data.vendorId);
    log.audit({ title: 'PO Lookup', details: existing ? `found internalId=${existing.internalId}` : 'not found, will create' });

    const po = existing
      ? record.load({ type: record.Type.PURCHASE_ORDER, id: existing.internalId, isDynamic: true })
      : record.create({
          type: record.Type.PURCHASE_ORDER,
          isDynamic: true,
          defaultValues: data.subsidiaryId ? { subsidiary: Number(data.subsidiaryId) } : {},
        });

    log.audit({ title: 'PO Subsidiary', details: `subsidiary=${po.getValue({ fieldId: 'subsidiary' })}` });

    // ── Header ──
    if (data.vendorId)   po.setValue({ fieldId: 'entity',      value: Number(data.vendorId) });
    if (data.tranDate)   po.setValue({ fieldId: 'trandate',    value: new Date(data.tranDate) });
    if (data.shipDate)   po.setValue({ fieldId: 'shipdate',    value: new Date(data.shipDate) });
    if (data.locationId) po.setValue({ fieldId: 'location',    value: Number(data.locationId) });
    if (data.memo)        po.setValue({ fieldId: 'memo',          value: data.memo });
    if (data.autoApprove) po.setValue({ fieldId: 'approvalstatus', value: '2' });
    po.setValue({ fieldId: 'otherrefnum', value: data.poNumber });

    // ── Clear existing lines when updating (skip if any line has been received) ─
    if (existing) {
      const lineCount = po.getLineCount({ sublistId: 'item' });
      let hasReceivedLines = false;
      for (let i = 0; i < lineCount; i++) {
        const qtyReceived = Number(po.getSublistValue({ sublistId: 'item', fieldId: 'quantityreceived', line: i }) || 0);
        if (qtyReceived > 0) { hasReceivedLines = true; break; }
      }
      if (hasReceivedLines) {
        log.audit({ title: 'PO Lines Kept', details: `lines have been received — skipping clear, will append new lines` });
      } else {
        for (let i = lineCount - 1; i >= 0; i--) {
          po.removeLine({ sublistId: 'item', line: i });
        }
        log.audit({ title: 'PO Lines Cleared', details: `removed ${lineCount} line(s)` });
      }
    }

    // ── Resolve tax code ──────────────────────────────────────────────────────
    const taxCodeName = data.taxCode || 'CA-E';
    log.audit({ title: 'Tax Code', details: `taxCodeName=${taxCodeName}` });

    // ── Add lines ─────────────────────────────────────────────────────────────
    let linesAdded = 0;
    for (const line of data.lines) {
      if (!line.sku || !line.quantity) continue;

      const itemId = findItemBySku(line.sku);
      if (!itemId) {
        log.audit({ title: 'PO Line Skip', details: `SKU not found: ${line.sku}` });
        continue;
      }

      log.audit({ title: 'PO Line Add', details: `SKU=${line.sku} itemId=${itemId}` });
      po.selectNewLine({ sublistId: 'item' });
      po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item',     value: itemId });
      po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: Number(line.quantity) });
      if (line.rate)        po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate',        value: Number(line.rate) });
      if (line.description) po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: line.description });
      if (line.locationId)  po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location',    value: Number(line.locationId) });
      if (taxCodeName)      po.setCurrentSublistText({ sublistId: 'item', fieldId: 'taxcode',      text: taxCodeName });
      po.commitLine({ sublistId: 'item' });
      linesAdded++;
    }

    const savedId = po.save({ ignoreMandatoryFields: true });
    const action  = existing ? 'updated' : 'created';
    log.audit({ title: `PO ${action}`, details: `internalId=${savedId}, poNumber=${data.poNumber}, lines=${linesAdded}` });

    return { internalId: savedId, poNumber: data.poNumber, action };
  };

  return { post };
});
