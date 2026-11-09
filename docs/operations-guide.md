# NS ↔ CartonCloud Operations Guide
**Tap Phong Trading — NetSuite Sandbox (12222161_SB1)**

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           YOUR LOCAL MACHINE                                 │
│                                                                              │
│   Excel Workbook                                                             │
│   (Items / POs / SOs)                                                        │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────┐    ┌──────────────────┐    ┌──────────────────────────┐   │
│   │  RUN SCRIPT │───►│   CALL FILE      │───►│  ns-tba.js               │   │
│   │  run.js     │    │  call-create-    │    │  (signs HTTPS request    │   │
│   │  run-po.js  │    │  item.js         │    │   with TBA credentials)  │   │
│   │  run-so.js  │    │  call-create-    │    └──────────┬───────────────┘   │
│   │  run-*.js   │    │  po.js  etc.     │               │                   │
│   └─────────────┘    └──────────────────┘               │ HTTPS POST        │
│         │                                               │                   │
│         │            ┌──────────────────┐               │                   │
│         └───────────►│  cartoncloud.js  │──── HTTPS ───►│ CartonCloud API   │
│                      │  (CC API client) │               │                   │
│                      └──────────────────┘               │                   │
└─────────────────────────────────────────────────────────┼───────────────────┘
                                                          │
                              ┌───────────────────────────▼──────────────────┐
                              │              NETSUITE SANDBOX                 │
                              │          (12222161-sb1.netsuite.com)          │
                              │                                               │
                              │  RESTlet endpoint receives POST request       │
                              │         │                                     │
                              │         ▼                                     │
                              │  ┌─────────────────────────────────────┐     │
                              │  │         NS RESTLET SCRIPT           │     │
                              │  │                                     │     │
                              │  │  Script 1942  rl_create_item.js    │     │
                              │  │  Script 1944  rl_create_po.js      │     │
                              │  │  Script 1945  rl_create_so.js      │     │
                              │  │  Script 1946  rl_create_fulfilm.js │     │
                              │  │  Script 1950  rl_create_receipt.js │     │
                              │  │  Script 2055  rl_get_inventory.js  │     │
                              │  │  Script 2056  rl_create_invoice.js │     │
                              │  │  Script 2057  rl_create_inv_adj.js │     │
                              │  └──────────────┬──────────────────────┘     │
                              │                 │                             │
                              │                 ▼                             │
                              │  ┌──────────────────────────────────────┐    │
                              │  │         NS RECORDS CREATED           │    │
                              │  │  Inventory Item / Purchase Order /   │    │
                              │  │  Sales Order / Item Fulfillment /    │    │
                              │  │  Item Receipt / Invoice              │    │
                              │  └──────────────────────────────────────┘    │
                              └───────────────────────────────────────────────┘
```

---

## LIFECYCLE 1 — New Item Setup

**Purpose:** Create a product in NS and CC before it can be bought or sold.

### Full Call Chain

```
node run.js
    │
    ├─ reads Excel "Items" sheet
    │
    ├─► call-create-item.js
    │       │
    │       └─► ns-tba.js  (signs request)
    │               │
    │               └─► POST https://12222161-sb1.restlets.api.netsuite.com
    │                         ?script=1942&deploy=1
    │                         │
    │                         └─► rl_create_item.js  [NS Script 1942]
    │                               │
    │                               ├─ search: find item by itemid (SKU)
    │                               ├─ load or create: record.Type.INVENTORY_ITEM
    │                               ├─ set: itemid, displayname, salesdescription
    │                               ├─ set: incomeAccount, cogsAccount, assetAccount
    │                               ├─ set: unitsType, stockUnit, purchaseUnit, saleUnit
    │                               ├─ set: taxSchedule, subsidiary, location
    │                               └─ save → returns { internalId, action }
    │
    └─► cartoncloud.js
            │
            ├─ upsertProduct()
            │       └─► POST/PUT /products
            │               fields: code (SKU), name, description
            │
            └─ upsertWarehouseProduct()
                    └─► POST/PUT /warehouse-products
                            fields: warehouseId, barcode, weight, dimensions
```

**Command:**
```bash
node run.js
```

| Layer | File | NS Script | NS Record |
|-------|------|-----------|-----------|
| Run | `run.js` | — | — |
| Call | `call-create-item.js` | — | — |
| Auth | `ns-tba.js` | — | — |
| RESTlet | `rl_create_item.js` | **1942** / Deploy 1 | `inventoryitem` |
| CC | `cartoncloud.js` | — | CC Product + Warehouse Product |

**Result:**
- NS: `inventoryitem` record — SKU, UoM, accounts, pricing
- CC: Product + Warehouse Product with barcode

---

## LIFECYCLE 2 — Purchase Order (Receiving Stock)

### Status Flow

```
NS:  [PO Created] → Pending Receipt → Pending Bill → Fully Billed
                    run-po.js          run-receipt.js   manual NS

CC:  [Inbound Created] → Allocated → Verified
                          CC staff     CC staff
```

---

### Step 2a — Create PO in NS + Inbound Order in CC

```
node run-po.js
    │
    ├─ reads Excel "PO" sheet
    │
    ├─► call-create-po.js
    │       │
    │       └─► ns-tba.js  (signs request)
    │               │
    │               └─► POST ?script=1944&deploy=1
    │                         │
    │                         └─► rl_create_po.js  [NS Script 1944]
    │                               │
    │                               ├─ search: find PO by otherrefnum (PO number)
    │                               ├─ SAFETY CHECK: load PO, verify otherrefnum matches
    │                               │  (prevents stale index from updating wrong PO)
    │                               ├─ load or create: record.Type.PURCHASE_ORDER
    │                               ├─ set header: entity (vendor), trandate, otherrefnum
    │                               │              subsidiary, location, memo
    │                               ├─ set lines:  item (internalId), quantity, rate,
    │                               │              units, taxCode
    │                               └─ save → returns { internalId, poNumber, action }
    │
    └─► cartoncloud.js → upsertInboundOrder()
            │
            └─► POST/PUT /inbound-orders
                    fields: reference (PO number), expectedDate,
                            supplierId, lines[{ sku, qty, uom }]
```

**Command:**
```bash
node run-po.js
```

| Layer | File | NS Script | NS Record |
|-------|------|-----------|-----------|
| Run | `run-po.js` | — | — |
| Call | `call-create-po.js` | — | — |
| Auth | `ns-tba.js` | — | — |
| RESTlet | `rl_create_po.js` | **1944** / Deploy 1 | `purchaseorder` |
| CC | `cartoncloud.js → upsertInboundOrder()` | — | CC Inbound Order |

**Result:**
- NS: Purchase Order → **Pending Receipt**
- CC: Inbound Order created

---

### Step 2b — Warehouse receives and verifies stock (Manual in CC)

```
CartonCloud UI
    │
    ├─ Find Inbound Order by PO reference
    ├─ Click Allocate  → assigns stock to bin/pallet location
    └─ Click Verify    → confirms physical receipt complete
```

No script to run. Done by warehouse staff.

**Result:**
- CC: Inbound Order → **Verified**

---

### Step 2c — Create NS Item Receipt (after CC verified)

```
node run-receipt.js
    │
    ├─► cartoncloud.js → getVerifiedInboundOrders()
    │       │
    │       └─► GET /inbound-orders?status=verified
    │               returns: [ { reference, lines[{ sku, receivedQty }] } ]
    │
    └─► call-create-receipt.js  (for each verified order)
            │
            └─► ns-tba.js  (signs request)
                    │
                    └─► POST ?script=1950&deploy=1
                              │
                              └─► rl_create_receipt.js  [NS Script 1950]
                                    │
                                    ├─ search: find PO by otherrefnum
                                    ├─ load: record.Type.PURCHASE_ORDER
                                    ├─ transform: PO → ItemReceipt
                                    │   record.transform({
                                    │     fromType: PURCHASE_ORDER,
                                    │     toType: ITEM_RECEIPT
                                    │   })
                                    ├─ set lines: item, quantity (from CC verified qty)
                                    │             location, units
                                    └─ save → returns { internalId, action }
```

**Command:**
```bash
node run-receipt.js
```

| Layer | File | NS Script | NS Record |
|-------|------|-----------|-----------|
| Run | `run-receipt.js` | — | — |
| Call | `call-create-receipt.js` | — | — |
| CC fetch | `cartoncloud.js → getVerifiedInboundOrders()` | — | — |
| Auth | `ns-tba.js` | — | — |
| RESTlet | `rl_create_receipt.js` | **1950** / Deploy 1 | `itemreceipt` |

**Result:**
- NS: Item Receipt created — PO → **Pending Bill**
- NS: Inventory On Hand **increases**

---

## LIFECYCLE 3 — Sales Order (Fulfilling Customer Orders)

### Status Flow

```
NS:  [SO Created] → Pending Approval → Pending Fulfillment → Pending Billing → Closed
                    run-so.js           approve in NS UI       run-fulfillment   run-invoice
                                                                                 + payment

CC:  [Outbound Created] → Dispatched
                           CC staff
```

---

### Step 3a — Create SO in NS + Outbound Order in CC

```
node run-so.js
    │
    ├─ reads Excel "SO" sheet
    │
    ├─► call-create-so.js
    │       │
    │       └─► ns-tba.js  (signs request)
    │               │
    │               └─► POST ?script=1945&deploy=1
    │                         │
    │                         └─► rl_create_so.js  [NS Script 1945]
    │                               │
    │                               ├─ search: find SO by tranid (SO number)
    │                               ├─ load or create: record.Type.SALES_ORDER
    │                               ├─ set header: entity (customer), trandate
    │                               │              otherrefnum, memo, subsidiary
    │                               │              taxCode, shippingAddress
    │                               ├─ set lines:  item, quantity, rate, units, taxCode
    │                               └─ save → returns { internalId, soNumber, action }
    │
    └─► cartoncloud.js → upsertOutboundOrder()
            │
            └─► POST/PUT /outbound-orders
                    fields: reference (SO number), deliverDate,
                            ccCustomerId, ccDeliverAddressId,
                            lines[{ sku, qty, uom }]
```

**Command:**
```bash
node run-so.js
```

| Layer | File | NS Script | NS Record |
|-------|------|-----------|-----------|
| Run | `run-so.js` | — | — |
| Call | `call-create-so.js` | — | — |
| Auth | `ns-tba.js` | — | — |
| RESTlet | `rl_create_so.js` | **1945** / Deploy 1 | `salesorder` |
| CC | `cartoncloud.js → upsertOutboundOrder()` | — | CC Outbound Order |

**Result:**
- NS: Sales Order → **Pending Fulfillment** (after approval in NS UI)
- CC: Outbound Order created, ready for picking

---

### Step 3b — Warehouse picks, packs and dispatches (Manual in CC)

```
CartonCloud UI
    │
    ├─ Find Outbound Order by SO reference
    ├─ Pick items from shelves
    ├─ Pack into cartons
    └─ Click Dispatch  → marks order as shipped
```

No script to run. Done by warehouse staff.

**Result:**
- CC: Outbound Order → **Dispatched**

---

### Step 3c — Create NS Item Fulfillment (after CC dispatched)

```
node run-fulfillment.js
    │
    ├─► cartoncloud.js → getDispatchedOutboundOrders()
    │       │
    │       └─► GET /outbound-orders?status=dispatched
    │               returns: [ { reference, lines[{ sku, dispatchedQty }] } ]
    │
    └─► call-create-fulfillment.js  (for each dispatched order)
            │
            ├─► cartoncloud.js → getWarehouseStockBySku()
            │       └─► GET /warehouse-products/{id}/stock  (stock check)
            │
            └─► ns-tba.js  (signs request)
                    │
                    └─► POST ?script=1946&deploy=1
                              │
                              └─► rl_create_fulfillment.js  [NS Script 1946]
                                    │
                                    ├─ search: find SO by tranid
                                    ├─ load: record.Type.SALES_ORDER
                                    ├─ transform: SO → ItemFulfillment
                                    │   record.transform({
                                    │     fromType: SALES_ORDER,
                                    │     toType: ITEM_FULFILLMENT
                                    │   })
                                    ├─ set header: shipDate, trackingNumbers
                                    ├─ set lines:  quantity (from CC dispatched qty)
                                    │             location, units
                                    └─ save → returns { internalId, action }
```

**Command:**
```bash
node run-fulfillment.js
```

| Layer | File | NS Script | NS Record |
|-------|------|-----------|-----------|
| Run | `run-fulfillment.js` | — | — |
| Call | `call-create-fulfillment.js` | — | — |
| CC fetch | `cartoncloud.js → getDispatchedOutboundOrders()` | — | — |
| CC check | `cartoncloud.js → getWarehouseStockBySku()` | — | — |
| Auth | `ns-tba.js` | — | — |
| RESTlet | `rl_create_fulfillment.js` | **1946** / Deploy 1 | `itemfulfillment` |

**Result:**
- NS: Item Fulfillment created — SO → **Pending Billing**
- NS: Inventory On Hand **decreases**

---

### Step 3d — Create NS Invoice

```
node run-invoice.js --so=SO-2026-1006
    │
    └─► call-create-invoice.js
            │
            └─► ns-tba.js  (signs request)
                    │
                    └─► POST ?script=2056&deploy=1
                              │
                              └─► rl_create_invoice.js  [NS Script 2056]
                                    │
                                    ├─ search: find SO by tranid (SO number)
                                    │   filter: status = SalesOrd:E (Pending Billing)
                                    │           OR SalesOrd:F (Partially Fulfilled)
                                    ├─ check: does invoice already exist for this SO?
                                    │   search: type=Invoice, createdfrom=soId
                                    ├─ transform: SO → Invoice
                                    │   record.transform({
                                    │     fromType: SALES_ORDER,
                                    │     toType:   INVOICE,
                                    │     isDynamic: true
                                    │   })
                                    ├─ set header: trandate, memo
                                    └─ save → returns { internalId, soNumber, action }
```

**Command:**
```bash
node run-invoice.js --so=SO-2026-XXXX
```

| Layer | File | NS Script | NS Record |
|-------|------|-----------|-----------|
| Run | `run-invoice.js` | — | — |
| Call | `call-create-invoice.js` | — | — |
| Auth | `ns-tba.js` | — | — |
| RESTlet | `rl_create_invoice.js` | **2056** / Deploy 1 | `invoice` |

**Result:**
- NS: Invoice created with line items + tax
- NS: SO → **Pending Billing** (until paid)

---

### Step 3e — Record Payment (Manual in NS)

```
NetSuite UI
    │
    ├─ Open Invoice (Transactions → Sales → Invoices)
    ├─ Click Actions → Receive Payment
    ├─ Set: Date, Amount, Payment Method (Cash / Credit Card / EFT)
    └─ Click Save
```

No script to run. Done manually in NS.

**Result:**
- NS: Invoice → **Paid (Closed)**
- NS: Accounts Receivable balance clears

---

## LIFECYCLE 4 — Inventory Reconciliation

**Purpose:** Compare NS inventory vs CC warehouse stock — find discrepancies.

```
node reconcile-inventory.js
    │
    ├─► call-get-inventory.js
    │       │
    │       └─► ns-tba.js  (signs request)
    │               │
    │               └─► POST ?script=2055&deploy=1
    │                         │
    │                         └─► rl_get_inventory.js  [NS Script 2055]
    │                               │
    │                               ├─ search: type=inventoryitem, all active items
    │                               ├─ for each item:
    │                               │   load inventory detail per location
    │                               │   fields: quantityAvailable, quantityOnHand
    │                               │           quantityOnOrder, quantityCommitted
    │                               └─ returns [ { sku, name, quantityAvailable,
    │                                              quantityOnHand, locationId } ]
    │
    └─► cartoncloud.js → getWarehouseStockBySku()
            │
            ├─► GET /warehouse-products?page=0&size=100  (paginated)
            └─► GET /warehouse-products/{id}/stock?warehouse={warehouseId}
                    fields: measures.quantityFree, measures.quantity
```

**Command:**
```bash
node reconcile-inventory.js
```

| Layer | File | NS Script | NS Record |
|-------|------|-----------|-----------|
| Run | `reconcile-inventory.js` | — | — |
| Call | `call-get-inventory.js` | — | — |
| Auth | `ns-tba.js` | — | — |
| RESTlet | `rl_get_inventory.js` | **2055** / Deploy 1 | `inventoryitem` (read) |
| CC | `cartoncloud.js → getWarehouseStockBySku()` | — | CC stock (read) |

**Result:**
- Console table + CSV `output/inventory-reconciliation-YYYY-MM-DD.csv`

| Status | Meaning | Action |
|--------|---------|--------|
| MATCH | CC qty = NS qty | None |
| CC_OVER | CC has more than NS | Investigate missing NS receipt |
| CC_UNDER | CC has less than NS | Investigate missing CC dispatch |
| CC_ONLY | In CC but not NS | Missing NS item setup |
| NS_ONLY | In NS but not CC | Missing CC product setup |

---

## Complete RESTlet Reference

| RESTlet File | Script # | Deploy # | NS Record Type | Called By |
|--------------|----------|----------|----------------|-----------|
| `rl_create_item.js` | **1942** | 1 | `inventoryitem` | `call-create-item.js` |
| `rl_create_po.js` | **1944** | 1 | `purchaseorder` | `call-create-po.js` |
| `rl_create_so.js` | **1945** | 1 | `salesorder` | `call-create-so.js` |
| `rl_create_fulfillment.js` | **1946** | 1 | `itemfulfillment` | `call-create-fulfillment.js` |
| `rl_create_receipt.js` | **1950** | 1 | `itemreceipt` | `call-create-receipt.js` |
| `rl_get_inventory.js` | **2055** | 1 | `inventoryitem` (read) | `call-get-inventory.js` |
| `rl_create_invoice.js` | **2056** | 1 | `invoice` | `call-create-invoice.js` |
| `rl_create_inv_adjustment.js` | **2057** | 1 | `inventoryadjustment` | `call-create-inv-adjustment.js` |

---

## Complete Run Script Reference

| Command | Calls | RESTlet | CC Function | When |
|---------|-------|---------|-------------|------|
| `node run.js` | `call-create-item.js` | 1942 | `upsertProduct` + `upsertWarehouseProduct` | Adding new products |
| `node run-po.js` | `call-create-po.js` | 1944 | `upsertInboundOrder` | Placing supplier order |
| `node run-so.js` | `call-create-so.js` | 1945 | `upsertOutboundOrder` | Customer order received |
| `node run-receipt.js` | `call-create-receipt.js` | 1950 | `getVerifiedInboundOrders` | After CC verifies inbound |
| `node run-fulfillment.js` | `call-create-fulfillment.js` | 1946 | `getDispatchedOutboundOrders` | After CC dispatches outbound |
| `node run-invoice.js --so=SO-XXXX` | `call-create-invoice.js` | 2056 | — | After fulfillment |
| `node reconcile-inventory.js` | `call-get-inventory.js` | 2055 | `getWarehouseStockBySku` | Weekly / on-demand |
| `node run-inv-adjustment.js --type=X --sku=X --qty=X` | `call-create-inv-adjustment.js` | 2057 | — | Physical count correction |

---

## NS RESTlet URL Format

All RESTlets are called at:
```
https://12222161-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl
  ?script={SCRIPT_ID}&deploy={DEPLOY_ID}
```

Authentication: **Token-Based Authentication (TBA)** via OAuth 1.0 HMAC-SHA256
- Signed by `ns-tba.js` using credentials in `.env`
- Keys: `NS_CONSUMER_KEY`, `NS_CONSUMER_SECRET`, `NS_TOKEN_KEY`, `NS_TOKEN_SECRET`

---

## Shared Library Reference

### ns-tba.js
Signs every NS API call with TBA. Used by all `call-*.js` files.
```
nsRequest(method, url, body)
  └─► builds OAuth 1.0 Authorization header
  └─► sends HTTPS request to NS
  └─► returns JSON response
```

### cartoncloud.js
CC API client. Handles OAuth2 token refresh automatically.
```
getToken()                    → fetch/refresh CC access token
upsertProduct(item)           → POST/PUT CC Product
upsertWarehouseProduct(item)  → POST/PUT CC Warehouse Product
upsertInboundOrder(po)        → POST/PUT CC Inbound Order
upsertOutboundOrder(so)       → POST/PUT CC Outbound Order
getVerifiedInboundOrders()    → GET CC verified inbounds
getDispatchedOutboundOrders() → GET CC dispatched outbounds
getWarehouseStockBySku(skus)  → GET CC stock per SKU
```

---

## Output Files

| File | Created by | Contents |
|------|-----------|---------|
| `output/inv-adjustment-result.json` | `run-inv-adjustment.js` | Adjustment history |
| `output/invoice-result.json` | `run-invoice.js` | Invoice creation history |
| `output/inventory-reconciliation-YYYY-MM-DD.csv` | `reconcile-inventory.js` | Stock comparison report |
