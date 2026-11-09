# NS ↔ CartonCloud Operations Guide
**Tap Phong Trading — NetSuite Sandbox (12222161_SB1)**

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        YOUR LOCAL MACHINE                           │
│                                                                     │
│  Excel Workbook (Items / POs / SOs)                                 │
│       │                                                             │
│       ▼                                                             │
│  run.js / run-po.js / run-so.js  ──────────────────────────────┐   │
│       │                call-*.js files                          │   │
│       │                ns-tba.js (auth)                         │   │
│       │                cartoncloud.js (CC API)                  │   │
│       │                                                         │   │
└───────┼─────────────────────────────────────────────────────────┘   │
        │                                                             │
        ├──── HTTPS / TBA ────────────────────────────────────────┐   │
        │                                                         │   │
        ▼                                                         ▼   │
┌───────────────────┐                              ┌─────────────────┐│
│    NETSUITE       │                              │  CARTONCLOUD    ││
│  (ERP/Accounting) │                              │  (Warehouse)    ││
│                   │                              │                 ││
│  Script 1942 ─── rl_create_item.js              │  Products       ││
│  Script 1944 ─── rl_create_po.js                │  Inbound Orders ││
│  Script 1945 ─── rl_create_so.js                │  Outbound Orders││
│  Script 1946 ─── rl_create_fulfillment.js       │  Stock Levels   ││
│  Script 1950 ─── rl_create_receipt.js           │                 ││
│  Script 2055 ─── rl_get_inventory.js            └─────────────────┘│
│  Script 2056 ─── rl_create_invoice.js                              │
│  Script 2057 ─── rl_create_inv_adjustment.js                       │
└───────────────────┘                                                 │
```

---

## LIFECYCLE 1 — New Item Setup (one-time per product)

**Purpose:** Create a product in both NetSuite and CartonCloud so it can be bought and sold.

```
Excel (Items sheet)
      │
      │  node run.js
      ▼
call-create-item.js  ──► NS RESTlet 1942 (rl_create_item.js)
      │                   └─► Creates/updates NS Inventory Item
      │
cartoncloud.js
  upsertProduct()          └─► Creates/updates CC Product
  upsertWarehouseProduct()  └─► Sets CC warehouse config (dimensions, barcodes)
```

**Command:**
```bash
node run.js
```

**Programs used:**
| File | Role |
|------|------|
| `run.js` | Reads Excel, orchestrates item creation |
| `call-create-item.js` | Calls NS RESTlet for item |
| `rl_create_item.js` | NS Script 1942 — creates/updates Inventory Item |
| `cartoncloud.js` | CC API client — upserts product + warehouse product |
| `ns-tba.js` | NS authentication (Token-Based Auth) |

**What you see after:**
- NS: New Inventory Item with SKU, UoM, pricing
- CC: New Product + Warehouse Product with barcode

---

## LIFECYCLE 2 — Purchase Order (Receiving Stock)

**Purpose:** Order goods from a supplier → receive them into the warehouse.

```
  STEP 1          STEP 2              STEP 3            STEP 4
  ──────          ──────              ──────            ──────

Excel (PO sheet)  CC Warehouse        CC verifies       NS records
                  receives stock      receipt           receipt

node run-po.js    [Manual in CC]      node run-receipt.js
      │                                     │
      ▼                                     ▼
call-create-po.js              call-create-receipt.js
      │                               │
      ├──► NS RESTlet 1944            └──► NS RESTlet 1950
      │    rl_create_po.js                 rl_create_receipt.js
      │    └─► NS Purchase Order           └─► NS Item Receipt
      │        (Pending Receipt)               NS PO → Pending Bill
      │
      └──► cartoncloud.js
           upsertInboundOrder()
           └─► CC Inbound Order created
```

### Step 2a — Create PO in NS + CC Inbound Order

**Command:**
```bash
node run-po.js
```

**Programs used:**
| File | Role |
|------|------|
| `run-po.js` | Reads Excel PO sheet, runs PO creation |
| `call-create-po.js` | Calls NS RESTlet |
| `rl_create_po.js` | NS Script 1944 — creates/updates Purchase Order |
| `cartoncloud.js → upsertInboundOrder()` | Creates CC Inbound Order |
| `ns-tba.js` | NS auth |

**What you see after:**
- NS: Purchase Order in **Pending Receipt** status
- CC: Inbound Order created, waiting for stock

---

### Step 2b — Receive stock at CartonCloud warehouse

**This step is done manually in CartonCloud UI or by the warehouse staff.**

1. Log into CartonCloud
2. Find the Inbound Order
3. Click **Allocate** (assigns stock to location)
4. Click **Verify** (confirms physical receipt)

**What you see after:**
- CC: Inbound Order status → **Verified**

---

### Step 2c — Create NS Receipt (after CC verified)

**Command:**
```bash
node run-receipt.js
```

**Programs used:**
| File | Role |
|------|------|
| `run-receipt.js` | Polls CC for verified inbounds, posts to NS |
| `call-create-receipt.js` | Calls NS RESTlet + CC API |
| `cartoncloud.js → getVerifiedInboundOrders()` | Fetches verified orders from CC |
| `rl_create_receipt.js` | NS Script 1950 — creates Item Receipt |
| `ns-tba.js` | NS auth |

**What you see after:**
- NS: Item Receipt created, PO status → **Pending Bill**
- NS: Inventory On Hand increases

---

## LIFECYCLE 3 — Sales Order (Fulfilling Customer Orders)

**Purpose:** Customer places an order → warehouse ships it → invoice created → payment received.

```
  STEP 1           STEP 2             STEP 3            STEP 4         STEP 5
  ──────           ──────             ──────            ──────         ──────

Excel (SO sheet)   CC picks &         NS records        NS creates     NS records
                   dispatches         fulfillment       Invoice        Payment

node run-so.js     [Manual in CC]     node run-          node run-      [Manual in NS]
                                      fulfillment.js     invoice.js
      │                                     │                 │
      ▼                                     ▼                 ▼
call-create-so.js              call-create-            call-create-
      │                        fulfillment.js          invoice.js
      │                               │                      │
      ├──► NS RESTlet 1945            └──► NS RESTlet 1946   └──► NS RESTlet 2056
      │    rl_create_so.js                 rl_create_          rl_create_invoice.js
      │    └─► NS Sales Order             fulfillment.js       └─► NS Invoice
      │        (Pending Approval)          └─► NS Item           (from SO transform)
      │        → Approve → Pending Fill    Fulfillment
      │        NS Inventory reduces
      └──► cartoncloud.js
           upsertOutboundOrder()
           └─► CC Outbound Order
```

### Step 3a — Create SO in NS + CC Outbound Order

**Command:**
```bash
node run-so.js
```

**Programs used:**
| File | Role |
|------|------|
| `run-so.js` | Reads Excel SO sheet, runs SO creation |
| `call-create-so.js` | Calls NS RESTlet |
| `rl_create_so.js` | NS Script 1945 — creates/updates Sales Order |
| `cartoncloud.js → upsertOutboundOrder()` | Creates CC Outbound Order |
| `ns-tba.js` | NS auth |

**What you see after:**
- NS: Sales Order in **Pending Fulfillment** status (after approval)
- CC: Outbound Order created, ready for picking

---

### Step 3b — Pick, pack and dispatch at CartonCloud warehouse

**This step is done by warehouse staff in CartonCloud.**

1. Log into CartonCloud
2. Find the Outbound Order
3. Pick and pack items
4. Click **Dispatch** (marks as shipped)

**What you see after:**
- CC: Outbound Order status → **Dispatched**

---

### Step 3c — Create NS Item Fulfillment (after CC dispatched)

**Command:**
```bash
node run-fulfillment.js
```

**Programs used:**
| File | Role |
|------|------|
| `run-fulfillment.js` | Polls CC for dispatched outbounds, posts to NS |
| `call-create-fulfillment.js` | Calls NS RESTlet + CC API |
| `cartoncloud.js → getDispatchedOutboundOrders()` | Fetches dispatched orders from CC |
| `rl_create_fulfillment.js` | NS Script 1946 — creates Item Fulfillment |
| `ns-tba.js` | NS auth |

**What you see after:**
- NS: Item Fulfillment created, SO status → **Pending Billing**
- NS: Inventory On Hand decreases

---

### Step 3d — Create NS Invoice

**Command:**
```bash
node run-invoice.js --so=SO-2026-1006
```

**Programs used:**
| File | Role |
|------|------|
| `run-invoice.js` | CLI — takes SO number, creates invoice |
| `call-create-invoice.js` | Calls NS RESTlet |
| `rl_create_invoice.js` | NS Script 2056 — transforms SO → Invoice |
| `ns-tba.js` | NS auth |

**What you see after:**
- NS: Invoice created with line items + GST
- NS: SO status → **Pending Billing** (until paid)

---

### Step 3e — Record Payment (Manual in NS)

**This step is done manually in NetSuite UI.**

1. Open the Invoice in NS
2. Click **Receive Payment** (top right)
3. Enter payment date, amount, payment method
4. Click **Save**

**What you see after:**
- NS: Invoice status → **Paid (Closed)**
- NS: Accounts Receivable balance clears

---

## LIFECYCLE 4 — Inventory Reconciliation (Ongoing)

**Purpose:** Compare NS inventory vs CC warehouse stock to find discrepancies.

**Command:**
```bash
node reconcile-inventory.js
```

**Programs used:**
| File | Role |
|------|------|
| `reconcile-inventory.js` | Fetches both systems, compares, reports |
| `call-get-inventory.js` | Calls NS RESTlet for inventory |
| `rl_get_inventory.js` | NS Script 2055 — returns all inventory levels |
| `cartoncloud.js → getWarehouseStockBySku()` | Fetches CC stock per SKU |
| `ns-tba.js` | NS auth |

**What you see after:**
- Console table: each SKU with CC qty, NS available qty, NS on-hand qty, variance, status (MATCH / CC_OVER / CC_UNDER / CC_ONLY / NS_ONLY)
- CSV saved to `output/inventory-reconciliation-YYYY-MM-DD.csv`

**Statuses explained:**
| Status | Meaning |
|--------|---------|
| MATCH | CC and NS quantities agree |
| CC_OVER | CC has more stock than NS |
| CC_UNDER | CC has less stock than NS |
| CC_ONLY | Item exists in CC but not in NS |
| NS_ONLY | Item exists in NS but not in CC |

---

## Complete Program Reference

### Run Scripts (you execute these)

| Command | Purpose | When to run |
|---------|---------|-------------|
| `node run.js` | Create/update items in NS + CC | When adding new products |
| `node run-po.js` | Create PO in NS + Inbound in CC | When placing a supplier order |
| `node run-so.js` | Create SO in NS + Outbound in CC | When a customer order comes in |
| `node run-receipt.js` | Post CC verified receipts to NS | After CC warehouse verifies inbound |
| `node run-fulfillment.js` | Post CC dispatches to NS | After CC warehouse dispatches outbound |
| `node run-invoice.js --so=SO-XXXX` | Create NS invoice from SO | After fulfillment, before payment |
| `node reconcile-inventory.js` | Compare CC vs NS stock | Weekly or when discrepancy suspected |

### NS RESTlets (deployed in NetSuite, never run directly)

| File | NS Script # | Purpose |
|------|------------|---------|
| `rl_create_item.js` | 1942 | Create/update Inventory Item |
| `rl_create_po.js` | 1944 | Create/update Purchase Order |
| `rl_create_so.js` | 1945 | Create/update Sales Order |
| `rl_create_fulfillment.js` | 1946 | Create Item Fulfillment |
| `rl_create_receipt.js` | 1950 | Create Item Receipt (PO receipt) |
| `rl_get_inventory.js` | 2055 | Return inventory levels |
| `rl_create_invoice.js` | 2056 | Transform SO → Invoice |
| `rl_create_inv_adjustment.js` | 2057 | Create inventory adjustments |

### Call Files (local callers, not run directly)

| File | Calls |
|------|-------|
| `call-create-item.js` | NS Script 1942 |
| `call-create-po.js` | NS Script 1944 |
| `call-create-so.js` | NS Script 1945 |
| `call-create-fulfillment.js` | NS Script 1946 + CC API |
| `call-create-receipt.js` | NS Script 1950 + CC API |
| `call-get-inventory.js` | NS Script 2055 |
| `call-create-invoice.js` | NS Script 2056 |
| `call-create-inv-adjustment.js` | NS Script 2057 |

### Shared Libraries

| File | Purpose |
|------|---------|
| `ns-tba.js` | NS Token-Based Authentication — signs all NS API calls |
| `cartoncloud.js` | CartonCloud API client — all CC operations |

---

## Quick Reference — Status Progression

### Purchase Order
```
NS Created  →  Pending Receipt  →  Pending Bill  →  Fully Billed
              (run-po.js)         (run-receipt.js)  (manual in NS)

CC Created  →  Allocated  →  Verified
              (CC warehouse)  (CC warehouse)
```

### Sales Order
```
NS Created  →  Pending Approval  →  Pending Fulfillment  →  Pending Billing  →  Closed
              (approve in NS UI)    (run-so.js)              (run-fulfillment)   (run-invoice + payment)

CC Created  →  Dispatched
              (CC warehouse)
```

---

## Output Files

All results are saved to the `output/` folder:

| File | Created by | Contents |
|------|-----------|---------|
| `output/inv-adjustment-result.json` | `run-inv-adjustment.js` | Adjustment history |
| `output/invoice-result.json` | `run-invoice.js` | Invoice creation history |
| `output/inventory-reconciliation-YYYY-MM-DD.csv` | `reconcile-inventory.js` | Stock comparison report |
