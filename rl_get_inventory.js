/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
define(['N/search', 'N/log'], (search, log) => {

  const post = (body) => {
    try {
      const locationId = body.locationId ? Number(body.locationId) : null;

      const filters = [['isinactive', 'is', 'F']];
      if (locationId) {
        filters.push('AND', ['inventorylocation', 'anyof', locationId]);
      }

      const items = [];
      const s = search.create({
        type:    search.Type.INVENTORY_ITEM,
        filters,
        columns: ['itemid', 'displayname', 'quantityavailable', 'quantityonhand'],
      });

      s.run().each(r => {
        items.push({
          sku:               r.getValue({ name: 'itemid' }),
          name:              r.getValue({ name: 'displayname' }) || r.getValue({ name: 'itemid' }),
          quantityAvailable: Number(r.getValue({ name: 'quantityavailable' })) || 0,
          quantityOnHand:    Number(r.getValue({ name: 'quantityonhand' }))    || 0,
        });
        return true;
      });

      log.audit({ title: 'Get Inventory', details: `${items.length} items` });
      return { success: true, items };
    } catch (e) {
      log.error({ title: 'Get Inventory error', details: e.message });
      return { success: false, error: e.message };
    }
  };

  return { post };
});
