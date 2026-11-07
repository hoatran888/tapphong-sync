require('dotenv').config();
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const { updateDeliveryStatus } = require('./call-update-delivery-status');

const STATE_FILE      = path.join(__dirname, 'output', 'delivery-poll-state.json');
const CC_AUTH_URL     = process.env.CC_AUTH_URL;
const CC_TENANT_ID    = process.env.CC_TENANT_ID;
const CC_CONSIGNMENTS = `https://api.na.cartoncloud.com/tenants/${CC_TENANT_ID}/consignments`;

// Map CC consignment status → NS delivery status
const STATUS_MAP = {
  DELIVERED:              'DELIVERED',
  COLLECTED:              'DELIVERED',
  DELIVERED_TO_WAREHOUSE: 'DELIVERED',
  CANCELLED:              'FAILED',
  RETURNED:               'FAILED',
};

async function getFulfillmentToken() {
  const res = await axios.post(CC_AUTH_URL, new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.CC_FULFILLMENT_CLIENT_ID,
    client_secret: process.env.CC_FULFILLMENT_CLIENT_SECRET,
  }));
  return res.data.access_token;
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return { processed: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function poll() {
  const token   = await getFulfillmentToken();
  const headers = { Authorization: `Bearer ${token}`, 'Accept-Version': '8', 'Content-Type': 'application/json' };

  // Paginate through all consignments
  let items = [];
  let page = 0;
  while (true) {
    const res = await axios.post(`${CC_CONSIGNMENTS}/search?page=${page}&size=50`, {
      condition: { type: 'AndCondition', conditions: [] }
    }, { headers });
    const data = res.data?.content || (Array.isArray(res.data) ? res.data : []);
    items = items.concat(data);
    if (data.length < 50) break;
    page++;
  }
  const state = loadState();
  let updated = 0;

  console.log(`[poll] fetched ${items.length} consignments`);

  for (const c of items) {
    const nsStatus = STATUS_MAP[c.status];
    if (!nsStatus) continue;                               // skip non-terminal statuses

    const soNumber = c.references?.customer;
    if (!soNumber || !soNumber.startsWith('SO-')) continue; // only outbound SOs

    const key = `${c.id}:${c.version}`;
    if (state.processed[key]) continue;                    // already synced

    const date = c.timestamps?.delivered?.time
      ? c.timestamps.delivered.time.split('T')[0]
      : new Date().toISOString().split('T')[0];

    console.log(`[poll] ${soNumber}  status=${c.status}  date=${date}`);
    try {
      const r = await updateDeliveryStatus(soNumber, { status: nsStatus, date });
      console.log(`[poll] NS OK  ${soNumber}  →  ${r.memo}`);
      state.processed[key] = new Date().toISOString();
      updated++;
    } catch (err) {
      console.error(`[poll] NS ERR ${soNumber}  →  ${err.message}`);
    }
  }

  saveState(state);
  console.log(`[poll] done — checked ${items.length} consignments, updated ${updated}`);
}

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function run() {
  try { await poll(); } catch (err) { console.error('[poll] fatal:', err.message); }
  setTimeout(run, INTERVAL_MS);
}

console.log(`[poll] starting — polling every ${INTERVAL_MS / 60000} min`);
run();
