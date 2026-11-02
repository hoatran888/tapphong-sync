# rl_create_item.js — Line by Line Explanation

*Date: 2026-10-20*

---

## Lines 1–4 — NetSuite metadata tags

```js
/**
 * @NScriptType Restlet
 * @NApiVersion 2.1
 */
```
Tells NetSuite: this is a RESTlet script using SuiteScript API version 2.1. NetSuite reads these tags when you upload the file.

---

## Line 5 — Load NetSuite modules

```js
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {
```
AMD module syntax (NetSuite's way of importing). Loads 3 built-in modules:
- `record` — create/load/save NS records
- `search` — search the NS database
- `log` — write to the execution log

---

## Lines 7–15 — `post()` — RESTlet entry point

```js
const post = (body) => {
  try {
    const internalId = upsertInventoryItem(body);
    return { success: true, internalId };
  } catch (e) {
    log.error({ title: 'RESTlet error', details: e.message });
    return { success: false, error: e.message };
  }
};
```
NetSuite calls `post(body)` when it receives your HTTP POST. `body` is the JSON you sent from `run.js`. If anything crashes, catches the error and returns `{ success: false }` instead of crashing.

---

## Lines 17–24 — `findItemBySku()` — check if item already exists

```js
const findItemBySku = (sku) => {
  const found = search.create({
    type:    search.Type.INVENTORY_ITEM,
    filters: [['itemid', 'is', sku]],
    columns: ['internalid'],
  }).run().getRange({ start: 0, end: 1 });
  return found.length ? found[0].getValue('internalid') : null;
};
```
Searches NS for an inventory item where `itemid = sku`. Returns the internal ID if found, `null` if not. Used to decide create vs update.

---

## Lines 27–39 — `getUnitIds()` — load unit abbreviations from Unit Type

```js
const getUnitIds = (unitsTypeId) => {
  if (!unitsTypeId || Number(unitsTypeId) <= 0) return {};
  const ut = record.load({ type: record.Type.UNITS_TYPE, id: Number(unitsTypeId) });
  const lineCount = ut.getLineCount({ sublistId: 'uom' });
  const map = {};
  for (let i = 0; i < lineCount; i++) {
    const abbr = ut.getSublistValue({ sublistId: 'uom', fieldId: 'abbreviation', line: i });
    const id   = ut.getSublistValue({ sublistId: 'uom', fieldId: 'internalid',   line: i });
    if (abbr) map[abbr] = id;
  }
  log.audit({ title: 'UnitIds', details: JSON.stringify(map) });
  return map;
};
```
- Loads the Unit Type record (e.g. ID 6) from NS
- Loops through all units in the `uom` sublist
- Builds a map: `{ "PCS": 12, "PAL": 15 }`
- Logs it so you can verify in execution log
- Returns the map so abbreviations can be converted to internal IDs

---

## Lines 42–56 — `setPriceLevel()` — set a price on the price sublist

```js
const setPriceLevel = (item, levelName, price, unitId) => {
  if (!price || Number(price) <= 0) return;
  const lineCount = item.getLineCount({ sublistId: 'price' });
  for (let i = 0; i < lineCount; i++) {
    const text = item.getSublistText({ sublistId: 'price', fieldId: 'pricelevel', line: i });
    if (text !== levelName) continue;
    if (unitId) {
      const lineUnit = item.getSublistValue({ sublistId: 'price', fieldId: 'unit', line: i });
      if (Number(lineUnit) !== Number(unitId)) continue;
    }
    item.setSublistValue({ sublistId: 'price', fieldId: 'price', line: i, value: Number(price) });
    return;
  }
  log.audit(...);
};
```
Scans every row in the price sublist. Finds the row matching both the price level name (e.g. `"Base Price"`) and optionally the unit (e.g. PCS). Sets the price on that row.

---

## Lines 59–73 — `setLocationData()` — set reorder/preferred stock per location

```js
const setLocationData = (item, locationId, reorderPoint, preferredStock) => {
  if (!locationId || Number(locationId) <= 0) return;
  // find the locations sublist row matching locationId
  // selectLine → setCurrentSublistValue → commitLine
};
```
Finds the matching location row in the `locations` sublist, sets `reorderpoint` and `preferredstocklevel`, then commits the line.

---

## Lines 75–152 — `upsertInventoryItem()` — main logic

**Check if SKU already exists:**
```js
const existingId = findItemBySku(data.sku);
```

**Load or create the record:**
```js
const item = existingId
  ? record.load({ ..., isDynamic: false })    // update existing
  : record.create({ ..., isDynamic: false }); // create new
```
`isDynamic: false` required for the price sublist to work.

**Set core identity fields:**
```js
item.setValue({ fieldId: 'itemid',      value: data.sku });
item.setValue({ fieldId: 'displayname', value: data.displayName });
item.setValue({ fieldId: 'upccode',     value: data.barcode });
```

**Set Units of Measure:**
```js
if (data.unitsTypeId > 0) {
  item.setValue({ fieldId: 'unitstype',    value: unitsTypeId });
  item.setValue({ fieldId: 'stockunit',    value: unitIds["PCS"] });
  item.setValue({ fieldId: 'saleunit',     value: unitIds["PCS"] });
  item.setValue({ fieldId: 'purchaseunit', value: unitIds["PAL"] });
}
```

**Set prices, passing the sale unit ID:**
```js
setPriceLevel(item, 'Base Price',        data.retailPrice,    saleUnitId);
setPriceLevel(item, 'Alternate Price 2', data.wholesalePrice, saleUnitId);
setPriceLevel(item, 'Online Price',      data.onlinePrice,    saleUnitId);
```

**Set accounting accounts (skip if ≤ 100 to avoid placeholder values):**
```js
if (data.assetAccountId > 100)  item.setValue({ fieldId: 'assetaccount', ... });
if (data.incomeAccountId > 100) item.setValue({ fieldId: 'incomeaccount', ... });
if (data.cogsAccountId > 100)   item.setValue({ fieldId: 'cogsaccount', ... });
```

**Save Pass 1 (body + pricing):**
```js
const savedId = item.save({ ignoreMandatoryFields: true });
```

**Pass 2 — reload with `isDynamic: true` to set location data:**
```js
const item2 = record.load({ ..., isDynamic: true });
for (const loc of data.locations) {
  setLocationData(item2, loc.locationId, loc.reorderPoint, loc.preferredStock);
}
item2.save();
```
Must be a second load because location sublist requires dynamic mode, price sublist requires non-dynamic — they cannot both be set in the same load.

---

## Line 154 — expose `post` to NetSuite

```js
return { post };
```
NetSuite looks for this returned object to find the `post` function to call when it receives a POST request.

---

## Two-pass save summary

| Pass | isDynamic | What gets set |
|---|---|---|
| Pass 1 | `false` | All body fields + price sublist |
| Pass 2 | `true` | Locations sublist (reorder point, preferred stock) |
