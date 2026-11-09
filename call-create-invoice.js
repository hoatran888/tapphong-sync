require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_INVOICE_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_INVOICE_DEPLOY_ID || '1';

const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
                  + `/app/site/hosting/restlet.nl`
                  + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

async function createInvoice(soNumber, options = {}) {
  const body = { soNumber };
  if (options.tranDate)  body.tranDate  = options.tranDate;
  if (options.memo)      body.memo      = options.memo;

  const res = await nsRequest('POST', RESTLET_URL, body);
  if (!res?.success) throw new Error(res?.error || 'Unknown NS invoice error');
  return res;
}

module.exports = { createInvoice };
