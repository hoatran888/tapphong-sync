require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID  = process.env.NS_DELIVERY_STATUS_SCRIPT_ID;
const DEPLOY_ID  = process.env.NS_DELIVERY_STATUS_DEPLOY_ID || '1';

const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
                  + `/app/site/hosting/restlet.nl`
                  + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

async function updateDeliveryStatus(soNumber, options = {}) {
  const { status, date, reason, newDate, ccOrder } = options;

  const body = {
    soNumber,
    status:  status  || ccOrder?.status,
    date:    date    || new Date().toISOString().split('T')[0],
    reason:  reason  || ccOrder?.notes || undefined,
    newDate: newDate || undefined,
  };

  const res = await nsRequest('POST', RESTLET_URL, body);
  if (!res?.success) throw new Error(res?.error || 'Unknown delivery status error');
  return res;
}

module.exports = { updateDeliveryStatus };
