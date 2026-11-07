/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

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

  const post = (body) => {
    try {
      const soNumber = body.soNumber;
      const soId = findSOByRef(soNumber);
      if (!soId) throw new Error(`SO not found: ${soNumber}`);

      const fields     = search.lookupFields({ type: search.Type.SALES_ORDER, id: soId, columns: ['email', 'entity'] });
      const name       = fields.entity?.[0]?.text || fields.entity;
      const customerId = fields.entity?.[0]?.value;

      // Get customer email from customer record
      let email = fields.email;
      if (!email && customerId) {
        const cf = search.lookupFields({ type: search.Type.CUSTOMER, id: Number(customerId), columns: ['email'] });
        email = cf.email || '';
      }

      // Get line items — aggregate by item name
      const lineResults = search.create({
        type:    search.Type.SALES_ORDER,
        filters: [['internalid', 'anyof', soId], 'AND', ['mainline', 'is', 'F'], 'AND', ['taxline', 'is', 'F']],
        columns: ['item', 'quantity'],
      }).run().getRange({ start: 0, end: 100 });
      const itemMap = {};
      for (const r of lineResults) {
        const name = r.getText('item');
        const qty  = Number(r.getValue('quantity')) || 0;
        if (!name) continue;
        itemMap[name] = (itemMap[name] || 0) + qty;
      }
      const items = Object.entries(itemMap).map(([name, qty]) => ({ name, qty }));

      log.audit({ title: 'SO Info', details: `soNumber=${soNumber} email=${email} items=${items.length}` });
      return { success: true, soId, soNumber, customerName: name, customerEmail: email, items };
    } catch (e) {
      log.error({ title: 'SO Info error', details: e.message });
      return { success: false, error: e.message };
    }
  };

  return { post };
});
