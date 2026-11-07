/**
 * Test the fulfillment RESTlet directly (bypasses CC check).
 *
 * Usage:
 *   node test-fulfillment.js SO-2026-1005
 *   node test-fulfillment.js SO-2026-1005 --skus=TP-2026-1005,TP-2026-1006
 *   node test-fulfillment.js SO-2026-1005 --force
 */
require('dotenv').config();
const { nsRequest } = require('./ns-tba');
const fs   = require('fs');
const path = require('path');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_FULFILLMENT_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_FULFILLMENT_DEPLOY_ID || '1';
const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

const args     = process.argv.slice(2);
const soNumber = args.find(a => !a.startsWith('--'));
const force    = args.includes('--force');
const skusFlag = args.find(a => a.startsWith('--skus='));
const skus     = skusFlag ? skusFlag.split('=')[1].split(',').map(s => s.trim()) : [];

if (!soNumber) {
  console.error('Usage: node test-fulfillment.js <SO-XXXX-XXXX> [--skus=SKU1,SKU2] [--force]');
  process.exit(1);
}

const body = { soNumber, ...(force && { force: true }), ...(skus.length && { skus }) };
console.log('Request body:', JSON.stringify(body, null, 2));

const OUT = path.join(__dirname, 'output', 'test-fulfillment-result.json');

(async () => {
  const res = await nsRequest('POST', RESTLET_URL, body);
  console.log('\nResult:', JSON.stringify(res, null, 2));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ soNumber, body, result: res }, null, 2));
  console.log(`\nSaved to: ${OUT}`);
})().catch(e => console.error(e.response?.data || e.message));
