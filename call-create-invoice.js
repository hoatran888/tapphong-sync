require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_INVOICE_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_INVOICE_DEPLOY_ID || '1';

const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
                  + `/app/site/hosting/restlet.nl`
                  + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

const REST_BASE_URL = `https://${NS_ACCOUNT}.suitetalk.api.netsuite.com`;

async function findSoId(soNumber) {
  const url = `${REST_BASE_URL}/services/rest/record/v1/salesOrder?q=otherRefNum IS "${soNumber}"&limit=50`;
  const res = await nsRequest('GET', url);
  const all = (res?.items || []).sort((a, b) => Number(a.id) - Number(b.id));
  return all.length ? all[0].id : null;
}

async function createInvoice(soNumber, options = {}) {
  const soId = await findSoId(soNumber);
  if (!soId) throw new Error(`SO not found in NS: ${soNumber}`);

  const body = { soNumber, soId: Number(soId) };
  if (options.tranDate)  body.tranDate  = options.tranDate;
  if (options.memo)      body.memo      = options.memo;

  const res = await nsRequest('POST', RESTLET_URL, body);
  if (!res?.success) throw new Error(res?.error || 'Unknown NS invoice error');
  return res;
}

module.exports = { createInvoice };
