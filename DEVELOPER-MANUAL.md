# Tap Phong — Developer Manual
**Purpose:** Technical reference for developers maintaining the NetSuite + CartonCloud integration  
**Stack:** Node.js, NetSuite REST/RESTlet APIs, CartonCloud REST API  
**Auth:** NetSuite Token-Based Authentication (TBA/OAuth 1.0a), CartonCloud OAuth 2.0 Client Credentials

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Environment Variables (.env)](#2-environment-variables)
3. [Core Modules](#3-core-modules)
4. [Runner Scripts](#4-runner-scripts)
5. [NetSuite RESTlets](#5-netsuite-restlets)
6. [Utility / Fix Scripts](#6-utility--fix-scripts)
7. [Output Files](#7-output-files)
8. [Known Issues & Design Decisions](#8-known-issues--design-decisions)

---

## 1. Architecture Overview

```
Excel / CSV
    │
    ▼
Runner scripts (run-*.js)
    │
    ├── call-create-*.js  ──►  NetSuite RESTlets (SuiteScript 2.1)
    │                              rl_create_po.js
    │                              rl_create_so.js (via REST Record API)
    │                              rl_create_receipt.js
    │                              rl_create_fulfillment.js
    │                              rl_create_invoice.js
    │                              rl_create_inv_adjustment.js
    │
    └── cartoncloud.js    ──►  CartonCloud REST API v8
                                   /inbound-orders
                                   /outbound-orders
                                   /products
                                   /warehouse-products
```

**Authentication:**
- NetSuite: `ns-tba.js` signs every request with OAuth 1.0a HMAC-SHA256
- CartonCloud: `cartoncloud.js` fetches a Bearer token via client_credentials and caches it per run

---

## 2. Environment Variables

All variables are stored in `.env` at the project root. Never commit this file.

### NetSuite

| Variable | Description |
|----------|-------------|
| `NS_ACCOUNT` | NS account ID (e.g. `12222161_SB1`). Underscores are replaced with hyphens in URLs. |
| `NS_CONSUMER_KEY` | OAuth consumer key from NS Integration record |
| `NS_CONSUMER_SECRET` | OAuth consumer secret |
| `NS_TOKEN_KEY` | Access token key |
| `NS_TOKEN_SECRET` | Access token secret |
| `NS_DEFAULT_LOCATION_ID` | Default inventory location internal ID |
| `NS_DEFAULT_TAX_CODE_ID` | Default tax code internal ID (used in SO lines) |
| `NS_PO_SCRIPT_ID` | RESTlet script ID for PO creation |
| `NS_PO_DEPLOY_ID` | RESTlet deployment ID (default: `1`) |
| `NS_RECEIPT_SCRIPT_ID` | RESTlet script ID for Item Receipt creation |
| `NS_RECEIPT_DEPLOY_ID` | RESTlet deployment ID (default: `1`) |
| `NS_FULFILLMENT_SCRIPT_ID` | RESTlet script ID for Item Fulfillment creation |
| `NS_FULFILLMENT_DEPLOY_ID` | RESTlet deployment ID (default: `1`) |
| `NS_INVOICE_SCRIPT_ID` | RESTlet script ID for Invoice creation |
| `NS_INVOICE_DEPLOY_ID` | RESTlet deployment ID (default: `1`) |
| `NS_INV_ADJUSTMENT_SCRIPT_ID` | RESTlet script ID for Inventory Adjustment |
| `NS_INV_ADJUSTMENT_DEPLOY_ID` | RESTlet deployment ID (default: `1`) |
| `NS_ADJ_ACCOUNT_CYCLE_COUNT` | GL account internal ID for cycle count adjustments |
| `NS_ADJ_ACCOUNT_DAMAGED` | GL account internal ID for damaged stock adjustments |
| `NS_ADJ_ACCOUNT_LOST` | GL account internal ID for lost stock adjustments |
| `NS_ADJ_ACCOUNT_FOUND` | GL account internal ID for found stock adjustments |
| `NS_ADJ_ACCOUNT_WRITE_OFF` | GL account internal ID for write-off adjustments |

### CartonCloud

| Variable | Description |
|----------|-------------|
| `CC_AUTH_URL` | OAuth token endpoint (e.g. `https://api.na.cartoncloud.com/uaa/oauth2/token`) |
| `CC_CLIENT_ID` | CartonCloud OAuth client ID |
| `CC_CLIENT_SECRET` | CartonCloud OAuth client secret |
| `CC_BASE_URL` | Base URL ending in `/products` (e.g. `https://api.na.cartoncloud.com/.../products`) |
| `CC_TENANT_ID` | CartonCloud tenant ID |
| `CC_WAREHOUSE_ID` | CartonCloud warehouse UUID for stock queries |

---

## 3. Core Modules

### 3.1 `ns-tba.js` — NetSuite HTTP client

Signs every request with OAuth 1.0a HMAC-SHA256 and sends it via axios.

**Function:** `nsRequest(method, url, body, extraHeaders)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | string | HTTP verb: `GET`, `POST`, `PATCH`, `DELETE` |
| `url` | string | Full URL including query parameters |
| `body` | object\|null | JSON request body (omit or `null` for GET/DELETE) |
| `extraHeaders` | object | Additional headers (e.g. `{ Prefer: 'transient' }` for SuiteQL) |

**Returns:** Parsed JSON response body  
**Throws:** Error with message `NS {status}: {body}` on non-2xx responses

**Notes:**
- Appends `realm="{NS_ACCOUNT}"` to the Authorization header as required by NS
- `maxRedirects: 0` prevents axios from following NS redirects silently

---

### 3.2 `cartoncloud.js` — CartonCloud API client

Authenticates once per process run and exposes functions for inbound/outbound order management and product sync.

**Key functions:**

#### `upsertInboundOrder(po)`
Creates or updates a CartonCloud inbound order from PO data.  
- Checks for existing order by `references.customer = po.poNumber`
- If existing and status is not `REJECTED`: returns `{ action: 'exists' }`
- If existing and status is `REJECTED`: deletes and recreates
- Maps PO lines to CC product items using SKU lookup

**Input object fields:**

| Field | Description |
|-------|-------------|
| `poNumber` | Used as CC order reference (`references.customer`) |
| `ccCustomerId` | CC customer UUID (product owner) |
| `shipDate` | Expected arrival date |
| `memo` | Order notes |
| `lines[]` | Array of `{ sku, quantity, units }` |

---

#### `upsertOutboundOrder(so)`
Creates or updates a CartonCloud outbound order from SO data.  
- Checks for existing order by `references.customer = so.soNumber`
- If existing and status is `REJECTED`: deletes and recreates
- Requires `companyName` in deliver address object even when address `id` is provided

**Input object fields:**

| Field | Description |
|-------|-------------|
| `soNumber` | Used as CC order reference (`references.customer`) |
| `ccCustomerId` | CC customer UUID (must match product owner) |
| `ccDeliverAddressId` | CC address UUID (must be a valid UUID, not a number) |
| `customerName` | Used as `companyName` in deliver address |
| `lines[]` | Array of `{ sku, quantity, units }` |

---

#### `getDispatchedOutboundOrders()`
Returns all CC outbound orders with status `DISPATCHED` or `DELIVERED`.  
Used by `run-fulfillment.js` to find orders ready for NS fulfillment.

#### `getVerifiedInboundOrders()`
Returns all CC inbound orders with status `VERIFIED` or `RECEIVED`.  
Used by `run-receipt.js` to find orders ready for NS item receipts.

#### `upsertProduct(item)`
Creates or updates a CartonCloud transport product (product master).

#### `upsertWarehouseProduct(item)`
Creates or updates a CartonCloud warehouse product (links product to warehouse with barcode).

#### `getWarehouseStockBySku(skus)`
Returns current free stock quantity per SKU from CC warehouse.

---

### 3.3 `call-create-po.js`
Thin wrapper — sends the full PO data object to the NS PO RESTlet (`NS_PO_SCRIPT_ID`).

**Input:** PO data object (see PO sheet columns in Operations Manual)  
**Output:** `{ success, internalId, action }` from RESTlet

---

### 3.4 `call-create-so.js`
Creates a Sales Order directly via NS REST Record API (not a RESTlet).

**Key behaviour:**
- Looks up each SKU's NS internal ID via SuiteQL before building the payload
- Checks for existing SO by `otherRefNum` via SuiteQL — if found, issues a `PATCH` (update); if not, issues a `POST` (create)
- **IMPORTANT:** PATCH adds lines to the existing SO rather than replacing them. Running twice will duplicate lines. Use `fix-so-duplicate-lines.js` to repair.

**Input fields used:**

| Field | Maps to NS field |
|-------|-----------------|
| `nsCustomerId` | `entity.id` |
| `soNumber` | `otherRefNum` |
| `subsidiaryId` | `subsidiary.id` |
| `locationId` | `location.id` |
| `tranDate` | `tranDate` |
| `shipDate` | `shipDate` |
| `memo` | `memo` |
| `autoApprove = 'yes'` | `approvalStatus.id = '2'` |
| `lines[].sku` | Resolved to `item.id` via SuiteQL |
| `lines[].quantity` | `quantity` |
| `lines[].rate` | `rate` |
| `lines[].locationId` | `location.id` on line |

---

### 3.5 `call-create-receipt.js`
Sends a receipt request to the NS Receipt RESTlet (`NS_RECEIPT_SCRIPT_ID`).

**Key behaviour:**
- Calls `getVerifiedInboundOrders()` to confirm the CC inbound order is verified before proceeding
- Passes `poNumber` (or `soNumber` if the reference starts with `SO-`) to the RESTlet

**Input:** `poNumber` string, optional `options.ccOrder` (pre-fetched CC order to skip CC API call)

---

### 3.6 `call-create-fulfillment.js`
Sends a fulfillment request to the NS Fulfillment RESTlet (`NS_FULFILLMENT_SCRIPT_ID`).

**Key behaviour:**
- Looks up the **oldest** matching SO internal ID via REST API (sorts ASC by id) to avoid picking stale duplicate SOs with the same `otherRefNum`
- Passes `soId` explicitly to the RESTlet so the RESTlet skips its own `findSOByRef()` lookup
- Passes `force: true` to bypass the RESTlet's existing fulfillment check
- Fetches CC dispatched orders to verify the CC order is dispatched
- Logs RESTlet `diag` array if present (useful for debugging line-matching failures)

**Body sent to RESTlet:**

| Field | Description |
|-------|-------------|
| `soNumber` | SO reference number |
| `soId` | NS SO internal ID (oldest match, prevents wrong-SO bug) |
| `force` | `true` — skips duplicate fulfillment check in RESTlet |
| `locationId` | From `NS_DEFAULT_LOCATION_ID` if set |
| `skus` | Array of SKUs from CC order items |

---

### 3.7 `call-create-invoice.js`
Sends an invoice request to the NS Invoice RESTlet (`NS_INVOICE_SCRIPT_ID`).

**Key behaviour:** Identical soId lookup fix as `call-create-fulfillment.js` — looks up oldest matching SO and passes `soId` directly.

**Body sent to RESTlet:**

| Field | Description |
|-------|-------------|
| `soNumber` | SO reference number |
| `soId` | NS SO internal ID (oldest match) |
| `tranDate` | Optional invoice date override |
| `memo` | Optional memo |

---

### 3.8 `call-create-inv-adjustment.js`
Sends inventory adjustment request to the NS Inv Adjustment RESTlet.

**Input fields:**

| Field | Description |
|-------|-------------|
| `adjustmentType` | `CYCLE_COUNT`, `DAMAGED`, `LOST`, `FOUND`, or `WRITE_OFF` |
| `sku` | Item SKU |
| `newQuantity` | Required for `CYCLE_COUNT` — absolute target quantity |
| `adjustQtyBy` | Required for all other types — positive adds, negative subtracts |
| `locationId` | Optional NS location ID override |
| `accountId` | Optional GL account ID override (defaults to `.env` values by type) |
| `memo` | Optional notes |

---

## 4. Runner Scripts

### 4.1 `run.js` — Item Master Sync

Creates/updates items in NetSuite and CartonCloud.

```
node run.js <file> [options]
```

| Argument | Description |
|----------|-------------|
| `<file>` | Path to Excel (.xlsx) or CSV file |
| `--sku=SKU` | Process only this one SKU |
| `--cc-only` | Update CartonCloud transport product only (skip NS); requires `--sku=` |
| `--check-warehouse` | Read-only audit: compare Excel barcodes vs CartonCloud warehouse barcodes |

**Excel format (multi-sheet):** Merges data from sheets: `ProductID`, `PurchasingSelling`, `InventoryAccounting`, `Integration`, `Locations`.  
**Excel format (single-sheet):** Reads first sheet or named sheet.  
**CSV:** Standard comma-separated with headers.

**What it does:**
1. Reads and deduplicates items by SKU
2. Creates/updates NS inventory item via `call-create-item.js` → RESTlet
3. Creates/updates CC transport product via `upsertProduct()`
4. Creates/updates CC warehouse product via `upsertWarehouseProduct()`
5. Writes NS internal ID, CC product ID, and CC warehouse product ID back to the Excel `Integration` sheet

**Output:** `output/create-item-result.json`

---

### 4.2 `run-po.js` — Purchase Order Creation

```
node run-po.js <file> [--po=PO-2026-001[,PO-2026-002,...]]
```

| Argument | Description |
|----------|-------------|
| `<file>` | Path to Excel file with `PO` sheet |
| `--po=` | Comma-separated PO numbers to process; omit to process all |

**What it does:**
1. Reads and groups `PO` sheet rows by `poNumber`
2. For each PO: calls `createPO()` → NS PO RESTlet, then `upsertInboundOrder()` → CC
3. Both NS and CC are attempted independently; one failure does not block the other
4. Merges results with any existing `output/create-po-result.json`

**Output:** `output/create-po-result.json`

---

### 4.3 `run-so.js` — Sales Order Creation

```
node run-so.js <file> [--so=SO-2026-1001[,SO-2026-1002,...]]
```

| Argument | Description |
|----------|-------------|
| `<file>` | Path to Excel file with `SO` sheet |
| `--so=` | Comma-separated SO numbers to process; omit to process all |

**What it does:**
1. Reads and groups `SO` sheet rows by `soNumber`
2. For each SO: calls `createSO()` → NS REST Record API (PATCH if exists, POST if new), then `upsertOutboundOrder()` → CC

**⚠️ Critical:** `call-create-so.js` PATCHes existing SOs, appending new lines. Running the same SO twice creates duplicate lines. The NS RESTlet is **not** used for SO creation — it goes directly through the REST Record API.

**Output:** `output/create-so-result.json`

---

### 4.4 `run-receipt.js` — Item Receipt from CartonCloud

```
node run-receipt.js [--po=PO-2026-001[,...]]  [--webhook]
```

| Argument | Description |
|----------|-------------|
| `--po=` | Comma-separated PO numbers; omit to process all verified CC inbound orders |
| `--webhook` | Start HTTP webhook server instead of polling (port: `RECEIPT_WEBHOOK_PORT`, default 3001) |

**What it does (poll mode):**
1. Calls `getVerifiedInboundOrders()` to get CC orders with status VERIFIED/RECEIVED
2. Filters by `--po=` if provided (matches on `references.customer`)
3. Skips orders where reference doesn't start with `PO-`
4. Calls `createReceipt(poNumber)` → NS Receipt RESTlet

**What it does (webhook mode):**
- Starts HTTP server; processes receipt when CC POSTs a webhook with status `VERIFIED` or `RECEIVED`

**Output:** `output/receipt-result.json`

---

### 4.5 `run-fulfillment.js` — Item Fulfillment from CartonCloud Dispatch

```
node run-fulfillment.js [<file>] [--so=SO-2026-1001[,...]]  [--webhook]
```

| Argument | Description |
|----------|-------------|
| `--so=` | Comma-separated SO numbers; omit to process all dispatched CC outbound orders |
| `--webhook` | Start HTTP webhook server instead of polling (port: `FULFILLMENT_WEBHOOK_PORT`, default 3000) |

**What it does (poll mode):**
1. Calls `getDispatchedOutboundOrders()` for CC orders with status DISPATCHED/DELIVERED
2. Filters by `--so=` if provided (matches on `references.customer`)
3. Calls `createFulfillment(soNumber)` → NS Fulfillment RESTlet

**Output:** `output/fulfillment-result.json`

---

### 4.6 `run-invoice.js` — Invoice Creation

```
node run-invoice.js --so=SO-2026-1001[,SO-2026-1002,...]
node run-invoice.js SO-2026-1001 SO-2026-1002
```

| Argument | Description |
|----------|-------------|
| `--so=` | Comma-separated SO numbers |
| Positional args | Alternative: SO numbers listed directly (must start with `SO-`) |

**What it does:**
1. For each SO: calls `createInvoice(soNumber)` → NS Invoice RESTlet
2. The RESTlet uses `record.transform()` from SO to Invoice — only fulfilled lines are included

**Output:** `output/invoice-result.json`

---

### 4.7 `run-inv-adjustment.js` — Manual Inventory Adjustment

```
node run-inv-adjustment.js --type=TYPE --sku=SKU [options]
```

| Argument | Required | Description |
|----------|----------|-------------|
| `--type=` | Yes | `CYCLE_COUNT`, `DAMAGED`, `LOST`, `FOUND`, or `WRITE_OFF` |
| `--sku=` | Yes | SKU or comma-separated list of SKUs |
| `--newqty=` | For CYCLE_COUNT | Absolute target quantity after adjustment |
| `--qty=` | For all others | Change amount (negative = reduce, positive = increase) |
| `--location=` | No | NS location internal ID override |
| `--account=` | No | GL account internal ID override |
| `--memo=` | No | Adjustment memo text |

**Type defaults:** If `--type` is omitted but `--newqty` is provided, type defaults to `CYCLE_COUNT`.

**Output:** `output/inv-adjustment-result.json`

---

### 4.8 `reconcile-inventory.js` — Inventory Reconciliation Report

```
node reconcile-inventory.js [--sku=SKU1,SKU2,...]
```

| Argument | Description |
|----------|-------------|
| `--sku=` | Comma-separated SKUs to filter; omit for all SKUs |

**What it does:**
1. Fetches all CC warehouse product stock (paginated, 100 per page)
2. Fetches all NS inventory balances via SuiteQL (`InventoryBalance` table)
3. Merges both lists by SKU and prints a comparison table
4. Status values: `MATCH`, `CC_OVER`, `CC_UNDER`, `CC_ONLY`, `NS_ONLY`
5. Saves CSV report to `output/inventory-reconciliation-YYYY-MM-DD.csv`

**Output:** `output/inventory-reconciliation-YYYY-MM-DD.csv`

---

### 4.9 `run-inbound.js` — CartonCloud Inbound Order Only

```
node run-inbound.js <file> [--po=PO-2026-001]
```

Subset of `run-po.js` — creates CartonCloud inbound orders only (no NetSuite PO creation). Useful when the NS PO already exists and only the CC inbound order needs to be created/updated.

**Output:** `output/create-inbound-result.json`

---

### 4.10 `run-bulk.js`

Empty file — reserved for future bulk operation runner.

---

## 5. NetSuite RESTlets

All RESTlets are SuiteScript 2.1 deployed in NetSuite. Source files are in the project root for reference but changes must be deployed via NS File Cabinet + Script Deployment.

### 5.1 `rl_create_fulfillment.js` (script: `NS_FULFILLMENT_SCRIPT_ID`)

**POST body:**

| Field | Type | Description |
|-------|------|-------------|
| `soNumber` | string | SO reference (used if `soId` not provided) |
| `soId` | number | NS SO internal ID (preferred; bypasses internal lookup) |
| `force` | boolean | Skip existing fulfillment check; default `false` |
| `locationId` | string\|number | Location override |
| `skus` | string[] | Only fulfill lines matching these SKUs; fulfills all if omitted |
| `shipDate` | string | Override ship date (YYYY-MM-DD) |
| `memo` | string | Memo on fulfillment record |

**Behaviour:**
1. Finds SO by `soId` or `findSOByRef(soNumber)` (DESC sort — **known bug**, bypassed by passing `soId`)
2. Unless `force=true`, returns `{ action: 'exists' }` if fulfillment already exists for this SO
3. Calls `record.transform()` SO → ItemFulfillment
4. Sets `itemreceive=true` only for lines matching `skus` filter (all lines if no filter)
5. Sets `shipstatus = 'C'` (Shipped)
6. Saves and returns `{ success, internalId, action: 'created', diag[] }`

**`diag` array** (returned on every call): logs `soId`, `locationId`, `lines count`, per-line item/sku/qty/fulfill — invaluable for debugging empty-line errors.

---

### 5.2 `rl_create_invoice.js` (script: `NS_INVOICE_SCRIPT_ID`)

**POST body:**

| Field | Type | Description |
|-------|------|-------------|
| `soNumber` | string | SO reference |
| `soId` | number | NS SO internal ID (preferred) |
| `tranDate` | string | Invoice date override (YYYY-MM-DD) |
| `memo` | string | Memo on invoice |

**Behaviour:**
1. Finds SO (same DESC sort bug as fulfillment — bypassed by passing `soId`)
2. Returns `{ action: 'exists' }` if invoice already exists for this SO
3. Calls `record.transform()` SO → Invoice
4. Saves with `ignoreMandatoryFields: true`

---

## 6. Utility / Fix Scripts

### 6.1 `fix-so-duplicate-lines.js`

Closes duplicate SO lines caused by running `run-so.js` multiple times. Keeps the first open line per SKU and closes all others.

```
node fix-so-duplicate-lines.js --so=SO-2026-1012[,SO-2026-1013,...]
```

**How it works:**
1. Looks up each SO's internal ID — takes **oldest** match (sort ASC) to avoid stale duplicates
2. Fetches all lines via SuiteQL (`transactionLine` table, `mainline='F'`, `taxline='F'`) — avoids NS REST subresource pagination limit (~10 lines max)
3. Groups open lines by `item` ID; keeps first occurrence per item, closes the rest via `PATCH isclosed=true`

**⚠️ Note:** Closing a line does not reverse fulfillments already created from that line. Use `fix-so-extra-fulfillments.js` to repair inventory after closing duplicate lines.

---

### 6.2 `fix-so-extra-fulfillments.js`

Voids excess Item Fulfillments on a SO. Dry-run by default.

```
node fix-so-extra-fulfillments.js --so=SO-2026-1012 [--apply]
```

| Argument | Description |
|----------|-------------|
| `--so=` | SO reference number |
| `--apply` | Actually void fulfillments; without this flag, dry-run only |

**How it works:**
1. Finds SO internal ID (oldest match)
2. Queries all recent ItemShip transactions via SuiteQL (`type='ItemShip'`, `trandate >= 2026-10-01`)
3. Loads each via REST API and checks `createdFrom.id` matches the SO
4. Loads each matched IF with `expandSubResources=true` to get line count and total qty
5. Voids all matched IFs via `DELETE /itemFulfillment/{id}`
6. Prints instructions to recreate fulfillment with `run-fulfillment.js`

**Use case:** When a single Item Fulfillment picked up all 6 duplicate SO lines (e.g. 6 × 2 = 12 units deducted instead of 2). Void the IF, fix the SO lines, then recreate.

---

### 6.3 `void-invoice.js`

Deletes/voids a single invoice by NS internal ID.

```
node void-invoice.js --id=2176
```

| Argument | Description |
|----------|-------------|
| `--id=` | NS invoice internal ID (number shown in NS record URL) |

**How it works:** Sends `DELETE /services/rest/record/v1/invoice/{id}`. NS voids the transaction and reverses all accounting entries.

---

### 6.4 `list-cc-addresses.js`

Diagnostic script — finds all AWAITING_STOCK outbound orders in CC and attempts to move them to PICK_AND_PACK.

```
node list-cc-addresses.js
```

No arguments. Output shows success or error per order. Note: CC typically requires warehouse auto-allocation to be enabled in settings for this to work.

---

## 7. Output Files

All results are saved to the `output/` directory (auto-created).

| File | Written by | Contents |
|------|-----------|----------|
| `output/create-item-result.json` | `run.js` | Per-SKU NS and CC create/update results |
| `output/create-po-result.json` | `run-po.js` | Per-PO NS and CC results |
| `output/create-so-result.json` | `run-so.js` | Per-SO NS and CC results |
| `output/create-inbound-result.json` | `run-inbound.js` | Per-PO CC inbound order results |
| `output/receipt-result.json` | `run-receipt.js` | Per-PO NS receipt results |
| `output/fulfillment-result.json` | `run-fulfillment.js` | Per-SO NS fulfillment results |
| `output/invoice-result.json` | `run-invoice.js` | Per-SO NS invoice results |
| `output/inv-adjustment-result.json` | `run-inv-adjustment.js` | Per-SKU adjustment results with timestamps |
| `output/inventory-reconciliation-YYYY-MM-DD.csv` | `reconcile-inventory.js` | CC vs NS inventory comparison |

All JSON output files **merge** new results with existing records (matched by PO/SO/SKU number), so re-running does not lose history.

---

## 8. Known Issues & Design Decisions

### 8.1 Duplicate SO lines from re-running `run-so.js`

`call-create-so.js` uses `PATCH` when a SO already exists, which **appends** lines rather than replacing them. Running `run-so.js` on the same SO twice will create duplicate item lines.

**Fix:** Run `fix-so-duplicate-lines.js` to close duplicates, then `fix-so-extra-fulfillments.js` if fulfillments were already created.

**Prevention:** Always use `--so=` to target specific SOs and never run the same SO number twice.

---

### 8.2 Wrong soId picked by RESTlets (DESC sort)

The NS RESTlets (`rl_create_fulfillment.js`, `rl_create_invoice.js`) use `sort: search.Sort.DESC` when looking up a SO by `otherRefNum`, meaning they return the **newest** matching SO. If a duplicate SO record exists with the same reference number, the RESTlet picks the wrong one.

**Fix applied:** `call-create-fulfillment.js` and `call-create-invoice.js` now look up the SO internal ID themselves (taking the **oldest** match, sort ASC) and pass `soId` directly in the request body. The RESTlets accept `soId` and skip their internal lookup when it is provided.

---

### 8.3 NS REST subresource endpoint does not support pagination

`GET /salesOrder/{id}/item` does not accept `limit` or `offset` parameters. Using `expandSubResources=true` on the main record also returns a limited number of sublist rows (~10).

**Fix:** `fix-so-duplicate-lines.js` uses SuiteQL (`SELECT ... FROM transactionLine WHERE transaction = {soId}`) to retrieve all lines without pagination limits.

---

### 8.4 CartonCloud deliver address requires `companyName`

Even when passing a CC address `id`, the CC API requires `companyName` in the address object. Missing it returns a 422 error: "Either Company name or Contact name should be provided."

**Fix:** `cartoncloud.js` always includes `companyName: so.customerName || ''` in the deliver address.

---

### 8.5 CartonCloud REJECTED orders cannot be updated

CC outbound orders in `REJECTED` status cannot be patched. The only way to fix them is to delete and recreate.

**Fix:** `cartoncloud.js` checks for `REJECTED` status when an existing order is found, deletes it, then proceeds to create a new order.

---

### 8.6 `ccDeliverAddressId` must be a UUID

The CC deliver address ID must be a valid UUID (e.g. `43e8b3d8-9c08-4978-82d5-ee6820fe4069`), not a numeric ID. Entering a number in Excel causes a 422 "Invalid UUID format" error. Find the correct UUID by inspecting CC outbound order payloads or the CC address management screen.

---

### 8.7 `ccCustomerId` must be the product owner

The CC outbound order's customer must match the customer who owns the products in the CC warehouse. Using a different customer UUID results in "Product not found" errors even when the product SKU exists.
