require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { createFulfillment }      = require('./call-create-fulfillment');
const { createReceipt }          = require('./call-create-receipt');
const { updateDeliveryStatus }   = require('./call-update-delivery-status');
const { getSOInfo }              = require('./call-get-so-info');
const { sendShippedEmail, sendDeliveredEmail } = require('./send-email');

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

const FULFILLMENT_STATUSES = ['DISPATCHED'];
const DELIVERY_STATUSES    = ['DELIVERED', 'COMPLETED', 'FAILED', 'DELIVERY_FAILED', 'RESCHEDULED'];
const INBOUND_STATUSES     = ['VERIFIED', 'RECEIVED', 'ALLOCATED'];

async function handleOutbound(order) {
  const soNumber = order?.references?.customer;
  const status   = (order?.status || '').toUpperCase();
  if (!soNumber) { console.warn('Webhook OUTBOUND: no customer reference'); return; }

  if (FULFILLMENT_STATUSES.includes(status)) {
    console.log(`Processing fulfillment for ${soNumber} (status: ${status})`);
    try {
      const res = await createFulfillment(soNumber, { ccOrder: order });
      console.log(`NS   OK   ${soNumber}  →  fulfillment internalId: ${res.internalId} (${res.action})`);
      saveResult(FULFILLMENT_FILE, 'soNumber', { soNumber, ccId: order.id, status: 'ok', internalId: res.internalId, action: res.action });
      // Send shipped email
      try {
        const info = await getSOInfo(soNumber);
        if (info.customerEmail) {
          await sendShippedEmail({ to: info.customerEmail, customerName: info.customerName, soNumber, items: info.items, trackingRef: order.id });
        }
      } catch (e) { console.warn(`Email skipped (shipped) ${soNumber}: ${e.message}`); }
    } catch (err) {
      console.error(`NS   ERR  ${soNumber}  →  ${err.message}`);
      saveResult(FULFILLMENT_FILE, 'soNumber', { soNumber, ccId: order.id, status: 'error', error: err.message });
    }

  } else if (DELIVERY_STATUSES.includes(status)) {
    console.log(`Processing delivery status update for ${soNumber} (status: ${status})`);
    try {
      const res = await updateDeliveryStatus(soNumber, { ccOrder: order, status: order.status });
      console.log(`NS   OK   ${soNumber}  →  delivery status updated: ${res.memo}`);
    } catch (err) {
      console.error(`NS   ERR  ${soNumber}  →  ${err.message}`);
    }

  } else {
    console.log(`Webhook OUTBOUND: skipping status "${status}" for ${soNumber}`);
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
      server_time: new Date().toISOString(),
      ns_account:       process.env.NS_ACCOUNT ? process.env.NS_ACCOUNT.slice(0, 6) + '...' : 'MISSING',
      ns_consumer_key:    process.env.NS_CONSUMER_KEY     ? process.env.NS_CONSUMER_KEY.slice(0, 6)     + `...(len=${process.env.NS_CONSUMER_KEY.length})` : 'MISSING',
      ns_consumer_secret: process.env.NS_CONSUMER_SECRET  ? process.env.NS_CONSUMER_SECRET.slice(0, 6)  + `...(len=${process.env.NS_CONSUMER_SECRET.length})` : 'MISSING',
      ns_token_key:       process.env.NS_TOKEN_KEY         ? process.env.NS_TOKEN_KEY.slice(0, 6)         + `...(len=${process.env.NS_TOKEN_KEY.length})` : 'MISSING',
      ns_token_secret:    process.env.NS_TOKEN_SECRET      ? process.env.NS_TOKEN_SECRET.slice(0, 6)      + `...(len=${process.env.NS_TOKEN_SECRET.length})` : 'MISSING',
      ns_fulfillment_script: process.env.NS_FULFILLMENT_SCRIPT_ID || 'MISSING',
      ns_receipt_script:     process.env.NS_RECEIPT_SCRIPT_ID     || 'MISSING',
    }));
    return;
  }

  if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));

    let order;
    try { order = JSON.parse(body); } catch { console.warn('Webhook: invalid JSON'); return; }

    console.log(`\nWebhook received: type=${order?.type} status=${order?.status} ref=${order?.references?.customer}`);

    const type = order?.type?.toUpperCase();
    const handler = type === 'OUTBOUND' ? handleOutbound(order)
                  : type === 'INBOUND'  ? handleInbound(order)
                  : Promise.resolve(console.warn(`Webhook: unknown type "${type}"`));
    handler.catch(err => console.error('Webhook handler crash:', err.message));
  });
});

server.listen(PORT, () => {
  console.log(`CC Webhook server listening on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL || 'not set'}`);
  console.log('Handles OUTBOUND (fulfillment) and INBOUND (receipt) automatically.');
  console.log(`ENV CHECK — NS_ACCOUNT: ${process.env.NS_ACCOUNT || 'MISSING'} | NS_FULFILLMENT_SCRIPT_ID: ${process.env.NS_FULFILLMENT_SCRIPT_ID || 'MISSING'} | NS_TOKEN_KEY: ${process.env.NS_TOKEN_KEY ? process.env.NS_TOKEN_KEY.slice(0,8)+'...' : 'MISSING'}\n`);
});
