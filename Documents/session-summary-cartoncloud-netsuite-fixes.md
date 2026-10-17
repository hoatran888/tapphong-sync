# Session Summary — CartonCloud & NetSuite Fixes

*Date: 2026-10-15 / 2026-10-16*

---

## 1. CartonCloud OAuth2 Token URL Fix

**Problem:** `CC_AUTH_URL` was derived from `CC_BASE_URL` by replacing `/api/v2` with `/oauth/token`, producing the wrong URL and returning an HTML login page.

**Fix:** Added a separate `CC_AUTH_URL` in `.env`:
```
CC_AUTH_URL=https://api.na.cartoncloud.com/uaa/oauth2/token
```

Updated `cartoncloud.js` to read it directly:
```javascript
const CC_AUTH_URL = process.env.CC_AUTH_URL || 'https://api.na.cartoncloud.com/uaa/oauth2/token';
```

---

## 2. CartonCloud API Base URL & Tenant UUID

**Correct CC_BASE_URL format:**
```
CC_BASE_URL=https://api.na.cartoncloud.com/tenants/<uuid>/products
```

The tenant UUID is found in CartonCloud under:
**Settings → Edit Organisation Settings → UUID field at the bottom**

Example:
```
CC_BASE_URL=https://api.na.cartoncloud.com/tenants/a7c1da62-9b36-4398-a033-82bf9ce3cffe/products
```

Since `CC_BASE_URL` already ends with `/products`, `cartoncloud.js` uses it directly (no appending).

---

## 3. CartonCloud Accept-Version Header

**Problem:** API returned `400 - Accept-Version header is required`

**Fix:** Added to all CC API requests:
```javascript
const headers = {
  Authorization:    `Bearer ${token}`,
  'Accept-Version': '8',
};
```

---

## 4. CartonCloud API Client Permissions

**Problem:** `403 Access Denied` on products endpoint.

**Fix:** In CartonCloud → Settings → API Clients → Edit your client, enable:
- ✅ WMS Add Product
- ✅ WMS Edit Product
- ✅ TMS Add/Edit Product

---

## 5. CartonCloud Field Mapping Fixes

**Problem:** CC required specific field names — wrong names were silently ignored.

**Required fields discovered through trial and error:**

| Field | CC API field | Notes |
|---|---|---|
| Product name | `name` | Top-level |
| SKU / code | `references.code` | Inside `references` object — required |
| Barcode | `references.barcode` | Inside `references` object |
| Weight | `measures.weight` | Inside `measures` object (kg) |
| Length | `properties.length` | Inside `properties` object (cm) |
| Width | `properties.width` | Inside `properties` object (cm) |
| Height | `properties.height` | Inside `properties` object (cm) |
| Case qty | `case_qty` | Top-level |
| Status | `status` | Top-level |

**Final `mapItemToCC` function:**
```javascript
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
    case_qty: item.casePackQty,
    status:   item.lifecycleStatus,
  };
}
```

---

## 6. CartonCloud If-Match Header for PUT (Updates)

**Problem:** `400 - Missing If-Match header` when updating existing products.

**Cause:** CartonCloud uses optimistic concurrency — every PUT requires the product's current ETag.

**Fix:** GET the product first to retrieve the ETag, then include it in the PUT:
```javascript
async function getProductById(id, headers) {
  const res = await axios.get(`${CC_PRODUCTS}/${id}`, { headers });
  const etag = res.headers['etag'] || res.headers['ETag'] || '';
  return { product: res.data, etag };
}

// In PUT:
const { etag } = await getProductById(id, headers);
await axios.put(url, payload, { headers: { ...headers, 'If-Match': etag } });
```

---

## 7. NetSuite Retail Price Fix (Price Sublist)

**Problem:** `baseprice` direct field didn't update retail price on existing items. `getLineCount` returned `-1` when using `isDynamic: true`.

**Root cause:** The price sublist is a "static sublist" in NetSuite — `isDynamic: true` mode returns `-1` for `getLineCount`.

**Fix:** Switch to `isDynamic: false` and use `setSublistValue`. Find the Base Price line by name:
```javascript
const item = record.load({ type: record.Type.INVENTORY_ITEM, id: existingId, isDynamic: false });

if (data.retailPrice) {
  const price     = Number(data.retailPrice);
  const lineCount = item.getLineCount({ sublistId: 'price' });
  for (let i = 0; i < lineCount; i++) {
    const levelText = item.getSublistText({ sublistId: 'price', fieldId: 'pricelevel', line: i });
    if (levelText === 'Base Price') {
      item.setSublistValue({ sublistId: 'price', fieldId: 'price', line: i, value: price });
      break;
    }
  }
}
```

---

## 8. CC UUID Write-Back to Excel

**Feature added:** After a successful CartonCloud create, the CC UUID is automatically written back into the `cartonCloudId` column of the Excel file.

**Why:** On the next run, the code uses Priority 1 (PUT by ID) instead of searching by SKU — guaranteed update, no duplicates.

**Logic in `run.js`:**
- Only writes if cell is currently empty
- Reads the workbook fresh, finds header columns by name, updates cells, saves

---

## 9. Single SKU Update via Command Line

**Usage:**
```bash
# Update all items
node run.js Data/TP-Info.xlsx itemInventory

# Update one SKU only
node run.js Data/TP-Info.xlsx itemInventory TP-88001
```

The third argument filters to only process that SKU.

---

## 10. NetSuite Field Locations in UI

| Excel Column | NetSuite Field | Tab |
|---|---|---|
| `sku` | Item Name/Number | Primary Information |
| `displayName` | Display Name/Code | Primary Information |
| `barcode` | UPC Code | Primary Information |
| `costPrice` | Purchase Price | Purchasing/Inventory |
| `casePackQty` | Reorder Multiple | Purchasing/Inventory |
| `retailPrice` | Base Price | Sales/Pricing → Pricing |
| `assetAccountId` | Asset Account | Accounting |
| `incomeAccountId` | Income Account | Accounting |
| `cogsAccountId` | COGS Account | Accounting |
| `weightKg`, `lengthCm`, `widthCm`, `heightCm` | Weight/Dimensions | Requires Shipping feature |

**Note:** `retailPrice`, `costPrice`, `assetAccount`, `incomeAccount`, `cogsAccount` are **NetSuite-only** fields — CartonCloud is a WMS and has no concept of pricing or accounting.

---

## 11. GitHub Repository

Project saved to: **https://github.com/hoatran888/tapphong-sync** (private)

**Excluded from GitHub** (sensitive/generated):
- `.env` — API credentials
- `node_modules/` — dependencies
- `output/` — generated results
- `Data/` — Excel files

**To clone on another computer:**
```bash
git clone https://github.com/hoatran888/tapphong-sync.git
cd tapphong-sync
npm install
# Manually create .env with credentials
mkdir Data
# Copy TP-Info.xlsx into Data/
node run.js Data/TP-Info.xlsx itemInventory
```

**Sync changes between computers:**
```bash
git add . && git commit -m "description" && git push   # save changes
git pull                                                # get latest
```

---

*Generated: 2026-10-16*
