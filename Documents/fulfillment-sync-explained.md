# Fulfillment Sync: CC → NS

## What It Does

**Business flow:**
1. A customer orders goods → Sales Order (SO) created in NetSuite
2. The SO is sent to CartonCloud as an **Outbound Order** for the warehouse to pick & pack
3. The warehouse dispatches the goods in CartonCloud (status → DISPATCHED)
4. This sync detects that dispatch and creates an **Item Fulfillment** in NetSuite — marking the SO as shipped

Without this sync, NetSuite never knows the goods left the warehouse, so the SO stays open forever.

---

## When to Run It

| Trigger | Command | Use case |
|---|---|---|
| Scheduled (e.g. daily) | `node run-fulfillment.js` | Batch sync at end of day |
| Real-time | `node run-fulfillment.js --webhook` | As soon as CC dispatches, NS updates |

**Pre-conditions before it works:**
- SO must be **Approved** in NetSuite
- SO must be dispatched (status DISPATCHED / DELIVERED / COLLECTED) in CartonCloud
- The CC outbound order must have the NS SO number in its **Customer Reference** field

---

## What It Creates in NetSuite

An **Item Fulfillment** record linked to the SO — this:
- Marks the SO line items as shipped
- Reduces inventory on hand
- Triggers any downstream billing/invoicing workflows

---

## Files Involved

| File | Purpose |
|---|---|
| `run-fulfillment.js` | Entry point — poll or webhook mode |
| `call-create-fulfillment.js` | Node.js wrapper that calls the NS RESTlet |
| `rl_create_fulfillment.js` | NetSuite RESTlet (uploaded to NS, script ID 1946) |
| `cartoncloud.js` | `getDispatchedOutboundOrders()` fetches dispatched CC orders |
| `output/fulfillment-result.json` | Results log (upserted by soNumber) |

---

## How Location Is Resolved

The NS Item Fulfillment requires a warehouse location. Resolution order:
1. SO header location field
2. `InventoryBalance` SuiteQL query — finds where the item's stock actually is
3. `locationId` passed in the request (from `NS_DEFAULT_LOCATION_ID` in `.env`)
