# NetSuite UOM + Price Level Support — How to Test

*Date: 2026-10-20*

---

## What was added to rl_create_item.js

- `getUnitIds(unitsTypeId)` — loads Unit Type record, returns `{ abbreviation: internalId }` map
- `setPriceLevel()` — updated to also match unit column when UOM is in use
- UOM section — sets `unitstype`, `stockunit`, `saleunit`, `purchaseunit` by abbreviation

---

## JSON payload to test with

```json
{
  "sku": "TP-PAL-001",
  "displayName": "Test Pallet Product",
  "unitsTypeId": 6,
  "stockUnit": "PCS",
  "saleUnit": "PCS",
  "purchaseUnit": "PAL",
  "retailPrice": 10,
  "wholesalePrice": 8
}
```

---

## How to test

### Option 1 — Postman (easiest)

1. Open Postman
2. Create a new request:
   - Method: `POST`
   - URL: `https://12222161-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=1942&deploy=1`
3. Set Authorization:
   - Type: **OAuth 1.0**
   - Consumer Key/Secret: from `.env`
   - Token Key/Secret: from `.env`
   - Realm: `12222161_SB1`
   - Signature Method: `HMAC-SHA256`
4. Body → raw → JSON → paste the JSON above
5. Send → expect `{ "success": true, "internalId": 123 }`

### Option 2 — Node.js test script

Create a file `Tools/test-uom.js`:

```js
require('dotenv').config();
const { createItem } = require('../call-create-item');

(async () => {
  const result = await createItem({
    sku:          'TP-PAL-001',
    displayName:  'Test Pallet Product',
    unitsTypeId:  6,
    stockUnit:    'PCS',
    saleUnit:     'PCS',
    purchaseUnit: 'PAL',
    retailPrice:  10,
    wholesalePrice: 8,
  });
  console.log(result);
})();
```

Run:
```bash
node Tools/test-uom.js
```

---

## How to verify in NetSuite after test

1. Go to **Lists → Accounting → Items**
2. Search for `TP-PAL-001`
3. Open the item → check:
   - **Units tab** → Stock Unit = PCS, Sale Unit = PCS, Purchase Unit = PAL
   - **Sales/Pricing tab** → Base Price / PCS = $10.00, Alternate Price 2 / PCS = $8.00

4. Check the **Execution Log** for debug output:
```
Customization → Scripting → Script Deployments
→ find your deployment → Execution Log tab
→ look for: UnitIds { "PCS": xx, "PAL": xx }
```

---

## How field mapping works

| JSON field | NetSuite field | How resolved |
|---|---|---|
| `unitsTypeId: 6` | `unitstype` | set directly by ID |
| `stockUnit: "PCS"` | `stockunit` | looked up via `getUnitIds(6)["PCS"]` |
| `saleUnit: "PCS"` | `saleunit` | looked up via `getUnitIds(6)["PCS"]` |
| `purchaseUnit: "PAL"` | `purchaseunit` | looked up via `getUnitIds(6)["PAL"]` |
| `retailPrice: 10` | price sublist / Base Price / PCS | matched by level name + unit ID |
| `wholesalePrice: 8` | price sublist / Alternate Price 2 / PCS | matched by level name + unit ID |
