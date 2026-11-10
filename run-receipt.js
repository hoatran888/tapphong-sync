require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { getVerifiedInboundOrders } = require('./cartoncloud');
const { createReceipt }            = require('./call-create-receipt');

const OUTPUT_DIR   = path.join(__dirname, 'output');
const OUTPUT_FILE  = path.join(OUTPUT_DIR, 'receipt-result.json');
const WEBHOOK_PORT = Number(process.env.RECEIPT_WEBHOOK_PORT || 3001);

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

async function processReceipt(poNumber, ccId) {
  console.log(`Processing receipt for ${poNumber} (CC: ${ccId})`);
  try {
    const res = await createReceipt(poNumber);
    if (!res.success) throw new Error(res.error);
    console.log(`NS   OK   ${poNumber}  →  receipt internalId: ${res.internalId} (${res.action})`);
    return { poNumber, ccId, status: 'ok', internalId: res.internalId, action: res.action };
  } catch (err) {
    console.error(`NS   ERR  ${poNumber}  →  ${err.message}`);
    return { poNumber, ccId, status: 'error', error: err.message };
  }
}

function saveResult(result) {
  const existing = fs.existsSync(OUTPUT_FILE) ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) : [];
  const idx = existing.findIndex(r => r.poNumber === result.poNumber);
  if (idx >= 0) existing[idx] = result; else existing.push(result);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
}

async function runPoll(filterPOs = null) {
  console.log('Polling CartonCloud for verified inbound orders...\n');
  let orders = await getVerifiedInboundOrders();
  if (orders.length === 0) { console.log('No verified inbound orders found.'); return; }

  if (filterPOs) {
    orders = orders.filter(o => filterPOs.includes(o.references?.customer));
    if (orders.length === 0) {
      console.log(`No verified orders found matching: ${filterPOs.join(', ')}`);
      return;
    }
    console.log(`Filtered to ${orders.length} order(s): ${filterPOs.join(', ')}\n`);
  } else {
    console.log(`Found ${orders.length} verified order(s).\n`);
  }

  for (const order of orders) {
    const poNumber = order.references?.customer;
    if (!poNumber) { console.warn(`Skipping order ${order.id} — no customer reference`); continue; }
    if (!poNumber.startsWith('PO-')) { console.warn(`Skipping order ${order.id} — not our PO format: ${poNumber}`); continue; }
    const result = await processReceipt(poNumber, order.id);
    saveResult(result);
    console.log('');
  }
  console.log(`Results saved to: ${OUTPUT_FILE}`);
}

function runWebhook() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405); res.end('Method Not Allowed'); return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));

      let payload;
      try { payload = JSON.parse(body); } catch { console.warn('Webhook: invalid JSON'); return; }

      console.log(`Webhook received: ${JSON.stringify(payload).slice(0, 200)}`);

      const order    = payload?.data || payload;
      const status   = order?.status || payload?.event;
      const poNumber = order?.references?.customer;

      if (!poNumber) { console.warn('Webhook: no poNumber found in payload'); return; }
      if (!['VERIFIED', 'RECEIVED'].includes(status?.toUpperCase?.())) {
        console.log(`Webhook: skipping status "${status}" for ${poNumber}`);
        return;
      }

      const result = await processReceipt(poNumber, order?.id);
      saveResult(result);
    });
  });

  server.listen(WEBHOOK_PORT, () => {
    console.log(`Webhook server listening on port ${WEBHOOK_PORT}`);
    console.log(`Configure CC to POST to: http://<your-server>:${WEBHOOK_PORT}/`);
    console.log('Waiting for events...\n');
  });
}

const mode      = process.argv.find(a => a === '--webhook') ? 'webhook' : 'poll';
const poFlag    = process.argv.find(a => a.startsWith('--po='));
const filterPOs = poFlag ? poFlag.split('=')[1].split(',').map(s => s.trim()) : null;

if (mode === 'webhook') {
  runWebhook();
} else {
  runPoll(filterPOs).catch(err => { console.error(err.message); process.exit(1); });
}
