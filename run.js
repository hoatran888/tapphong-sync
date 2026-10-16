// run.js
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createItem }    = require('./call-create-item');
const { upsertProduct } = require('./cartoncloud');

// ── file parsers ──────────────────────────────────────────────────────────────

function readCSV(filePath) {
  const { parse } = require('csv-parse/sync');
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function readExcel(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath);
  const name     = sheetName || workbook.SheetNames[0];
  const sheet    = workbook.Sheets[name];
  if (!sheet) throw new Error(`Sheet "${name}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json(sheet);
}

function loadItems(filePath, sheetName) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv')                      return readCSV(filePath);
  if (ext === '.xlsx' || ext === '.xls')   return readExcel(filePath, sheetName);
  throw new Error(`Unsupported file type: ${ext}. Use .csv, .xlsx or .xls`);
}

// ── field mapping: CSV/Excel column names → NS field names ───────────────────

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

// ── write CC UUIDs back into the Excel file after successful creates ──────────

function writeBackCartonCloudIds(filePath, sheetName, results) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xls') return;

  const workbook = XLSX.readFile(filePath);
  const name     = sheetName || workbook.SheetNames[0];
  const sheet    = workbook.Sheets[name];
  if (!sheet) return;

  const range = XLSX.utils.decode_range(sheet['!ref']);

  // Locate header columns
  const colIndex = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    if (sheet[addr]) colIndex[sheet[addr].v] = c;
  }

  const skuCol = colIndex['sku']           ?? colIndex['SKU'];
  const ccCol  = colIndex['cartonCloudId'] ?? colIndex['CartonCloud ID'];
  console.log(`WriteBack: headers found =`, JSON.stringify(colIndex));
  console.log(`WriteBack: skuCol=${skuCol}  ccCol=${ccCol}`);
  if (skuCol === undefined || ccCol === undefined) {
    console.log('WriteBack: column not found — skipping');
    return;
  }

  // Map SKU → CC UUID for all successful results that have an ID
  const newIds = {};
  for (const r of results) {
    if (r.cartoncloud.status === 'ok' && r.cartoncloud.ccId) {
      newIds[r.sku] = r.cartoncloud.ccId;
    }
  }
  console.log(`WriteBack: newIds =`, JSON.stringify(newIds));

  let updated = 0;
  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const skuAddr = XLSX.utils.encode_cell({ r: row, c: skuCol });
    const ccAddr  = XLSX.utils.encode_cell({ r: row, c: ccCol });
    const sku     = sheet[skuAddr]?.v;
    const existing = sheet[ccAddr]?.v;
    console.log(`WriteBack: row ${row}  sku=${sku}  existingCC=${existing}  newId=${newIds[sku]}`);
    // Only write back if cell is currently empty (don't overwrite existing IDs)
    if (sku && newIds[sku] && !existing) {
      sheet[ccAddr] = { t: 's', v: String(newIds[sku]) };
      updated++;
    }
  }

  if (updated > 0) {
    XLSX.writeFile(workbook, filePath);
    console.log(`Wrote ${updated} CartonCloud ID(s) back to: ${filePath}`);
  } else {
    console.log('WriteBack: nothing to write (0 rows updated)');
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

const inputFile   = process.argv[2];
const sheetName   = process.argv[3];
const filterSku   = process.argv[4] || null;
const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'create-item-result.json');

if (!inputFile) {
  console.error('Usage: node run.js <path-to-file.csv|xlsx> [sheetName] [sku]');
  console.error('Example: node run.js Data/TP-Info.xlsx itemInventory');
  console.error('Example: node run.js Data/TP-Info.xlsx itemInventory TP-88001');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

(async () => {
  const label = sheetName ? `${inputFile} (sheet: ${sheetName})` : inputFile;
  console.log(`Reading items from: ${label}`);
  const rows    = loadItems(inputFile, sheetName);
  const allItems = rows.map(mapRow);
  const items   = filterSku
    ? allItems.filter(i => i.sku === filterSku)
    : allItems;
  if (filterSku && items.length === 0) {
    console.error(`SKU "${filterSku}" not found in file.`);
    process.exit(1);
  }
  const results = [];

  console.log(`Found ${items.length} item(s). Sending to NetSuite + CartonCloud...\n`);

  for (const item of items) {
    const result = { sku: item.sku, netsuite: {}, cartoncloud: {} };

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

    // ── CartonCloud ──
    try {
      const ccRes = await upsertProduct(item);
      result.cartoncloud = { status: 'ok', action: ccRes.action, ccId: ccRes.ccId };
      console.log(`CC   OK   ${item.sku}  →  ccId: ${ccRes.ccId} (${ccRes.action})`);
    } catch (err) {
      result.cartoncloud = { status: 'error', error: err.message, detail: err.response?.data };
      console.error(`CC   ERR  ${item.sku}  →  ${err.message}`);
      console.error(`CC   DETAIL:`, JSON.stringify(err.response?.data, null, 2));
    }

    results.push(result);
    console.log('');
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  // Write CC UUIDs back into the Excel file for newly created products
  writeBackCartonCloudIds(inputFile, sheetName, results);

  const nsOk  = results.filter(r => r.netsuite.status === 'ok').length;
  const ccOk  = results.filter(r => r.cartoncloud.status === 'ok').length;
  const total = results.length;
  console.log(`Done. NetSuite: ${nsOk}/${total} ok  |  CartonCloud: ${ccOk}/${total} ok`);
  console.log(`Results saved to: ${OUTPUT_FILE}`);
})();
