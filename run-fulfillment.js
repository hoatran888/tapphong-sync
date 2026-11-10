require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { getDispatchedOutboundOrders } = require('./cartoncloud');
const { createFulfillment }           = require('./call-create-fulfillment');

const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'fulfillment-result.json');
const WEBHOOK_PORT = Number(process.env.FULFILLMENT_WEBHOOK_PORT || 3000);

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// ── process one dispatched CC order → NS fulfillment ─────────────────────────
async function processFulfillment(soNumber, ccId) {
  console.log(`Processing fulfillment for ${soNumber} (CC: ${ccId})`);
  try {
    const res = await createFulfillment(soNumber);
    if (!res.success) throw new Error(res.error);
    console.log(`NS   OK   ${soNumber}  →  fulfillment internalId: ${res.internalId} (${res.action})`);
    return { soNumber, ccId, status: 'ok', internalId: res.internalId, action: res.action };
  } catch (err) {
    console.error(`NS   ERR  ${soNumber}  →  ${err.message}`);
    return { soNumber, ccId, status: 'error', error: err.message };
  }
}

function saveResult(result) {
  const existing = fs.existsSync(OUTPUT_FILE) ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) : [];
  const idx = existing.findIndex(r => r.soNumber === result.soNumber);
  if (idx >= 0) existing[idx] = result; else existing.push(result);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
}

// ── poll mode: fetch all dispatched CC orders and sync to NS ──────────────────
async function runPoll(filterSOs = null) {
  console.log('Polling CartonCloud for dispatched outbound orders...\n');
  let orders = await getDispatchedOutboundOrders();
  if (orders.length === 0) { console.log('No dispatched orders found.'); return; }

  if (filterSOs) {
    orders = orders.filter(o => filterSOs.includes(o.references?.customer));
    if (orders.length === 0) {
      console.log(`No dispatched orders found matching: ${filterSOs.join(', ')}`);
      return;
    }
    console.log(`Filtered to ${orders.length} order(s): ${filterSOs.join(', ')}\n`);
  } else {
    console.log(`Found ${orders.length} dispatched order(s).\n`);
  }

  for (const order of orders) {
    const soNumber = order.references?.customer;
    if (!soNumber) { console.warn(`Skipping order ${order.id} — no customer reference`); continue; }
    const result = await processFulfillment(soNumber, order.id);
    saveResult(result);
    console.log('');
  }
  console.log(`Results saved to: ${OUTPUT_FILE}`);
}

// ── webhook mode: HTTP server that receives CC webhook events ─────────────────
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

      // Extract soNumber from CC webhook payload
      // CC sends order data — reference is in references.customer
      const order    = payload?.data || payload;
      const status   = order?.status || payload?.event;
      const soNumber = order?.references?.customer;

      if (!soNumber) { console.warn('Webhook: no soNumber found in payload'); return; }
      if (!['DISPATCHED', 'DELIVERED', 'COLLECTED'].includes(status?.toUpperCase?.())) {
        console.log(`Webhook: skipping status "${status}" for ${soNumber}`);
        return;
      }

      const result = await processFulfillment(soNumber, order?.id);
      saveResult(result);
    });
  });

  server.listen(WEBHOOK_PORT, () => {
    console.log(`Webhook server listening on port ${WEBHOOK_PORT}`);
    console.log(`Configure CC to POST to: http://<your-server>:${WEBHOOK_PORT}/`);
    console.log('Waiting for events...\n');
  });
}

// ── entry point ───────────────────────────────────────────────────────────────
const mode      = process.argv.find(a => a === '--webhook') ? 'webhook' : 'poll';
const soFlag    = process.argv.find(a => a.startsWith('--so='));
const filterSOs = soFlag ? soFlag.split('=')[1].split(',').map(s => s.trim()) : null;

if (mode === 'webhook') {
  runWebhook();
} else {
  runPoll(filterSOs).catch(err => { console.error(err.message); process.exit(1); });
}
