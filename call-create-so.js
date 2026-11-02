require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const REST_BASE  = `https://${NS_ACCOUNT}.suitetalk.api.netsuite.com/services/rest`;

const PREFER = { Prefer: 'transient' };

// ── SuiteQL: look up default Not Taxable tax code ────────────────────────────
const DEFAULT_TAX_CODE_ID = process.env.NS_DEFAULT_TAX_CODE_ID || null;

// ── SuiteQL: look up item internal ID by SKU ──────────────────────────────────
async function lookupItemId(sku) {
  const res = await nsRequest('POST', `${REST_BASE}/query/v1/suiteql`, {
    q: `SELECT id FROM item WHERE itemid = '${sku.replace(/'/g, "''")}'`,
  }, PREFER);
  const rows = res.items || res.data || [];
  return rows.length ? Number(rows[0].id) : null;
}

// ── SuiteQL: find existing SO by otherRefNum ──────────────────────────────────
async function findSOByRef(soNumber) {
  const res = await nsRequest('POST', `${REST_BASE}/query/v1/suiteql`, {
    q: `SELECT id FROM transaction WHERE type = 'SalesOrd' AND otherrefnum = '${soNumber.replace(/'/g, "''")}'`,
  }, PREFER);
  const rows = res.items || res.data || [];
  return rows.length ? Number(rows[0].id) : null;
}

// ── format date MM/DD/YYYY for NS REST API ────────────────────────────────────
function fmtDate(d) {
  if (!d) return undefined;
  // Excel serial date (e.g. 46105) → JS Date
  const dt = typeof d === 'number' ? new Date((d - 25569) * 86400 * 1000) : new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 1990) return undefined;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ── create or update SO via REST Records API ──────────────────────────────────
async function createSO(data) {
  // Resolve item IDs
  const lines = [];
  for (const line of (data.lines || [])) {
    if (!line.sku || !line.quantity) continue;
    const itemId = await lookupItemId(line.sku);
    if (!itemId) { console.warn(`SO line skip — SKU not found: ${line.sku}`); continue; }
    const taxCodeId = line.taxCodeId || DEFAULT_TAX_CODE_ID;
    const entry = {
      item:     { id: String(itemId) },
      quantity: Number(line.quantity),
    };
    if (taxCodeId)        entry.taxcode     = { id: String(taxCodeId) };
    if (line.rate)        entry.rate        = Number(line.rate);
    if (line.description) entry.description = line.description;
    if (line.locationId)  entry.location    = { id: String(line.locationId) };
    lines.push(entry);
  }

  const payload = {
    entity:      { id: String(data.nsCustomerId) },
    otherRefNum: data.soNumber,
    item:        { items: lines },
  };
  if (data.subsidiaryId) payload.subsidiary = { id: String(data.subsidiaryId) };
  if (data.locationId)   payload.location   = { id: String(data.locationId) };
  if (data.memo)         payload.memo       = data.memo;
  if (fmtDate(data.tranDate)) payload.tranDate = fmtDate(data.tranDate);
  if (fmtDate(data.shipDate)) payload.shipDate = fmtDate(data.shipDate);
  if (data.autoApprove === 'yes') payload.approvalStatus = { id: '2' };

  // Check for existing SO
  const existingId = await findSOByRef(data.soNumber);
  if (existingId) {
    await nsRequest('PATCH', `${REST_BASE}/record/v1/salesOrder/${existingId}`, payload, PREFER);
    return { success: true, internalId: existingId, action: 'updated' };
  }

  const res = await nsRequest('POST', `${REST_BASE}/record/v1/salesOrder`, payload, PREFER);
  // REST API returns location header with new ID — extract from response or re-query
  const newId = await findSOByRef(data.soNumber);
  return { success: true, internalId: newId, action: 'created' };
}

module.exports = { createSO };
