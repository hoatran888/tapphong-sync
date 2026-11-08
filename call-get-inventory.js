require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SUITEQL_URL = `https://${NS_ACCOUNT}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;

async function getNSInventory() {
  const locationId = process.env.NS_DEFAULT_LOCATION_ID || null;
  const locationFilter = locationId
    ? `AND il.location = ${Number(locationId)}`
    : '';

  const locationClause = locationId ? `AND ib.location = ${Number(locationId)}` : '';
  const query = `
    SELECT i.itemid, i.displayname, ib.quantityavailable, ib.quantityonhand
    FROM   inventoryitem i
    JOIN   inventorybalance ib ON ib.item = i.id
    WHERE  i.isinactive = 'F'
    ${locationClause}
  `;

  const items = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUITEQL_URL}?limit=${limit}&offset=${offset}`;
    const res = await nsRequest('POST', url, { q: query }, { Prefer: 'transient' });
    const rows = res.items || [];
    for (const r of rows) {
      items.push({
        sku:               r.itemid,
        name:              r.displayname || r.itemid,
        quantityAvailable: Number(r.quantityavailable) || 0,
        quantityOnHand:    Number(r.quantityonhand)    || 0,
      });
    }
    if (!res.hasMore) break;
    offset += limit;
  }

  return items;
}

module.exports = { getNSInventory };
