require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_FULFILLMENT_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_FULFILLMENT_DEPLOY_ID || '1';
const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

(async () => {
  const res = await nsRequest('POST', RESTLET_URL, { soNumber: 'SO-2026-1003', soId: 453, force: true });
  console.log(JSON.stringify(res, null, 2));
})().catch(e => console.error(e.message));
