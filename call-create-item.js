// call-create-item.js
require('dotenv').config();
const { nsRequest } = require('./ns-tba');

// Sandbox accounts use hyphens in URL e.g. 12222161_SB1 → 12222161-sb1
const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_DEPLOY_ID || '1';

// RESTlet URL — designed for TBA external API calls
const SUITELET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
                   + `/app/site/hosting/restlet.nl`
                   + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

async function createItem(itemData) {
  return nsRequest('POST', SUITELET_URL, itemData);
}

module.exports = { createItem };
