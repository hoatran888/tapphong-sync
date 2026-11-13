# Tap Phong — Operations Manual
**System:** NetSuite + CartonCloud integration via Node.js scripts  
**Data file:** `Data/TP-Info-V2.xlsx`

---

## Overview — End-to-End Flow

```
Excel → run-po.js  → NetSuite PO created  + CartonCloud Inbound Order created
                   ↓
         (Supplier delivers goods to warehouse)
                   ↓
         CartonCloud marks Inbound Order as VERIFIED
                   ↓
         run-receipt.js → NetSuite Item Receipt created (stock lands in NS)
                   ↓
Excel → run-so.js  → NetSuite SO created  + CartonCloud Outbound Order created
                   ↓
         (Warehouse picks, packs, dispatches in CartonCloud)
                   ↓
         CartonCloud marks Outbound Order as DISPATCHED
                   ↓
         run-fulfillment.js → NetSuite Item Fulfillment created (stock leaves NS)
                   ↓
         run-invoice.js → NetSuite Invoice created
```

---

## Part 1 — Excel File Structure (TP-Info-V2.xlsx)

The Excel file has two key sheets: **PO** and **SO**.

### PO Sheet — columns

| Column | Description | Example |
|--------|-------------|---------|
| poNumber | Unique PO reference | PO-2026-001 |
| vendorId | NS vendor internal ID | 123 |
| vendorName | Vendor display name | ABC Supplier |
| tranDate | PO date (YYYY-MM-DD) | 2026-11-01 |
| shipDate | Expected ship date (YYYY-MM-DD) | 2026-11-15 |
| locationId | NS location internal ID | 2 |
| subsidiaryId | NS subsidiary internal ID | 3 |
| sku | Item SKU | TP-2026-1006 |
| description | Item description | Widget EE |
| quantity | Quantity ordered | 100 |
| rate | Unit cost | 5.00 |
| units | Unit of measure | PCS |
| taxCode | Tax code | CA-E |
| ccCustomerId | CartonCloud customer UUID | e59d7cd9-... |
| autoApprove | Auto-approve PO in NS | yes |
| memo | Optional notes | First shipment |

> **Multi-line POs:** Repeat the same `poNumber` on multiple rows — one row per SKU.

### SO Sheet — columns

| Column | Description | Example |
|--------|-------------|---------|
| soNumber | Unique SO reference | SO-2026-1001 |
| nsCustomerId | NS customer internal ID | 456 |
| customerName | Customer display name | Tap Phong |
| tranDate | SO date | 2026-11-01 |
| shipDate | Requested ship date | 2026-11-10 |
| locationId | NS location internal ID | 2 |
| subsidiaryId | NS subsidiary internal ID | 3 |
| sku | Item SKU | TP-2026-1006 |
| description | Item description | Widget EE |
| quantity | Quantity ordered | 2 |
| rate | Unit price | 10.00 |
| units | Unit of measure | PCS |
| ccCustomerId | CartonCloud customer UUID | e59d7cd9-... |
| ccDeliverAddressId | CartonCloud delivery address UUID | 43e8b3d8-... |
| autoApprove | Auto-approve SO in NS | yes |
| memo | Optional notes | Urgent |

> **IMPORTANT:** Each SO must only appear **once** in the Excel file per run. Running the same SO number twice will create duplicate lines.

---

## Part 2 — Prerequisites

Before running any script, open Terminal and go to the project folder:

```bash
cd ~/Projects/Tapphong
```

All commands below assume you are in this directory.

---

## Part 3 — Create a Purchase Order (PO)

### Step 1 — Add PO data to Excel

Open `Data/TP-Info-V2.xlsx`, go to the **PO** sheet, and fill in the columns described above. Save and close the file.

### Step 2 — Run the script

**Create one PO:**
```bash
node run-po.js Data/TP-Info-V2.xlsx --po=PO-2026-001
```

**Create multiple POs:**
```bash
node run-po.js Data/TP-Info-V2.xlsx --po=PO-2026-001,PO-2026-002
```

**Create all POs in the sheet:**
```bash
node run-po.js Data/TP-Info-V2.xlsx
```

### Step 3 — Verify in NetSuite

1. Log in to **NetSuite**
2. Go to **Transactions → Purchases → Enter Purchase Orders**
3. Search for the PO number (e.g. `PO-2026-001`)
4. Confirm the PO is created with status **Pending Receipt**
5. Check the line items match your Excel data

### Step 4 — Verify in CartonCloud

1. Log in to **CartonCloud**
2. Go to **Inbound Orders**
3. Find the PO by reference number
4. Status should be **PENDING** or **ALLOCATED**

---

## Part 4 — Receive Stock (PO → Item Receipt)

When the supplier delivers goods to the warehouse, CartonCloud marks the inbound order as **VERIFIED**. You then run the receipt script to record stock arrival in NetSuite.

### Step 1 — Confirm goods received in CartonCloud

1. Log in to **CartonCloud**
2. Go to **Inbound Orders**
3. Find the PO, confirm status is **VERIFIED** (or **RECEIVED**)

> If the status is still PENDING, the warehouse has not yet processed the delivery. Wait until it changes to VERIFIED.

### Step 2 — Run the receipt script

**Receive one PO:**
```bash
node run-receipt.js --po=PO-2026-001
```

**Receive multiple POs:**
```bash
node run-receipt.js --po=PO-2026-001,PO-2026-002
```

**Receive all verified POs:**
```bash
node run-receipt.js
```

### Step 3 — Verify in NetSuite

1. Go to **Transactions → Purchases → Receive Orders**
2. Search for the PO number
3. Confirm an **Item Receipt** record was created
4. PO status should now be **Fully Billed** or **Partially Billed**
5. Go to **Lists → Accounting → Items**, find the SKU, confirm **On Hand** quantity increased

---

## Part 5 — Create a Sales Order (SO)

### Step 1 — Add SO data to Excel

Open `Data/TP-Info-V2.xlsx`, go to the **SO** sheet, fill in all columns. Save and close.

> **WARNING:** Only run a Sales Order **once**. Running the same SO number a second time will add duplicate lines to the existing SO in NetSuite, which causes incorrect fulfillments and invoices.

### Step 2 — Run the script

**Create one SO:**
```bash
node run-so.js Data/TP-Info-V2.xlsx --so=SO-2026-1001
```

**Create multiple SOs:**
```bash
node run-so.js Data/TP-Info-V2.xlsx --so=SO-2026-1001,SO-2026-1002
```

**Create all SOs in the sheet:**
```bash
node run-so.js Data/TP-Info-V2.xlsx
```

### Step 3 — Verify in NetSuite

1. Go to **Transactions → Sales → Enter Sales Orders**
2. Search for the SO number
3. Status should be **Pending Fulfillment**
4. Confirm line items and quantities are correct

### Step 4 — Verify in CartonCloud

1. Go to **Outbound Orders** in CartonCloud
2. Find the SO by reference number
3. Status should be **PICK AND PACK** (ready for warehouse to process)

> If status is **AWAITING STOCK**, the warehouse does not have enough inventory allocated. Contact the CartonCloud warehouse administrator to enable auto-allocation.

---

## Part 6 — Dispatch Order in CartonCloud (Pick & Pack)

The warehouse team performs this step inside CartonCloud.

### Steps in CartonCloud

1. Log in to **CartonCloud**
2. Go to **Outbound Orders**
3. Find the SO by reference number
4. Status should be **PICK AND PACK**
5. Click into the order → warehouse staff pick and pack the items
6. Mark the order as **DISPATCHED**

> Once the order is DISPATCHED, the fulfillment script can run.

---

## Part 7 — Create Item Fulfillment (Dispatched → NetSuite)

After CartonCloud shows the order as **DISPATCHED**, run the fulfillment script to record the shipment in NetSuite.

### Run the script

**Fulfill one SO:**
```bash
node run-fulfillment.js Data/TP-Info-V2.xlsx --so=SO-2026-1001
```

**Fulfill multiple SOs:**
```bash
node run-fulfillment.js Data/TP-Info-V2.xlsx --so=SO-2026-1001,SO-2026-1002
```

**Fulfill all dispatched SOs:**
```bash
node run-fulfillment.js Data/TP-Info-V2.xlsx
```

### Verify in NetSuite

1. Go to **Transactions → Sales → Enter Sales Orders**
2. Search for the SO number
3. Status should now be **Pending Billing**  
   _(Changed from Pending Fulfillment — this confirms the fulfillment was recorded)_
4. Click on the SO → scroll to the **Transactions** subtab → confirm an **Item Fulfillment** record appears

---

## Part 8 — Create Invoice

After fulfillment, create the invoice to bill the customer.

### Run the script

**Invoice one SO:**
```bash
node run-invoice.js --so=SO-2026-1001
```

**Invoice multiple SOs:**
```bash
node run-invoice.js --so=SO-2026-1001,SO-2026-1002
```

### Verify in NetSuite

1. Go to **Transactions → Sales → Create Invoices**  
   — or search under **Transactions → Sales → Enter Sales Orders**, open the SO
2. The SO status should now be **Fully Billed**
3. Click on the **Transactions** subtab → an **Invoice** record should appear
4. Click the Invoice to verify:
   - Correct customer
   - Correct line items (one line per SKU, correct quantity)
   - Correct amounts

---

## Part 9 — Full Workflow Summary (Quick Reference)

| Step | Action | Command / Location |
|------|--------|--------------------|
| 1 | Fill in PO data in Excel | `Data/TP-Info-V2.xlsx` → PO sheet |
| 2 | Create PO in NS + CC | `node run-po.js Data/TP-Info-V2.xlsx --po=PO-...` |
| 3 | Verify PO in NetSuite | NS → Transactions → Purchases → PO status: Pending Receipt |
| 4 | Verify Inbound Order in CC | CC → Inbound Orders → status: PENDING/ALLOCATED |
| 5 | Goods arrive at warehouse | Warehouse receives delivery |
| 6 | CC marks order VERIFIED | CC → Inbound Orders → status: VERIFIED |
| 7 | Create Item Receipt in NS | `node run-receipt.js --po=PO-...` |
| 8 | Verify stock in NS | NS → Items → On Hand quantity increased |
| 9 | Fill in SO data in Excel | `Data/TP-Info-V2.xlsx` → SO sheet |
| 10 | Create SO in NS + CC | `node run-so.js Data/TP-Info-V2.xlsx --so=SO-...` |
| 11 | Verify SO in NetSuite | NS → Sales Orders → status: Pending Fulfillment |
| 12 | Verify Outbound Order in CC | CC → Outbound Orders → status: PICK AND PACK |
| 13 | Warehouse picks and packs | CC → Outbound Orders → mark DISPATCHED |
| 14 | Create Item Fulfillment in NS | `node run-fulfillment.js Data/TP-Info-V2.xlsx --so=SO-...` |
| 15 | Verify fulfillment in NS | NS → Sales Orders → status: Pending Billing |
| 16 | Create Invoice in NS | `node run-invoice.js --so=SO-...` |
| 17 | Verify invoice in NS | NS → Sales Orders → status: Fully Billed |

---

## Part 10 — Important Rules

1. **Never run run-so.js or run-po.js twice on the same record number.** It will add duplicate lines to the existing NS record, causing wrong fulfillments and invoices.

2. **Wait for CC status before running the next script.** Run `run-receipt.js` only after CC shows VERIFIED. Run `run-fulfillment.js` only after CC shows DISPATCHED.

3. **Check output files for errors.** Each script saves results to the `output/` folder:
   - `output/create-po-result.json`
   - `output/create-so-result.json`
   - `output/receipt-result.json`
   - `output/fulfillment-result.json`
   - `output/invoice-result.json`

4. **If a script shows ERR, do not re-run it.** Investigate the error first. Re-running may create duplicates.

5. **One SO = one outbound order in CC.** If you see multiple lines on an invoice, duplicate SO lines were created. Contact the system administrator.
