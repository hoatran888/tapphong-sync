# Celigo Integration Issues — Tap Phong Trading
**Date:** November 2026  
**Prepared for:** Celigo administrator / integration consultant  
**Systems involved:** NetSuite (sandbox: 12222161_SB1) ↔ CartonCloud

---

## Summary

Celigo was disabled on all 4 flows due to data corruption in NetSuite. Before re-enabling any flow, the field mappings described below must be audited and corrected.

---

## Incident: PO otherrefnum Corruption

### What happened

NetSuite Purchase Order **PO36** (internalId = 1258), which correctly represented **PO-2026-1005**, had its `otherrefnum` field overwritten by Celigo to **PO-2026-1006**.

This caused a cascade of failures:

1. NS search for PO-2026-1006 returned PO36 (internalId=1258) instead of a new record
2. The integration attempted to update PO36 as if it were PO-2026-1006
3. PO-2026-1006 was never created correctly
4. PO-2026-1005 lost its reference number and became unfindable by its own PO number

### Root cause

Celigo's **TP-PO-Flow** searches NS for an existing PO by reference number before deciding to create or update. The flow appears to have:
- Fetched the wrong PO from NS (possibly due to a stale search index or incorrect filter)
- Written PO-2026-1006 into the `otherrefnum` field of PO36 (which belonged to PO-2026-1005)

### Fix applied

A one-shot script (`Test/fix-po36-otherrefnum.js`) was run to restore PO36's `otherrefnum` back to `PO-2026-1005` via NS REST Record API PATCH.

Additionally, the custom NS RESTlet (`rl_create_po.js`, Script 1944) was updated to detect stale search index results by verifying the loaded record's `otherrefnum` matches the requested PO number before updating. This protects against future corruption regardless of Celigo.

---

## Flows Disabled

| Flow name | Direction | Reason disabled |
|-----------|-----------|----------------|
| TP-PO-Flow | NS → CC | Caused otherrefnum corruption on PO36 |
| NS item sync | NS → CC | Disabled as precaution during investigation |
| TP-SO-Celigo | NS → CC | Disabled as precaution during investigation |
| PO webhook listener | CC → NS | Disabled as precaution during investigation |

---

## Field Mappings to Audit Before Re-enabling

### TP-PO-Flow (NS PO → CC Inbound Order)

| Field | Issue | Required fix |
|-------|-------|-------------|
| `otherrefnum` | Used as the lookup key to find existing PO. Must match exactly. | Verify the search filter uses `otherrefnum` with operator `is` (exact match), NOT `contains` or `startswith` |
| PO lookup logic | Flow must NOT update a PO if the loaded record's `otherrefnum` does not exactly match the PO number being processed | Add field-level validation: if loaded `otherrefnum` ≠ requested PO number, abort update and create new record instead |
| NS search index lag | NS search index can be stale for 30–60 seconds after a record is created/modified | Add a fallback: if search returns a result, load the actual record and verify `otherrefnum` before proceeding |

### TP-SO-Celigo (NS SO → CC Outbound Order)

| Field | Issue | Required fix |
|-------|-------|-------------|
| SO lookup key | Verify which field is used to match existing SOs (should be `tranid` or custom `otherrefnum`) | Confirm exact-match filter, not partial match |
| CC customer ID | The CC customer UUID for each NS customer must be mapped correctly | Verify the `ccCustomerId` mapping table is current and correct |
| CC delivery address | CC uses Address Strings (routing groups), not plain addresses | Verify `ccDeliverAddressId` is mapped per customer, not hardcoded |

### NS item sync (NS Item → CC Product)

| Field | Issue | Required fix |
|-------|-------|-------------|
| SKU | NS uses `itemid` as SKU (e.g. `TP-2026-1006`) | Verify CC product `code` or `references.code` is set from NS `itemid` |
| Unit of measure | Items use custom UoM type `TP-CASE-10` | Verify UoM mapping to CC unit fields |

---

## NS Sandbox Credentials Reference

The integration runs against **NS Sandbox** (`12222161_SB1`). Key script/deploy IDs:

| RESTlet | NS Script ID | Deploy ID |
|---------|-------------|-----------|
| Create/Update PO | 1944 | 1 |
| Create/Update SO | 1945 | 1 |
| Item Fulfillment | 1946 | 1 |
| PO Receipt | 1950 | 1 |
| Inventory | 2055 | 1 |
| Invoice | 2056 | 1 |
| Inv Adjustment | 2057 | 1 |

---

## Recommended Testing Protocol Before Go-Live

1. **Test in NS Sandbox only** — do not run against production NS until all flows are verified
2. **Run each flow once manually** with a test PO/SO number and verify:
   - Correct record is created/updated in NS
   - `otherrefnum` matches exactly
   - No existing records are modified unexpectedly
3. **Check NS execution logs** after each test run (NS → Customization → Script Execution Log, Script 1944)
4. **Run reconcile-inventory.js** before and after enabling flows to confirm no inventory data is affected
5. **Enable flows one at a time**, not all at once

---

## Contact / Custom Code Reference

Custom NS RESTlets and local sync scripts are in the Git repository:  
`https://github.com/hoatran888/tapphong-sync`

The RESTlet fix for stale search index (`rl_create_po.js`) is committed on `main` branch and should remain deployed in NS even when Celigo is re-enabled — it acts as a safety net.
