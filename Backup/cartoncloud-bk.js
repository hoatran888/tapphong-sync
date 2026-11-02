// cartoncloud.js
require('dotenv').config();
const axios = require('axios');

// CC_BASE_URL points directly to the products endpoint
// e.g. https://api.na.cartoncloud.com/tenants/<id>/products
const CC_PRODUCTS   = process.env.CC_BASE_URL;
const CC_WAREHOUSE  = (process.env.CC_BASE_URL || '').replace('/products', '/warehouse-products');
const CC_INBOUND    = (process.env.CC_BASE_URL || '').replace('/products', '/inbound-orders');
const CC_AUTH_URL   = process.env.CC_AUTH_URL  || 'https://api.na.cartoncloud.com/uaa/oauth2/token';
const CLIENT_ID     = process.env.CC_CLIENT_ID;
const CLIENT_SECRET = process.env.CC_CLIENT_SECRET;
const CC_CUSTOMER_ID  = process.env.CC_CUSTOMER_ID  || '';
const CC_WAREHOUSE_ID = process.env.CC_WAREHOUSE_ID || '';

// ── token cache ───────────────────────────────────────────────────────────────
let cachedToken = { value: null, expiresAt: 0 };

async function getToken() {
  if (Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;

  const res = await axios.post(
    CC_AUTH_URL,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  cachedToken = {
    value:     res.data.access_token,
    expiresAt: Date.now() + (res.data.expires_in || 3600) * 1000,
  };
  return cachedToken.value;
}

// ── field mapping ─────────────────────────────────────────────────────────────
function mapItemToCC(item) {
  
  return {
    name:       item.displayName,
    references: {
      code:    item.sku,
      barcode: item.barcode || undefined,
    },
    measures: {
      weight: item.weightKg || undefined,
    },
    properties: {
      length: item.lengthCm || undefined,
      width:  item.widthCm  || undefined,
      height: item.heightCm || undefined,
    },
    case_qty: item.piecesPerCarton || item.casePackQty,
    status:   item.lifecycleStatus,
  };
}

// ── fetch one product by ID, returning body + ETag ────────────────────────────
async function getProductById(id, headers) {
  const res = await axios.get(`${CC_PRODUCTS}/${id}`, { headers });
  const etag = res.headers['etag'] || res.headers['ETag'] || '';
  return { product: res.data, etag };
}

// ── find existing product by SKU ──────────────────────────────────────────────
async function findProductBySku(sku, headers) {
  try {
    const res = await axios.get(CC_PRODUCTS, { headers, params: { sku } });
    const items = res.data?.data || res.data || [];
    return Array.isArray(items) ? items.find(p => p.references?.code === sku) : null;
  } catch {
    return null;
  }
}

// ── upsert product — no duplicates ────────────────────────────────────────────
async function upsertProduct(item) {
  const token   = await getToken();
  const headers = {
    Authorization:    `Bearer ${token}`,
    'Accept-Version': '8',
  };
  const payload = mapItemToCC(item);

  // Priority 1: use cartonCloudId from Excel if provided
  if (item.cartonCloudId) {
    const { etag } = await getProductById(item.cartonCloudId, headers);
    console.log('CC   PUT PAYLOAD:', JSON.stringify(payload));
    const res = await axios.put(
      `${CC_PRODUCTS}/${item.cartonCloudId}`,
      payload,
      { headers: { ...headers, 'If-Match': etag } }
    );
    console.log('CC   PUT RESPONSE:', JSON.stringify(res.data));
    return { ccId: item.cartonCloudId, action: 'updated', data: res.data };
  }

  // Priority 2: search by SKU to avoid duplicate creation
  const existing = await findProductBySku(item.sku, headers);
  if (existing) {
    const { etag } = await getProductById(existing.id, headers);
    const res = await axios.put(
      `${CC_PRODUCTS}/${existing.id}`,
      payload,
      { headers: { ...headers, 'If-Match': etag } }
    );
    return { ccId: existing.id, action: 'updated', data: res.data };
  }

  // Priority 3: create new
  console.log('CC   PAYLOAD:', JSON.stringify(payload));
  const res = await axios.post(CC_PRODUCTS, payload, { headers });
  console.log('CC   RAW CREATE:', JSON.stringify(res.data));
  const ccId = res.data?.id ?? res.data?.data?.id ?? res.data?.product_id;
  return { ccId, action: 'created', data: res.data };
}

// ── warehouse product ─────────────────────────────────────────────────────────
function mapItemToWarehouse(item) {
  return {
    references: { code: item.sku, barcode: item.barcode || undefined },
    name:       item.displayName || item.sku,
    type:       'General',
    scope:      'WAREHOUSE',
    customer:   { id: CC_CUSTOMER_ID },
    warehouses: CC_WAREHOUSE_ID ? [{ id: CC_WAREHOUSE_ID }] : [],
    defaultUnitOfMeasure: 'E',
    unitOfMeasures: {
      E: {
        name:                'Each',
        baseQty:             1,
        weight:              item.weightKg || 0,
        isDecimal:           false,
        isDirectlyShippable: false,
      },
    },
  };
}

async function findWarehouseProductBySku(sku, headers) {
  try {
    const res   = await axios.get(CC_WAREHOUSE, { headers, params: { code: sku } });
    const items = res.data?.data || res.data || [];
    return Array.isArray(items) ? items.find(p => p.references?.code === sku) : null;
  } catch { return null; }
}

async function upsertWarehouseProduct(item) {
  const token   = await getToken();
  const headers = { Authorization: `Bearer ${token}`, 'Accept-Version': '8', 'Content-Type': 'application/json' };
  const payload = mapItemToWarehouse(item);

  const existing = await findWarehouseProductBySku(item.sku, headers);
  if (existing) {
    const res = await axios.patch(`${CC_WAREHOUSE}/${existing.id}`, payload, { headers });
    return { ccWarehouseId: existing.id, action: 'updated' };
  }
  const res = await axios.post(CC_WAREHOUSE, payload, { headers });
  const ccWarehouseId = res.data?.id ?? res.data?.data?.id;
  return { ccWarehouseId, action: 'created' };
}

// ── normalise Excel units → CC warehouse UOM key ──────────────────────────────
const UOM_MAP = { '': 'E', EA: 'E', EACH: 'E', PCS: 'E', PC: 'E', UNIT: 'E' };
function toCcUom(unit) { return UOM_MAP[(unit || '').toUpperCase()] || (unit || 'E').toUpperCase(); }

// ── map PO data → CartonCloud inbound order payload ───────────────────────────
function mapPoToInbound(po) {
  const customerId = po.ccCustomerId || CC_CUSTOMER_ID;
  return {
    type:   'INBOUND',
    status: 'NOT_YET_RECEIVED',
    references: { customer: po.poNumber },
    customer:   { id: customerId },
    details: {
      arrivalDate:  po.shipDate   || po.tranDate || undefined,
      instructions: po.memo       || undefined,
    },
    items: (po.lines || []).map(line => ({
      details: {
        product:       { references: { code: line.sku } },
        unitOfMeasure: { type: toCcUom(line.units) },
      },
      measures: { quantity: Number(line.quantity) },
    })),
  };
}

// ── find existing inbound order by PO reference ───────────────────────────────
async function findInboundOrderByRef(poNumber, headers) {
  try {
    const res   = await axios.post(
      `${CC_INBOUND}/search`,
      { condition: { type: 'AndCondition', conditions: [] } },
      { headers: { ...headers, 'Content-Type': 'application/json' } },
    );
    const items = res.data?.data || res.data || [];
    return Array.isArray(items)
      ? items.find(o => o.references?.customer === poNumber) ?? null
      : null;
  } catch {
    return null;
  }
}

// ── create inbound order (skip if already exists) ─────────────────────────────
async function upsertInboundOrder(po) {
  const token   = await getToken();
  const headers = {
    Authorization:    `Bearer ${token}`,
    'Accept-Version': '8',
    'Content-Type':   'application/json',
  };

  const existing = await findInboundOrderByRef(po.poNumber, headers);
  if (existing) {
    return { ccId: existing.id, action: 'exists', poNumber: po.poNumber };
  }

  const payload = mapPoToInbound(po);
  const res     = await axios.post(CC_INBOUND, payload, { headers });
  const ccId    = res.data?.id ?? res.data?.data?.id;
  return { ccId, action: 'created', poNumber: po.poNumber };
}

module.exports = { upsertProduct, upsertWarehouseProduct, upsertInboundOrder };
