require('dotenv').config();
const { nsRequest }               = require('./ns-tba');
const { getVerifiedInboundOrders } = require('./cartoncloud');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_RECEIPT_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_RECEIPT_DEPLOY_ID || '1';

const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
                  + `/app/site/hosting/restlet.nl`
                  + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

const DEFAULT_LOCATION_ID = process.env.NS_DEFAULT_LOCATION_ID || null;

async function createReceipt(poNumber, options = {}) {
  const soNumber = poNumber.startsWith('SO-') ? poNumber : null;
  const ref      = soNumber || poNumber;
  const verified = await getVerifiedInboundOrders();
  const ccOrder  = verified.find(o => o.references?.customer === ref);
  if (!ccOrder) throw new Error(`CC inbound order for ${ref} is not verified`);

  const body = soNumber ? { soNumber, ...options } : { poNumber, ...options };
  if (DEFAULT_LOCATION_ID && !body.locationId) body.locationId = DEFAULT_LOCATION_ID;
  const res = await nsRequest('POST', RESTLET_URL, body);
  if (!res?.success) throw new Error(res?.error || 'Unknown NS receipt error');
  return res;
}

module.exports = { createReceipt };
