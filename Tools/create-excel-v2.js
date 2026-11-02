// create-excel-v2.js
// Creates Data/TP-Info-v2.xlsx with 5 sheets:
//   ProductID, PurchasingSelling, InventoryAccounting, Integration, Locations
// Run: node Tools/create-excel-v2.js

const XLSX = require('xlsx');
const path = require('path');

// ── Sheet 1: ProductID ────────────────────────────────────────────────────────
const productID = [
  { sku: 'TP-88001', displayName: 'Widget A', pieceBarcode: '012345678901', cartonBarcode: '112345678901', piecesPerCarton: 12, stockUomId: '', lifecycleStatus: 'Active' },
  { sku: 'TP-88002', displayName: 'Widget B', pieceBarcode: '012345678902', cartonBarcode: '112345678902', piecesPerCarton: 6,  stockUomId: '', lifecycleStatus: 'Active' },
  { sku: 'TP-88003', displayName: 'Widget C', pieceBarcode: '012345678903', cartonBarcode: '112345678903', piecesPerCarton: 24, stockUomId: '', lifecycleStatus: 'Active' },
];

// ── Sheet 2: PurchasingSelling ────────────────────────────────────────────────
const purchasingSelling = [
  { sku: 'TP-88001', costPrice: 12.00, retailPrice: 29.99, wholesalePrice: 110.00, onlinePrice: 27.99, purchaseUomId: '', saleUomId: '' },
  { sku: 'TP-88002', costPrice: 20.00, retailPrice: 49.99, wholesalePrice: 110.00, onlinePrice: 45.99, purchaseUomId: '', saleUomId: '' },
  { sku: 'TP-88003', costPrice: 8.00,  retailPrice: 19.99, wholesalePrice: 168.00, onlinePrice: 17.99, purchaseUomId: '', saleUomId: '' },
];

// ── Sheet 3: InventoryAccounting ──────────────────────────────────────────────
const inventoryAccounting = [
  { sku: 'TP-88001', weightKg: 0.5, lengthCm: 10, widthCm: 8,  heightCm: 5, assetAccountId: 125, incomeAccountId: 108, cogsAccountId: 210, leadTimeDays: 14 },
  { sku: 'TP-88002', weightKg: 1.2, lengthCm: 15, widthCm: 10, heightCm: 8, assetAccountId: 125, incomeAccountId: 108, cogsAccountId: 210, leadTimeDays: 14 },
  { sku: 'TP-88003', weightKg: 0.3, lengthCm: 8,  widthCm: 6,  heightCm: 4, assetAccountId: 125, incomeAccountId: 108, cogsAccountId: 210, leadTimeDays: 14 },
];

// ── Sheet 4: Integration ──────────────────────────────────────────────────────
const integration = [
  { sku: 'TP-88001', nsInternalId: 234, cartonCloudId: 'fa7d0067-902d-4c45-b239-0f3268f09e81', lightSpeedId: '', ccWarehouseId: '', ccRetailId: '' },
  { sku: 'TP-88002', nsInternalId: 134, cartonCloudId: '5bc4cff8-93bd-4f4b-9582-2bafac553c0a', lightSpeedId: '', ccWarehouseId: '', ccRetailId: '' },
  { sku: 'TP-88003', nsInternalId: 235, cartonCloudId: '801f6759-97c6-4d22-bc34-459dfde40f8a', lightSpeedId: '', ccWarehouseId: '', ccRetailId: '' },
];

// ── Sheet 5: Locations ────────────────────────────────────────────────────────
// One row per SKU per location. Add as many rows per SKU as needed.
// locationId = NetSuite internal ID (hover over location name in Setup → Company → Locations)
const locations = [
  // TP-88001
  { sku: 'TP-88001', locationId: 2, locationName: 'Wholesale Warehouse', reorderPoint: 50,  preferredStock: 200 },
  { sku: 'TP-88001', locationId: 3, locationName: 'TP-Retail store1',    reorderPoint: 10,  preferredStock: 50  },
  { sku: 'TP-88001', locationId: 4, locationName: 'TP-Retail store2',    reorderPoint: 10,  preferredStock: 50  },
  // TP-88002
  { sku: 'TP-88002', locationId: 2, locationName: 'Wholesale Warehouse', reorderPoint: 30,  preferredStock: 100 },
  { sku: 'TP-88002', locationId: 3, locationName: 'TP-Retail store1',    reorderPoint: 5,   preferredStock: 20  },
  { sku: 'TP-88002', locationId: 4, locationName: 'TP-Retail store2',    reorderPoint: 5,   preferredStock: 20  },
  // TP-88003
  { sku: 'TP-88003', locationId: 2, locationName: 'Wholesale Warehouse', reorderPoint: 100, preferredStock: 400 },
  { sku: 'TP-88003', locationId: 3, locationName: 'TP-Retail store1',    reorderPoint: 20,  preferredStock: 100 },
  { sku: 'TP-88003', locationId: 4, locationName: 'TP-Retail store2',    reorderPoint: 20,  preferredStock: 100 },
];

// ── Build workbook ────────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productID),           'ProductID');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchasingSelling),   'PurchasingSelling');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inventoryAccounting), 'InventoryAccounting');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(integration),         'Integration');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(locations),           'Locations');

const OUTPUT_FILE = path.join(__dirname, '..', 'Data', 'TP-Info-v2.xlsx');
XLSX.writeFile(wb, OUTPUT_FILE);
console.log(`Created: ${OUTPUT_FILE}`);
