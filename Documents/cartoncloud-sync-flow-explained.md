# How CartonCloud Sync Works — Step by Step

*Date: 2026-10-20*

---

## Command

```bash
node run.js Data/TP-Info-v2.xlsx --sku=TP-2026-001
```

---

## Step 1 — `run.js` reads the Excel file

`run.js` detects the new multi-sheet format (because the workbook contains a `ProductID` sheet), then merges all 5 sheets into one object per SKU using `sku` as the join key:

```
ProductID row       → sku, displayName, pieceBarcode, piecesPerCarton ...
PurchasingSelling   → costPrice, retailPrice, wholesalePrice ...
InventoryAccounting → weightKg, lengthCm, assetAccountId ...
Integration         → cartonCloudId, nsInternalId ...
Locations           → [ {locationId, reorderPoint, preferredStock}, ... ]
```

All merged into one flat object per item. For TP-2026-001 that object ends up with `cartonCloudId: 'fa7d0067-...'` (because it was filled in the Integration sheet).

---

## Step 2 — `run.js` calls `upsertProduct(item)` from `cartoncloud.js`

For each item in the loop, `run.js` calls:
```js
const ccRes = await upsertProduct(item);
```

---

## Step 3 — `cartoncloud.js` gets a Bearer token

```js
async function getToken() {
  const res = await axios.post(CC_AUTH_URL, {
    grant_type:    'client_credentials',
    client_id:     CC_CLIENT_ID,
    client_secret: CC_CLIENT_SECRET,
  });
  return res.data.access_token;
}
```

- Sends a POST to `https://api.na.cartoncloud.com/uaa/oauth2/token`
- CartonCloud returns a short-lived Bearer token
- The token is **cached in memory** — if you run 100 items, it only authenticates once, not 100 times

---

## Step 4 — `mapItemToCC(item)` builds the CC payload

```js
{
  name:       "Widget A",           // displayName
  references: {
    code:    "TP-2026-001",         // SKU — CC's unique identifier
    barcode: "012345678901",        // pieceBarcode
  },
  measures: {
    weight: 0.5,                    // weightKg
  },
  properties: {
    length: 10,                     // lengthCm
    width:  8,
    height: 5,
  },
  case_qty: 12,                     // piecesPerCarton
  status:   "Active",               // lifecycleStatus
}
```

---

## Step 5 — 3-priority upsert logic (no duplicates)

```
Does item have cartonCloudId in Excel?
    YES → Priority 1: PUT by ID directly
    NO  → Does a product with this SKU already exist in CC?
              YES → Priority 2: PUT by existing ID
              NO  → Priority 3: POST create new
```

For TP-2026-001, `cartonCloudId` was already in the Integration sheet → **Priority 1** was used.

---

## Step 6 — Priority 1: GET the ETag, then PUT

CartonCloud uses **optimistic concurrency** — every PUT must include the product's current `ETag` (a version fingerprint) in the `If-Match` header. Without it, CC returns `400 Bad Request`.

So it does two calls:

**Call 1 — GET** to fetch the current ETag:
```
GET https://api.na.cartoncloud.com/tenants/<id>/products/fa7d0067-...
Headers: Authorization: Bearer <token>
         Accept-Version: 8

← Response headers include: ETag: "abc123xyz"
```

**Call 2 — PUT** to update the product:
```
PUT https://api.na.cartoncloud.com/tenants/<id>/products/fa7d0067-...
Headers: Authorization: Bearer <token>
         Accept-Version: 8
         If-Match: "abc123xyz"
Body: { name, references, measures, properties, case_qty, status }

← Response: updated product object
```

---

## Step 7 — `run.js` captures the result

```js
result.cartoncloud = { status: 'ok', action: 'updated', ccId: 'fa7d0067-...' }
```

Prints to console:
```
CC   OK   TP-2026-001  →  ccId: fa7d0067... (updated)
```

---

## Step 8 — `writeBackIds()` saves IDs back to Excel

After all items finish, `run.js` opens the Excel file again and writes into the `Integration` sheet:
- `cartonCloudId` ← CC UUID (only if the cell was empty — won't overwrite existing)
- `nsInternalId`  ← NetSuite internal ID (same rule)

So next time you run, Priority 1 is used immediately (faster, no search needed).

---

## Summary flow

```
run.js
  ↓ reads Excel → merges 5 sheets → one object per SKU
  ↓ calls upsertProduct(item)
      cartoncloud.js
        ↓ POST /uaa/oauth2/token → get Bearer token (cached)
        ↓ mapItemToCC() → build payload
        ↓ cartonCloudId in Excel?
            YES → GET product → extract ETag
                → PUT product with If-Match: ETag
            NO  → GET all products → search by SKU
                    found?  YES → GET ETag → PUT
                            NO  → POST create new
        ↓ return { ccId, action }
  ↓ write result to output/create-item-result.json
  ↓ write ccId + nsInternalId back into Integration sheet
```
