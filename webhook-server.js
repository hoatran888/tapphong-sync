require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { createFulfillment } = require('./call-create-fulfillment');
const { createReceipt }     = require('./call-create-receipt');

const PORT       = Number(process.env.WEBHOOK_PORT || 3000);
const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

const FULFILLMENT_FILE = path.join(OUTPUT_DIR, 'fulfillment-result.json');
const RECEIPT_FILE     = path.join(OUTPUT_DIR, 'receipt-result.json');

function saveResult(file, key, result) {
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const idx = existing.findIndex(r => r[key] === result[key]);
    if (idx >= 0) existing[idx] = result; else existing.push(result);
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
}

const OUTBOUND_STATUSES = ['DISPATCHED', 'DELIVERED', 'COLLECTED'];
const INBOUND_STATUSES  = ['VERIFIED', 'RECEIVED'];

async function handleOutbound(order) {
  const soNumber = order?.references?.customer;
  const status   = order?.status;
  if (!soNumber) { console.warn('Webhook OUTBOUND: no customer reference'); return; }
  if (!OUTBOUND_STATUSES.includes(status?.toUpperCase())) {
    console.log(`Webhook OUTBOUND: skipping status "${status}" for ${soNumber}`); return;
  }
  console.log(`Processing fulfillment for ${soNumber} (status: ${status})`);
  try {
    const res = await createFulfillment(soNumber, { ccOrder: order });
    console.log(`NS   OK   ${soNumber}  →  fulfillment internalId: ${res.internalId} (${res.action})`);
    saveResult(FULFILLMENT_FILE, 'soNumber', { soNumber, ccId: order.id, status: 'ok', internalId: res.internalId, action: res.action });
  } catch (err) {
    console.error(`NS   ERR  ${soNumber}  →  ${err.message}`);
    saveResult(FULFILLMENT_FILE, 'soNumber', { soNumber, ccId: order.id, status: 'error', error: err.message });
  }
}

async function handleInbound(order) {
  const poNumber = order?.references?.customer;
  const status   = order?.status;
  if (!poNumber) { console.warn('Webhook INBOUND: no customer reference'); return; }
  if (!INBOUND_STATUSES.includes(status?.toUpperCase())) {
    console.log(`Webhook INBOUND: skipping status "${status}" for ${poNumber}`); return;
  }
  if (!poNumber.startsWith('PO-') && !poNumber.startsWith('SO-')) {
    console.warn(`Webhook INBOUND: skipping unrecognised reference: ${poNumber}`); return;
  }
  console.log(`Processing receipt for ${poNumber} (status: ${status})`);
  try {
    const res = await createReceipt(poNumber, { ccOrder: order });
    console.log(`NS   OK   ${poNumber}  →  receipt internalId: ${res.internalId} (${res.action})`);
    saveResult(RECEIPT_FILE, 'poNumber', { poNumber, ccId: order.id, status: 'ok', internalId: res.internalId, action: res.action });
  } catch (err) {
    console.error(`NS   ERR  ${poNumber}  →  ${err.message}`);
    saveResult(RECEIPT_FILE, 'poNumber', { poNumber, ccId: order.id, status: 'error', error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  // Diagnostic: GET /health shows env var status
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      ns_account:       process.env.NS_ACCOUNT ? process.env.NS_ACCOUNT.slice(0, 6) + '...' : 'MISSING',
      ns_consumer_key:  process.env.NS_CONSUMER_KEY  ? process.env.NS_CONSUMER_KEY.slice(0, 6)  + '...' : 'MISSING',
      ns_token_key:     process.env.NS_TOKEN_KEY      ? process.env.NS_TOKEN_KEY.slice(0, 6)      + '...' : 'MISSING',
      ns_fulfillment_script: process.env.NS_FULFILLMENT_SCRIPT_ID || 'MISSING',
      ns_receipt_script:     process.env.NS_RECEIPT_SCRIPT_ID     || 'MISSING',
    }));
    return;
  }

  if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));

    let order;
    try { order = JSON.parse(body); } catch { console.warn('Webhook: invalid JSON'); return; }

    console.log(`\nWebhook received: type=${order?.type} status=${order?.status} ref=${order?.references?.customer}`);

    const type = order?.type?.toUpperCase();
    if (type === 'OUTBOUND')      await handleOutbound(order);
    else if (type === 'INBOUND')  await handleInbound(order);
    else console.warn(`Webhook: unknown type "${type}"`);
  });
});

server.listen(PORT, () => {
  console.log(`CC Webhook server listening on port ${PORT}`);
  console.log(`Webhook URL: https://tapphong-sync.onrender.com`);
  console.log('Handles OUTBOUND (fulfillment) and INBOUND (receipt) automatically.');
  console.log(`ENV CHECK — NS_ACCOUNT: ${process.env.NS_ACCOUNT || 'MISSING'} | NS_FULFILLMENT_SCRIPT_ID: ${process.env.NS_FULFILLMENT_SCRIPT_ID || 'MISSING'} | NS_TOKEN_KEY: ${process.env.NS_TOKEN_KEY ? process.env.NS_TOKEN_KEY.slice(0,8)+'...' : 'MISSING'}\n`);
});
