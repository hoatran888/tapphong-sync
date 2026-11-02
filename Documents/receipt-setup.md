# Item Receipt Automation Setup

## Files Built

| File | Purpose |
|---|---|
| `rl_create_receipt.js` | NS RESTlet — upload to NS, transforms PO → Item Receipt |
| `call-create-receipt.js` | Node caller — checks CC verified, calls RESTlet |
| `run-receipt.js` | Runner — poll or webhook mode |
| `cartoncloud.js` | Added `getVerifiedInboundOrders()` |
| `rl_create_po.js` | Added `autoApprove` support |
| `run-po.js` | Added `autoApprove` column reading |

## Conditions Required Before Running

1. **PO must exist** in NS with matching `otherRefNum` (the poNumber)
2. **PO must be approved** — status must be one of:
   - `Pending Receipt` (fully open)
   - `Partially Received` (some lines already received)
   - NOT `Pending Approval` or `Rejected`
3. **No existing Item Receipt** for that PO (unless `force=true` is passed)
4. **RESTlet must be deployed** in NS with Script ID set in `.env`
5. **CC inbound order must be VERIFIED** — CC workflow: Received → Verified

## Setup Steps

### 1. Upload RESTlet to NetSuite
- Go to **Customization → Scripting → Scripts → New**
- Upload `rl_create_receipt.js`
- Set Script Type: **RESTlet**
- Save and Deploy
- Note the **Script ID** and **Deploy ID**

### 2. Set Environment Variables
Add to `.env`:
```
NS_RECEIPT_SCRIPT_ID=<script id from NS>
NS_RECEIPT_DEPLOY_ID=1
RECEIPT_WEBHOOK_PORT=3001
```

### 3. Fix PO Approval (one-time NS setting)
To avoid POs getting stuck in "Pending Approval":
- **Setup → Accounting → Accounting Preferences → Purchases**
- Uncheck **"Require Approval for Purchase Orders"**

Or add `autoApprove` column to the PO sheet in Excel:
- `yes` → PO created/updated as approved (Pending Receipt)
- `no` or blank → PO stays as Pending Approval (default)

### 4. Run Receipt Sync

**Poll mode** — process all verified CC inbound orders:
```
node run-receipt.js
```

**Webhook mode** — listen for CC events on port 3001:
```
node run-receipt.js --webhook
```

## Flow Summary

```
CC inbound order VERIFIED
        ↓
run-receipt.js (poll or webhook)
        ↓
call-create-receipt.js (checks CC status)
        ↓
rl_create_receipt.js (NS RESTlet)
        ↓
Item Receipt created in NS
PO status → Pending Bill
```

## Output

Results saved to `output/receipt-result.json` (appended, not overwritten).
