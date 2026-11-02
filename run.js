// run.js
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createItem }                             = require('./call-create-item');
const { upsertProduct, upsertWarehouseProduct }  = require('./cartoncloud');

// ── file parsers ──────────────────────────────────────────────────────────────

function readCSV(filePath) {
  const { parse } = require('csv-parse/sync');
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function readSheet(workbook, name) {
  const sheet = workbook.Sheets[name];
  return sheet ? XLSX.utils.sheet_to_json(sheet) : null;
}

function readExcel(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath);

  // New multi-sheet format: ProductID + PurchasingSelling + InventoryAccounting + Integration + Locations
  if (workbook.SheetNames.includes('ProductID')) {
    const itemMap = {};
    for (const name of ['ProductID', 'PurchasingSelling', 'InventoryAccounting', 'Integration']) {
      const rows = readSheet(workbook, name);
      if (!rows) continue;
      for (const row of rows) {
        const sku = row.sku || row.SKU;
        if (!sku) continue;
        if (!itemMap[sku]) itemMap[sku] = {};
        Object.assign(itemMap[sku], row);
      }
    }
    // Locations sheet: multiple rows per SKU → array
    const locRows = readSheet(workbook, 'Locations');
    if (locRows) {
      for (const row of locRows) {
        const sku = row.sku || row.SKU;
        if (!sku || !itemMap[sku]) continue;
        if (!itemMap[sku]._locations) itemMap[sku]._locations = [];
        itemMap[sku]._locations.push({
          locationId:     Number(row.locationId    || 0),
          reorderPoint:   Number(row.reorderPoint  || 0),
          preferredStock: Number(row.preferredStock || 0),
        });
      }
    }
    return Object.values(itemMap);
  }

  // Legacy single-sheet format
  const name  = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Sheet "${name}" not found. Available: ${workbook.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json(sheet);
}

function loadItems(filePath, sheetName) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv')                    return readCSV(filePath);
  if (ext === '.xlsx' || ext === '.xls') return readExcel(filePath, sheetName);
  throw new Error(`Unsupported file type: ${ext}. Use .csv, .xlsx or .xls`);
}

// ── field mapping ─────────────────────────────────────────────────────────────

function mapRow(row) {
  return {
    // ── Identity (ProductID sheet) ──
    sku:             row['sku']           || row['SKU'],
    displayName:     row['displayName']   || row['Display Name'],
    barcode:         row['pieceBarcode']  || row['barcode']  || row['Barcode'] || '',
    cartonBarcode:   row['cartonBarcode'] || '',
    piecesPerCarton: Number(row['piecesPerCarton'] || row['casePackQty'] || row['Case Pack'] || 1),
    lifecycleStatus: row['lifecycleStatus'] || row['Lifecycle Status'] || 'Active',

    // ── Units (ProductID sheet) ──
    unitsTypeId:  Number(row['unitsTypeId']  || 0),
    stockUnit:    row['stockUnit']    || '',
    saleUnit:     row['saleUnit']     || '',
    purchaseUnit: row['purchaseUnit'] || '',
    stockUomId:   Number(row['stockUomId'] || row['uomInternalId'] || row['UOM ID'] || 0),

    // ── Pricing (PurchasingSelling sheet) ──
    retailPrice:    Number(row['retailPrice']    || row['Retail Price']    || 0),
    wholesalePrice: Number(row['wholesalePrice'] || row['Wholesale Price'] || 0),
    onlinePrice:    Number(row['onlinePrice']    || row['Online Price']    || 0),
    costPrice:      Number(row['costPrice']      || row['Cost Price']      || 0),

    // ── Dimensions (InventoryAccounting sheet) ──
    weightKg: Number(row['weightKg'] || row['Weight(kg)'] || 0),
    lengthCm: Number(row['lengthCm'] || row['Length(cm)'] || 0),
    widthCm:  Number(row['widthCm']  || row['Width(cm)']  || 0),
    heightCm: Number(row['heightCm'] || row['Height(cm)'] || 0),

    // ── Accounting (InventoryAccounting sheet) ──
    assetAccountId:  Number(row['assetAccountId']  || row['Asset Account ID']  || 0),
    incomeAccountId: Number(row['incomeAccountId'] || row['Income Account ID'] || 0),
    cogsAccountId:   Number(row['cogsAccountId']   || row['COGS Account ID']   || 0),

    // ── Inventory control (InventoryAccounting sheet) ──
    leadTimeDays: Number(row['leadTimeDays'] || 0),

    // ── Subsidiaries ──
    subsidiaryIds: (row['subsidiaryIds'] || '3').toString().split(',').map(s => Number(s.trim())).filter(n => n > 0),

    // ── Locations (Locations sheet — array, one entry per location) ──
    locations: row['_locations'] || [],

    // ── Integration (Integration sheet) ──
    nsInternalId:  row['nsInternalId']  || '',
    cartonCloudId: row['cartonCloudId'] || row['CartonCloud ID'] || '',
    lightSpeedId:  row['lightSpeedId']  || '',
    ccWarehouseId: row['ccWarehouseId'] || '',
    ccRetailId:    row['ccRetailId']    || '',
  };
}

// ── write CC UUIDs + NS internal IDs back to Integration sheet ────────────────

function writeBackIds(filePath, results) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xls') return;

  const workbook = XLSX.readFile(filePath);
  const isNewFormat = workbook.SheetNames.includes('ProductID');
  const sheetName   = isNewFormat ? 'Integration' : workbook.SheetNames[0];
  const sheet       = workbook.Sheets[sheetName];
  if (!sheet) return;

  const range = XLSX.utils.decode_range(sheet['!ref']);

  // Locate header columns
  const colIndex = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    if (sheet[addr]) colIndex[sheet[addr].v] = c;
  }

  // case-insensitive column lookup helper
  const col = (...names) => {
    for (const n of names) {
      const k = Object.keys(colIndex).find(h => h.trim().toLowerCase() === n.toLowerCase());
      if (k !== undefined) return colIndex[k];
    }
    return undefined;
  };

  const skuCol  = col('sku', 'SKU');
  const ccCol   = col('cartonCloudId', 'CartonCloud ID');
  const ccWCol  = col('ccWarehouseId');
  const nsCol   = col('nsInternalId');

  if (skuCol === undefined) return;

  // Build maps from results
  const newCcIds = {}, newCcWIds = {}, newNsIds = {};
  for (const r of results) {
    if (r.cartoncloud?.status === 'ok' && r.cartoncloud.ccId)       newCcIds[r.sku]  = r.cartoncloud.ccId;
    if (r.ccWarehouse?.status === 'ok' && r.ccWarehouse.ccWarehouseId) newCcWIds[r.sku] = r.ccWarehouse.ccWarehouseId;
    if (r.netsuite?.status    === 'ok' && r.netsuite.internalId)    newNsIds[r.sku]  = r.netsuite.internalId;
  }

  let updated = 0;
  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const skuAddr = XLSX.utils.encode_cell({ r: row, c: skuCol });
    const sku     = sheet[skuAddr]?.v;
    if (!sku) continue;

    if (ccCol !== undefined && newCcIds[sku] && !sheet[XLSX.utils.encode_cell({ r: row, c: ccCol })]?.v) {
      sheet[XLSX.utils.encode_cell({ r: row, c: ccCol })] = { t: 's', v: String(newCcIds[sku]) };
      updated++;
    }
    if (ccWCol !== undefined && newCcWIds[sku] && !sheet[XLSX.utils.encode_cell({ r: row, c: ccWCol })]?.v) {
      sheet[XLSX.utils.encode_cell({ r: row, c: ccWCol })] = { t: 's', v: String(newCcWIds[sku]) };
      updated++;
    }
    if (nsCol !== undefined && newNsIds[sku]) {
      sheet[XLSX.utils.encode_cell({ r: row, c: nsCol })] = { t: 'n', v: Number(newNsIds[sku]) };
      updated++;
    }
  }

  if (updated > 0) {
    XLSX.writeFile(workbook, filePath);
    console.log(`Wrote ${updated} ID(s) back to Integration sheet: ${filePath}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

const inputFile  = process.argv[2];
const sheetName  = process.argv[3];
const skuFlag    = process.argv.find(a => a.startsWith('--sku='));
const filterSku  = skuFlag ? skuFlag.split('=')[1] : (process.argv[4] || null);
const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'create-item-result.json');

if (!inputFile) {
  console.error('Usage:');
  console.error('  node run.js <file>                        — sync all items');
  console.error('  node run.js <file> --sku=TP-88001         — sync single item (debug)');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

(async () => {
  console.log(`Reading items from: ${inputFile}`);
  const rows    = loadItems(inputFile, sheetName);
  const allItems = rows.map(mapRow);
  const items   = filterSku
    ? allItems.filter(i => i.sku === filterSku)
    : allItems;

  if (filterSku && items.length === 0) {
    console.error(`SKU "${filterSku}" not found in file.`);
    process.exit(1);
  }

  // Warn and skip duplicate SKUs
  const seen = {};
  const dupes = [];
  const dedupedItems = [];
  items.forEach((item, idx) => {
    if (seen[item.sku] !== undefined) {
      dupes.push({ sku: item.sku, firstRow: seen[item.sku] + 1, dupRow: idx + 1 });
    } else {
      seen[item.sku] = idx;
      dedupedItems.push(item);
    }
  });
  if (dupes.length > 0) {
    dupes.forEach(d => console.warn(`WARNING: duplicate SKU "${d.sku}" — keeping first occurrence, skipping duplicate`));
    console.warn('');
  }
  const uniqueItems = dedupedItems;

  console.log(`Found ${uniqueItems.length} item(s)${dupes.length ? ` (${dupes.length} duplicate(s) skipped)` : ''}. Sending to NetSuite + CartonCloud...\n`);
  const results = [];

  for (const item of uniqueItems) {
    const result = { sku: item.sku, netsuite: {}, cartoncloud: {}, ccWarehouse: {} };

    // ── NetSuite ──
    try {
      const nsRes = await createItem(item);
      if (!nsRes?.success) throw new Error(nsRes?.error || 'Unknown NS error');
      result.netsuite = { status: 'ok', internalId: nsRes.internalId };
      console.log(`NS   OK   ${item.sku}  →  internalId: ${nsRes.internalId}`);
    } catch (err) {
      result.netsuite = { status: 'error', error: err.message, detail: err.response?.data };
      console.error(`NS   ERR  ${item.sku}  →  ${err.message}`);
      console.error(`NS   DETAIL:`, JSON.stringify(err.response?.data, null, 2));
    }

    // ── CartonCloud transport product ──
    try {
      const ccRes = await upsertProduct(item);
      result.cartoncloud = { status: 'ok', action: ccRes.action, ccId: ccRes.ccId };
      console.log(`CC   OK   ${item.sku}  →  ccId: ${ccRes.ccId} (${ccRes.action})`);
    } catch (err) {
      result.cartoncloud = { status: 'error', error: err.message, detail: err.response?.data };
      console.error(`CC   ERR  ${item.sku}  →  ${err.message}`);
      console.error(`CC   DETAIL:`, JSON.stringify(err.response?.data, null, 2));
    }

    // ── CartonCloud warehouse product ──
    try {
      const wRes = await upsertWarehouseProduct(item);
      result.ccWarehouse = { status: 'ok', action: wRes.action, ccWarehouseId: wRes.ccWarehouseId };
      console.log(`CCW  OK   ${item.sku}  →  ccWarehouseId: ${wRes.ccWarehouseId} (${wRes.action})`);
    } catch (err) {
      result.ccWarehouse = { status: 'error', error: err.message, detail: err.response?.data };
      console.error(`CCW  ERR  ${item.sku}  →  ${err.message}`);
      console.error(`CCW  DETAIL:`, JSON.stringify(err.response?.data, null, 2));
    }

    results.push(result);
    console.log('');
  }

  // Merge with existing results (upsert by SKU)
  const existing = fs.existsSync(OUTPUT_FILE) ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) : [];
  const merged   = [...existing];
  for (const r of results) {
    const idx = merged.findIndex(e => e.sku === r.sku);
    if (idx >= 0) merged[idx] = r; else merged.push(r);
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged, null, 2));
  writeBackIds(inputFile, results);

  const nsOk  = results.filter(r => r.netsuite.status === 'ok').length;
  const ccOk  = results.filter(r => r.cartoncloud.status === 'ok').length;
  const total = results.length;
  console.log(`Done. NetSuite: ${nsOk}/${total} ok  |  CartonCloud: ${ccOk}/${total} ok`);
  console.log(`Results saved to: ${OUTPUT_FILE}`);
})();
