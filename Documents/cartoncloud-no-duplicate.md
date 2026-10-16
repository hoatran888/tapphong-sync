# CartonCloud — Prevent Duplicate Products

## How it works

The upsert logic checks in three steps before creating a new product:

```
1. cartonCloudId in Excel?   → PUT update using that ID
2. SKU already exists in CC? → PUT update using found ID
3. Neither?                  → POST create new
```

---

## cartoncloud.js

```javascript
// cartoncloud.js
require('dotenv').config();
const axios = require('axios');

const CC_BASE       = process.env.CC_BASE_URL  || 'https://app.na.cartoncloud.com/Tap_Phong/api/v2';
const CC_AUTH_URL   = CC_BASE.replace('/api/v2', '/oauth/token');
const CLIENT_ID     = process.env.CC_CLIENT_ID;
const CLIENT_SECRET = process.env.CC_CLIENT_SECRET;

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
    sku:         item.sku,
    barcode:     item.barcode,
    description: item.displayName,
    uom:         item.uomInternalId,
    weight_kg:   item.weightKg,
    length_cm:   item.lengthCm,
    width_cm:    item.widthCm,
    height_cm:   item.heightCm,
    case_qty:    item.casePackQty,
    status:      item.lifecycleStatus,
  };
}

// ── find existing product by SKU ──────────────────────────────────────────────
async function findProductBySku(sku, headers) {
  try {
    const res = await axios.get(`${CC_BASE}/products`, {
      headers,
      params: { sku },
    });
    const items = res.data?.data || res.data || [];
    return Array.isArray(items) ? items.find(p => p.sku === sku) : null;
  } catch {
    return null;
  }
}

// ── upsert product — no duplicates ────────────────────────────────────────────
async function upsertProduct(item) {
  const token   = await getToken();
  const headers = { Authorization: `Bearer ${token}` };
  const payload = mapItemToCC(item);

  // Priority 1: use cartonCloudId from Excel if provided
  if (item.cartonCloudId) {
    const res = await axios.put(
      `${CC_BASE}/products/${item.cartonCloudId}`,
      payload,
      { headers }
    );
    return { ccId: item.cartonCloudId, action: 'updated', data: res.data };
  }

  // Priority 2: search by SKU to avoid duplicate creation
  const existing = await findProductBySku(item.sku, headers);
  if (existing) {
    const res = await axios.put(
      `${CC_BASE}/products/${existing.id}`,
      payload,
      { headers }
    );
    return { ccId: existing.id, action: 'updated', data: res.data };
  }

  // Priority 3: create new
  const res = await axios.post(`${CC_BASE}/products`, payload, { headers });
  return { ccId: res.data.id, action: 'created', data: res.data };
}

module.exports = { upsertProduct };
```

---

## .env keys required

```
CC_CLIENT_ID=your_client_id
CC_CLIENT_SECRET=your_client_secret
CC_BASE_URL=https://app.na.cartoncloud.com/Tap_Phong/api/v2
```

---

## Run

```bash
node run.js Data/TP-Info.xlsx itemInventory
```

---

*Generated: 2026-10-15*
