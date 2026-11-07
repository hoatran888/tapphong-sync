require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_SO_INFO_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_SO_INFO_DEPLOY_ID || '1';

const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
                  + `/app/site/hosting/restlet.nl`
                  + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

async function getSOInfo(soNumber) {
  const res = await nsRequest('POST', RESTLET_URL, { soNumber });
  if (!res?.success) throw new Error(res?.error || 'SO info lookup failed');
  return res;
}

module.exports = { getSOInfo };
