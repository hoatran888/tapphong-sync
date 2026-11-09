/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const post = (body) => {
    try {
      const result = createInvoice(body);
      return { success: true, ...result };
    } catch (e) {
      log.error({ title: 'Invoice RESTlet error', details: e.message });
      return { success: false, error: e.message };
    }
  };

  const findSOByRef = (soNumber) => {
    const found = search.create({
      type:    search.Type.SALES_ORDER,
      filters: [
        ['otherrefnum', 'is', soNumber], 'AND',
        ['mainline',    'is', 'T'],      'AND',
        ['status', 'anyof', 'SalesOrd:E', 'SalesOrd:F'],
      ],
      columns: [search.createColumn({ name: 'internalid', sort: search.Sort.DESC })],
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? Number(found[0].getValue('internalid')) : null;
  };

  const findExistingInvoice = (soId) => {
    const found = search.create({
      type:    search.Type.INVOICE,
      filters: [['createdfrom', 'anyof', soId], 'AND', ['mainline', 'is', 'T']],
      columns: ['internalid'],
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? Number(found[0].getValue('internalid')) : null;
  };

  const createInvoice = (data) => {
    const soNumber = data.soNumber;
    log.audit({ title: 'Invoice Request', details: `soNumber=${soNumber}` });

    const soId = data.soId ? Number(data.soId) : findSOByRef(soNumber);
    if (!soId) throw new Error(`SO not found or not in fulfillment/billed status: ${soNumber}`);

    const existingId = findExistingInvoice(soId);
    if (existingId) {
      log.audit({ title: 'Invoice Exists', details: `internalId=${existingId}` });
      return { internalId: existingId, soNumber, action: 'exists' };
    }

    const invoice = record.transform({
      fromType:  record.Type.SALES_ORDER,
      fromId:    soId,
      toType:    record.Type.INVOICE,
      isDynamic: true,
    });

    if (data.tranDate) invoice.setValue({ fieldId: 'trandate', value: new Date(data.tranDate) });
    if (data.memo)     invoice.setValue({ fieldId: 'memo',     value: data.memo });

    const savedId = invoice.save({ ignoreMandatoryFields: true });
    log.audit({ title: 'Invoice Created', details: `internalId=${savedId}, soNumber=${soNumber}` });

    return { internalId: savedId, soNumber, action: 'created' };
  };

  return { post };
});
