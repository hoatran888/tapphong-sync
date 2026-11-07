/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const post = (body) => {
    try {
      const result = updateDeliveryStatus(body);
      return { success: true, ...result };
    } catch (e) {
      log.error({ title: 'Delivery Status RESTlet error', details: e.message });
      return { success: false, error: e.message };
    }
  };

  const findSOByRef = (soNumber) => {
    const found = search.create({
      type:    search.Type.SALES_ORDER,
      filters: [
        ['otherrefnum', 'is', soNumber], 'AND',
        ['mainline', 'is', 'T'], 'AND',
        ['status', 'anyof', 'SalesOrd:B', 'SalesOrd:D', 'SalesOrd:E', 'SalesOrd:F'],
      ],
      columns: [search.createColumn({ name: 'internalid', sort: search.Sort.DESC })],
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? Number(found[0].getValue('internalid')) : null;
  };

  const findFulfillment = (soId) => {
    try {
      const found = search.create({
        type:    search.Type.ITEM_FULFILLMENT,
        filters: [['createdfrom', 'anyof', soId], 'AND', ['mainline', 'is', 'T']],
        columns: ['internalid'],
      }).run().getRange({ start: 0, end: 1 });
      return found.length ? Number(found[0].getValue('internalid')) : null;
    } catch (e) { return null; }
  };

  const buildMemo = (status, date, reason, newDate) => {
    const s = (status || '').toUpperCase();
    if (s === 'DELIVERED' || s === 'COMPLETED') {
      return `Delivered on ${date}`;
    }
    if (s === 'FAILED' || s === 'DELIVERY_FAILED') {
      return `Delivery failed on ${date}${reason ? ': ' + reason : ''}`;
    }
    if (s === 'RESCHEDULED') {
      return `Rescheduled${newDate ? ' to ' + newDate : ''}${reason ? ': ' + reason : ''}`;
    }
    return `${status} on ${date}`;
  };

  const updateDeliveryStatus = (data) => {
    const soNumber = data.soNumber;
    const date     = data.date     || new Date().toISOString().split('T')[0];
    const memo     = buildMemo(data.status, date, data.reason, data.newDate);

    log.audit({ title: 'Delivery Status Update', details: `soNumber=${soNumber} status=${data.status} memo=${memo}` });

    const soId = findSOByRef(soNumber);
    if (!soId) throw new Error(`SO not found: ${soNumber}`);
    log.audit({ title: 'SO found', details: `soId=${soId} memo=${memo}` });

    record.submitFields({ type: record.Type.SALES_ORDER, id: soId, values: { memo }, options: { enableSourcing: false, ignoreMandatoryFields: true } });
    log.audit({ title: 'SO memo submitted', details: `soId=${soId}` });

    const fulfillmentId = findFulfillment(soId);
    if (fulfillmentId) {
      record.submitFields({ type: record.Type.ITEM_FULFILLMENT, id: fulfillmentId, values: { memo }, options: { enableSourcing: false, ignoreMandatoryFields: true } });
      log.audit({ title: 'Fulfillment memo submitted', details: `fulfillmentId=${fulfillmentId}` });
    }

    if ((data.status || '').toUpperCase() === 'RESCHEDULED' && data.newDate) {
      record.submitFields({ type: record.Type.SALES_ORDER, id: soId, values: { shipdate: new Date(data.newDate) }, options: { enableSourcing: false, ignoreMandatoryFields: true } });
    }

    log.audit({ title: 'Delivery Status Updated', details: `soId=${soId} fulfillmentId=${fulfillmentId} memo=${memo}` });
    return { soId, fulfillmentId, memo, soNumber };
  };

  return { post };
});
