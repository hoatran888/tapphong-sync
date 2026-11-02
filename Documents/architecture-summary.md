# Architecture Summary — NetSuite + CartonCloud Item Sync

*Date: 2026-10-17*

---

## Important Clarification

`rl_create_item.js` only talks to **NetSuite**. It has **no connection to CartonCloud at all**. The two systems are completely separate.

---

## How `rl_create_item.js` interfaces with NetSuite

```
Your Mac
  run.js
    → call-create-item.js       (builds the URL)
      → ns-tba.js               (signs request with OAuth 1.0a)
        → HTTPS POST → NetSuite RESTlet endpoint
                          ↓
                   rl_create_item.js
                   (runs INSIDE NetSuite)
                          ↓
                   N/record, N/search
                   (NetSuite built-in modules)
                          ↓
                   NetSuite database
```

**Step by step:**
1. `run.js` reads a row from Excel and calls `createItem(item)`
2. `call-create-item.js` builds the URL: `https://12222161-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=1942&deploy=1`
3. `ns-tba.js` signs the HTTP request with OAuth 1.0a (TBA) using your consumer key/secret and token key/secret
4. The signed POST hits NetSuite's servers
5. NetSuite authenticates the TBA signature and executes `rl_create_item.js`
6. Inside NS, `rl_create_item.js` uses `N/search` to check if the SKU already exists, then `N/record` to create or update the inventory item
7. Returns `{ success: true, internalId: 234 }` back to `run.js`

---

## How CartonCloud is handled (separately)

```
Your Mac
  run.js
    → cartoncloud.js
        1. POST to https://api.na.cartoncloud.com/uaa/oauth2/token  → get Bearer token
        2. GET  https://api.na.cartoncloud.com/tenants/.../products  → search by SKU
        3. GET  .../products/{id}                                    → get ETag
        4. PUT  .../products/{id}  (If-Match: etag)                  → update
           OR
           POST .../products                                          → create new
```

---

## Comparison Table

| | `rl_create_item.js` | `cartoncloud.js` |
|---|---|---|
| **Runs on** | NetSuite servers | Your Mac |
| **Auth** | TBA (OAuth 1.0a) signed by `ns-tba.js` | OAuth2 client_credentials |
| **API used** | NetSuite `N/record`, `N/search` | CartonCloud REST API |
| **Does** | Creates/updates Inventory Items in NS | Creates/updates Transport Products in CC |
| **Called by** | NetSuite runtime (triggered by HTTP POST) | `run.js` directly |

`run.js` orchestrates both — it calls each system independently per item and reports success/failure for each separately.

---

## Full Project Summary

### Goal
Build a Node.js script that reads product data from an Excel file and syncs it to both **NetSuite** (ERP/accounting) and **CartonCloud** (warehouse) automatically — no Celigo needed.

---

### Architecture Overview

```
Excel/CSV file (TP-Info.xlsx)
        ↓
    run.js
    ↙        ↘
NetSuite    CartonCloud
(via TBA    (via OAuth2
 RESTlet)    client_credentials)
```

---

### Files Built

| File | Purpose |
|---|---|
| `run.js` | Main script — reads Excel, loops through items, calls both systems |
| `ns-tba.js` | Signs NetSuite requests with OAuth 1.0a (TBA) |
| `call-create-item.js` | Builds the NetSuite RESTlet URL and calls it |
| `rl_create_item.js` | NetSuite RESTlet (uploaded to NS File Cabinet) — creates/updates inventory items |
| `cartoncloud.js` | Gets CC OAuth2 token, maps fields, upserts products |

---

### Problems Solved — NetSuite Side

**1. Wrong URL format**
- NS account `12222161_SB1` must become `12222161-sb1` in the URL (underscores → hyphens, lowercase)

**2. 405 Method Not Allowed**
- Suitelets don't support external TBA calls → converted to RESTlet

**3. 400 INSUFFICIENT_PERMISSION**
- RESTlet deployment Audience didn't include Administrator role → fixed in NS UI

**4. Invalid Field Value for `stockunit`**
- Placeholder UOM ID of `1` was sent → skip if ≤ 1

**5. Invalid Field Value for account IDs**
- Placeholder values (123, 456, 789) were sent → skip if ≤ 100

**6. Invalid Field Value for `cogsaccount` (ID 209)**
- Account 209 was restricted to a specific subsidiary → user replaced with correct IDs from Chart of Accounts

**7. Retail price not updating**
- `baseprice` direct field doesn't work on existing items with `isDynamic: true`
- `getLineCount` returns `-1` for the price sublist in dynamic mode
- **Fix:** Switch to `isDynamic: false` and use `setSublistValue`, searching for "Base Price" line by name via `getSublistText`

---

### Problems Solved — CartonCloud Side

**1. HTML login page returned instead of JSON**
- `CC_AUTH_URL` was wrongly derived from `CC_BASE_URL`
- **Fix:** Added separate `CC_AUTH_URL=https://api.na.cartoncloud.com/uaa/oauth2/token` to `.env`

**2. 400 — Accept-Version header required**
- **Fix:** Added `'Accept-Version': '8'` to all CC API requests

**3. 403 — Access Denied**
- API client missing permissions → enabled WMS Add Product, WMS Edit Product, TMS Add/Edit Product

**4. 422 — Name is required / References is required**
- CC doesn't have a top-level `sku` field
- **Fix:** `name` = display name, `references.code` = SKU (required by CC)

**5. 422 — Code is required (`/references/code`)**
- Field inside `references` must be `code` not `sku`

**6. 400 — Missing If-Match header on PUT**
- CC uses optimistic concurrency — every PUT needs the product's current ETag
- **Fix:** GET product first → extract ETag → include `If-Match: <etag>` in PUT

**7. Barcode, weight, dimensions not saving**
- Wrong field names — CC silently ignored them
- Discovered correct structure by manually entering values in CC UI then doing a GET:
  - `references.barcode` = barcode
  - `measures.weight` = weight (kg)
  - `properties.length/width/height` = dimensions (cm)

---

### Features Added to `run.js`

**1. Duplicate prevention**
- Before creating: search CC by SKU (`references.code`)
- If found → PUT update; if not found → POST create

**2. Automatic CC UUID write-back**
- After a successful create, the CC UUID is written back into the `cartonCloudId` column of the Excel file
- Next run uses Priority 1 (PUT by ID) — faster and more reliable

**3. Single SKU filter**
```bash
node run.js Data/TP-Info.xlsx itemInventory TP-88001
```

**4. Priority system for CC updates:**
- Priority 1: `cartonCloudId` in Excel → PUT by ID directly
- Priority 2: Search by SKU → PUT if found
- Priority 3: Not found → POST create new

---

### NetSuite UI Field Locations

| Excel field | NetSuite tab | Field name |
|---|---|---|
| `sku` | Primary Info | Item Name/Number |
| `displayName` | Primary Info | Display Name/Code |
| `barcode` | Primary Info | UPC Code |
| `costPrice` | Purchasing/Inventory | Purchase Price |
| `casePackQty` | Purchasing/Inventory | Reorder Multiple |
| `retailPrice` | Sales/Pricing | Base Price |
| `assetAccountId` | Accounting | Asset Account |
| `incomeAccountId` | Accounting | Income Account |
| `cogsAccountId` | Accounting | COGS Account |

---

### GitHub
- Repo: **https://github.com/hoatran888/tapphong-sync** (public)
- Excluded: `.env`, `node_modules/`, `output/`, `Data/`

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

### Final Working Command
```bash
# Sync all items
node run.js Data/TP-Info.xlsx itemInventory

# Sync one item
node run.js Data/TP-Info.xlsx itemInventory TP-88001
```
**Result: NetSuite 3/3 ok | CartonCloud 3/3 ok**

---

*Generated: 2026-10-17*
