// create-excel.js
// Creates Data/TP-Info.xlsx with a sheet named 'itemInventory'
// Run: node create-excel.js

const XLSX = require('xlsx');
const path = require('path');

const items = [
  {
    sku:             'TP-88001',
    displayName:     'Widget A',
    barcode:         '012345678901',
    uomInternalId:   1,
    weightKg:        0.5,
    lengthCm:        10,
    widthCm:         8,
    heightCm:        5,
    retailPrice:     29.99,
    costPrice:       12.00,
    casePackQty:     12,
    assetAccountId:  123,
    incomeAccountId: 456,
    cogsAccountId:   789,
    cartonCloudId:   'CC-9001',
    lifecycleStatus: 'Active',
  },
  {
    sku:             'TP-88002',
    displayName:     'Widget B',
    barcode:         '012345678902',
    uomInternalId:   1,
    weightKg:        1.2,
    lengthCm:        15,
    widthCm:         10,
    heightCm:        8,
    retailPrice:     49.99,
    costPrice:       20.00,
    casePackQty:     6,
    assetAccountId:  123,
    incomeAccountId: 456,
    cogsAccountId:   789,
    cartonCloudId:   'CC-9002',
    lifecycleStatus: 'Active',
  },
  {
    sku:             'TP-88003',
    displayName:     'Widget C',
    barcode:         '012345678903',
    uomInternalId:   1,
    weightKg:        0.3,
    lengthCm:        8,
    widthCm:         6,
    heightCm:        4,
    retailPrice:     19.99,
    costPrice:       8.00,
    casePackQty:     24,
    assetAccountId:  123,
    incomeAccountId: 456,
    cogsAccountId:   789,
    cartonCloudId:   'CC-9003',
    lifecycleStatus: 'Active',
  },
];

const OUTPUT_FILE = path.join(__dirname, 'Data', 'TP-Info.xlsx');

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(items);
XLSX.utils.book_append_sheet(wb, ws, 'itemInventory');
XLSX.writeFile(wb, OUTPUT_FILE);

console.log(`Created: ${OUTPUT_FILE}`);
