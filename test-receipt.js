require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_RECEIPT_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_RECEIPT_DEPLOY_ID || '1';
const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

const param = process.argv[2];
if (!param) { console.error('Usage: node test-receipt.js <SO-XXXX-XXXX | PO-XXXX-XXXX>'); process.exit(1); }

const body = param.startsWith('SO-') ? { soNumber: param, force: true } : { poNumber: param, force: true };

const fs   = require('fs');
const path = require('path');
const OUT  = path.join(__dirname, 'output', 'test-receipt-result.json');

(async () => {
  const res = await nsRequest('POST', RESTLET_URL, body);
  console.log(JSON.stringify(res, null, 2));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ param, body, result: res }, null, 2));
  console.log(`\nResult saved to: ${OUT}`);
})().catch(e => console.error(e.response?.data || e.message));
