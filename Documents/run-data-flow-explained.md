# How run.js Data Flow Works: mapRow → createItem

## The Full Flow

```
Excel rows → mapRow(row) → item object → createItem(item)    [NetSuite RESTlet]
                                        → upsertProduct(item) [CartonCloud]
```

## Step by Step

1. **Load file** — `loadItems()` reads the Excel file and returns raw rows as plain objects. Each row's keys are the exact column header names from the Excel sheet (e.g. `"Display Name"`, `"SKU"`, `"Retail Price"`).

2. **`mapRow(row)`** — transforms every raw row into a clean, consistent payload object:
   - Renames columns to camelCase field names (`"Retail Price"` → `retailPrice`)
   - Handles alternate column name spellings (`row['sku'] || row['SKU']`)
   - Converts strings to numbers where needed (`Number(row['retailPrice'] || 0)`)
   - Sets defaults for missing fields (`subsidiaryIds` defaults to `[3]`)
   - Result: one clean object per item with predictable field names

3. **Loop over items** (`run.js` lines 230–258):
   - Each `item` in the loop is the output of `mapRow()`
   - `createItem(item)` — POSTs the payload to the NetSuite RESTlet (`rl_create_item.js`), which reads `data.sku`, `data.retailPrice`, `data.subsidiaryIds`, etc.
   - `upsertProduct(item)` — sends the same payload to CartonCloud

## Why This Structure

`mapRow` is the single translation layer between "whatever column names are in the Excel" and "the field names both systems expect." This means:
- The RESTlet and CartonCloud code never need to know about Excel column names
- If the Excel column names change, only `mapRow` needs updating
- Both NetSuite and CartonCloud receive the same clean object

## Code Reference

```js
// run.js
const allItems = rows.map(mapRow);          // transform all rows
// ...
for (const item of uniqueItems) {
  const nsRes = await createItem(item);     // → NetSuite
  const ccRes = await upsertProduct(item);  // → CartonCloud
}
```
