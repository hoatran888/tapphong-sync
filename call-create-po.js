require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID  = process.env.NS_PO_SCRIPT_ID;
const DEPLOY_ID  = process.env.NS_PO_DEPLOY_ID || '1';

const PO_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
             + `/app/site/hosting/restlet.nl`
             + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

async function createPO(poData) {
  return nsRequest('POST', PO_URL, poData);
}

module.exports = { createPO };
