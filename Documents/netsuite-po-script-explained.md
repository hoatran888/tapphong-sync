# NetSuite Purchase Order Script — How It Works

*Date: 2026-10-20*

---

## Files Created

| File | Purpose |
|---|---|
| `rl_create_po.js` | NetSuite RESTlet — runs inside NS, creates/updates POs |
| `call-create-po.js` | Builds the RESTlet URL, signs and sends the HTTP POST |
| `run-po.js` | Reads PO sheet from Excel, groups rows by poNumber, calls NS |

---

## How to Run

```bash
# Create all POs in the PO sheet
node run-po.js Data/TP-Info-v2.xlsx

# Create a single PO (for testing)
node run-po.js Data/TP-Info-v2.xlsx --po=PO-2026-001
```

---

## PO Sheet Structure (TP-Info-v2.xlsx)

One row per line item. Repeat header fields for each row on the same PO.

**Header fields** (repeated per row):

| Column | Description | Where to find |
|---|---|---|
| `poNumber` | Your reference (e.g. PO-2026-001) | You decide |
| `vendorId` | NS internal ID of the vendor | Lists → Relationships → Vendors |
| `vendorName` | For reference only, not sent to NS | — |
| `tranDate` | PO date | e.g. 2026-10-20 |
| `shipDate` | Expected delivery date | e.g. 2026-11-05 |
| `locationId` | NS location to receive stock into | Setup → Company → Locations |
| `subsidiaryId` | NS subsidiary ID | Setup → Company → Subsidiaries |
| `memo` | Notes on the PO | Anything |

**Line fields** (one row per item):

| Column | Description | Notes |
|---|---|---|
| `sku` | Item SKU | Script looks up NS internal ID automatically |
| `description` | Line description | Optional |
| `quantity` | Quantity ordered | e.g. 100 |
| `rate` | Unit cost | e.g. 12.00 |
| `units` | UOM abbreviation | e.g. PCS, PAL — leave blank if no UOM |

---

## Setup Steps (before first run)

1. Upload `rl_create_po.js` to NetSuite File Cabinet → SuiteScripts
2. Create a new RESTlet script + deployment in NetSuite (same steps as rl_create_item.js)
3. Copy the Script ID → paste into `.env` as `NS_PO_SCRIPT_ID=xxxx`
4. Fill in `vendorId` in the PO sheet
5. Run `node run-po.js Data/TP-Info-v2.xlsx --po=PO-2026-001`

---

## How rl_create_po.js Works

**`findItemBySku(sku)`**
- Searches NS for an inventory item by SKU
- Returns the internal ID — used to add items to PO lines

**`findPOByReference(poNumber)`**
- Searches NS for an existing PO where `otherrefnum = poNumber`
- Returns internal ID if found → update; null → create new

**`upsertPurchaseOrder(data)`**
- Logs `PO Received` to execution log (for debugging)
- Loads or creates the PO record
- Sets header fields: vendor, date, location, memo, reference number
- If updating: clears all existing lines first, then rebuilds
- Adds each line: looks up item by SKU, sets quantity, rate, description
- Saves and logs `PO created` or `PO updated`

---

## Execution Log entries (after each run)

```
Customization → Scripting → Script Deployments
→ PO deployment → Execution Log tab
```

| Title | Details |
|---|---|
| PO Received | poNumber=PO-2026-001 lines=2 |
| PO Lines Cleared | removed 2 line(s) (only on update) |
| PO Line Skip | SKU not found: TP-XXXX (if SKU missing) |
| PO created | internalId=678, poNumber=PO-2026-001, lines=2 |

---

## .env variables needed

```
NS_PO_SCRIPT_ID=xxxx    ← fill after deploying rl_create_po.js
NS_PO_DEPLOY_ID=1
```

---

## Duplicate prevention

- PO reference number is stored in NetSuite's `otherrefnum` field
- Before creating, script searches by `otherrefnum`
- If found → updates existing PO (clears lines + rebuilds)
- If not found → creates new PO
- Running the same PO twice = safe, no duplicates
