require('dotenv').config();
const { nsRequest }                    = require('./ns-tba');
const { getDispatchedOutboundOrders, getWarehouseStockBySku } = require('./cartoncloud');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_FULFILLMENT_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_FULFILLMENT_DEPLOY_ID || '1';

const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
                  + `/app/site/hosting/restlet.nl`
                  + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

const SUITEQL_URL = `https://${NS_ACCOUNT}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;

const DEFAULT_LOCATION_ID = process.env.NS_DEFAULT_LOCATION_ID || null;

async function getNsInventory(skus) {
  if (!skus || !skus.length) return {};
  const quotedSkus = skus.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
  try {
    const res = await nsRequest(
      'POST', SUITEQL_URL,
      { q: `SELECT i.itemid, SUM(ib.quantityavailable) AS available FROM InventoryBalance ib JOIN item i ON i.id = ib.item WHERE i.itemid IN (${quotedSkus}) GROUP BY i.itemid` },
      { Prefer: 'transient' }
    );
    const result = {};
    for (const row of (res.items || [])) result[row.itemid] = Number(row.available || 0);
    return result;
  } catch (e) {
    console.warn('  NS inventory check failed:', e.message);
    return {};
  }
}

async function createFulfillment(soNumber, options = {}) {
  // Use the CC order passed directly from the webhook payload (preferred),
  // or fall back to fetching from CC API
  let ccOrder = options.ccOrder;
  if (!ccOrder) {
    const dispatched = await getDispatchedOutboundOrders();
    ccOrder = dispatched.find(o => o.references?.customer === soNumber);
  }
  if (!ccOrder) throw new Error(`CC order for ${soNumber} is not dispatched`);

  // Extract SKUs from CC order line items
  const skus = (ccOrder.items || [])
    .map(i => i.details?.product?.references?.code)
    .filter(Boolean);

  if (skus.length) {
    const [nsInv, ccInv] = await Promise.all([
      getNsInventory(skus),
      getWarehouseStockBySku(skus),
    ]);
    console.log(`  SKUs in order:  ${skus.join(', ')}`);
    console.log(`  NS inventory:   ${JSON.stringify(nsInv)}`);
    console.log(`  CC inventory:   ${JSON.stringify(ccInv)}`);
  }

  const body = { soNumber };
  if (DEFAULT_LOCATION_ID && !body.locationId) body.locationId = DEFAULT_LOCATION_ID;
  if (skus.length) body.skus = skus;

  const res = await nsRequest('POST', RESTLET_URL, body);
  if (!res?.success) throw new Error(res?.error || 'Unknown NS fulfillment error');
  return res;
}

module.exports = { createFulfillment };
