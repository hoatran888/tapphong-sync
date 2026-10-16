# run.js — Read Items from CSV or Excel and Send to NetSuite

---

## Install dependencies

```bash
npm install csv-parse xlsx
```

---

## How to run

```bash
# With CSV
node run.js items-sample.csv

# With Excel
node run.js items.xlsx
```

---

## run.js

```javascript
// run.js
const fs   = require('fs');
const path = require('path');
const { createItem } = require('./call-create-item');

// ── file parsers ──────────────────────────────────────────────────────────────

function readCSV(filePath) {
  const { parse } = require('csv-parse/sync');
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function readExcel(filePath) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet);
}

function loadItems(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv')                      return readCSV(filePath);
  if (ext === '.xlsx' || ext === '.xls')   return readExcel(filePath);
  throw new Error(`Unsupported file type: ${ext}. Use .csv, .xlsx or .xls`);
}

// ── field mapping: CSV/Excel column names → NS field names ───────────────────
// Column headers in your file must match the keys on the left exactly.

function mapRow(row) {
  return {
    sku:             row['sku']              || row['SKU'],
    displayName:     row['displayName']      || row['Display Name'],
    barcode:         row['barcode']          || row['Barcode'],
    uomInternalId:   Number(row['uomInternalId']   || row['UOM ID']   || 1),
    weightKg:        Number(row['weightKg']         || row['Weight(kg)'] || 0),
    lengthCm:        Number(row['lengthCm']         || row['Length(cm)'] || 0),
    widthCm:         Number(row['widthCm']          || row['Width(cm)']  || 0),
    heightCm:        Number(row['heightCm']         || row['Height(cm)'] || 0),
    retailPrice:     Number(row['retailPrice']      || row['Retail Price'] || 0),
    costPrice:       Number(row['costPrice']        || row['Cost Price']   || 0),
    casePackQty:     Number(row['casePackQty']      || row['Case Pack']    || 1),
    assetAccountId:  Number(row['assetAccountId']   || row['Asset Account ID']  || 0),
    incomeAccountId: Number(row['incomeAccountId']  || row['Income Account ID'] || 0),
    cogsAccountId:   Number(row['cogsAccountId']    || row['COGS Account ID']   || 0),
    cartonCloudId:   row['cartonCloudId']    || row['CartonCloud ID'] || '',
    lifecycleStatus: row['lifecycleStatus']  || row['Lifecycle Status'] || 'Active',
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

const inputFile   = process.argv[2];
const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'create-item-result.json');

if (!inputFile) {
  console.error('Usage: node run.js <path-to-file.csv|xlsx>');
  console.error('Example: node run.js items.csv');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

(async () => {
  console.log(`Reading items from: ${inputFile}`);
  const rows    = loadItems(inputFile);
  const items   = rows.map(mapRow);
  const results = [];

  console.log(`Found ${items.length} item(s). Sending to NetSuite...\n`);

  for (const item of items) {
    try {
      const response = await createItem(item);
      results.push({ sku: item.sku, status: 'ok', internalId: response.internalId });
      console.log(`OK   ${item.sku}  →  internalId: ${response.internalId}`);
    } catch (err) {
      results.push({
        sku:    item.sku,
        status: 'error',
        error:  err.message,
        detail: err.response?.data,
      });
      console.error(`ERR  ${item.sku}  →  ${err.message}`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  const ok  = results.filter(r => r.status === 'ok').length;
  const err = results.filter(r => r.status === 'error').length;
  console.log(`\nDone. ${ok} succeeded, ${err} failed.`);
  console.log(`Results saved to: ${OUTPUT_FILE}`);
})();
```

---

## CSV template — items-sample.csv

```
sku,displayName,barcode,uomInternalId,weightKg,lengthCm,widthCm,heightCm,retailPrice,costPrice,casePackQty,assetAccountId,incomeAccountId,cogsAccountId,cartonCloudId,lifecycleStatus
ITEM-001,Widget A,012345678901,1,0.5,10,8,5,29.99,12.00,12,123,456,789,CC-9001,Active
ITEM-002,Widget B,012345678902,1,1.2,15,10,8,49.99,20.00,6,123,456,789,CC-9002,Active
ITEM-003,Widget C,012345678903,1,0.3,8,6,4,19.99,8.00,24,123,456,789,CC-9003,Active
```

For Excel, use the same column headers in row 1.

---

## Sample terminal output

```
Reading items from: items-sample.csv
Found 3 item(s). Sending to NetSuite...

OK   ITEM-001  →  internalId: 12345
OK   ITEM-002  →  internalId: 12346
ERR  ITEM-003  →  Request failed with status code 401

Done. 2 succeeded, 1 failed.
Results saved to: output/create-item-result.json
```

---

## Sample output/create-item-result.json

```json
[
  { "sku": "ITEM-001", "status": "ok", "internalId": 12345 },
  { "sku": "ITEM-002", "status": "ok", "internalId": 12346 },
  { "sku": "ITEM-003", "status": "error", "error": "Request failed with status code 401" }
]
```

---

## Supported file types

| Extension | Parser |
|---|---|
| `.csv` | `csv-parse` |
| `.xlsx` | `xlsx` (SheetJS) |
| `.xls` | `xlsx` (SheetJS) |

---

*Generated: 2026-10-15*
