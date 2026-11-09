/**
 * One-shot script: patch PO36 (internalId=1258) otherrefnum back to 'PO-2026-1005'
 * Uses NS REST Record API: PATCH /record/v1/purchaseorder/{id}
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { nsRequest } = require('../ns-tba');

const NS_ACCOUNT = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const PO_ID      = 1258;
const NEW_REF    = 'PO-2026-1005';

async function main() {
  const url = `https://${NS_ACCOUNT}.suitetalk.api.netsuite.com/services/rest/record/v1/purchaseorder/${PO_ID}`;

  console.log(`PATCH ${url}`);
  console.log(`Setting otherrefnum → "${NEW_REF}"`);

  const result = await nsRequest('PATCH', url, { otherrefnum: NEW_REF });
  console.log('Done:', result ?? '(no body — 204 success)');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
