require('dotenv').config();
const { nsRequest }                  = require('./ns-tba');
const { getDispatchedOutboundOrders } = require('./cartoncloud');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_FULFILLMENT_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_FULFILLMENT_DEPLOY_ID || '1';

const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
                  + `/app/site/hosting/restlet.nl`
                  + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

const DEFAULT_LOCATION_ID = process.env.NS_DEFAULT_LOCATION_ID || null;

async function createFulfillment(soNumber, options = {}) {
  const dispatched = await getDispatchedOutboundOrders();
  const ccOrder = dispatched.find(o => o.references?.customer === soNumber);
  if (!ccOrder) throw new Error(`CC order for ${soNumber} is not dispatched`);

  const body = { soNumber, ...options };
  if (DEFAULT_LOCATION_ID && !body.locationId) body.locationId = DEFAULT_LOCATION_ID;
  const res = await nsRequest('POST', RESTLET_URL, body);
  if (!res?.success) throw new Error(res?.error || 'Unknown NS fulfillment error');
  return res;
}

module.exports = { createFulfillment };
