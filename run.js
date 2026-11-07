
 // run.js
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { createItem } = require('./call-create-item');
const {
  upsertProduct,
  upsertWarehouseProduct
} = require('./cartoncloud');

// ── File parsers ─────────────────────────────────────

function readCSV(filePath) {
  const { parse } = require('csv-parse/sync');
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function readSheet(workbook, name) {
  const sheet = workbook.Sheets[name];
  return sheet ? XLSX.utils.sheet_to_json(sheet) : null;
}

function readExcel(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath);

  if (workbook.SheetNames.includes('ProductID')) {
    const itemMap = {};

    for (const name of [
      'ProductID',
      'PurchasingSelling',
      'InventoryAccounting',
      'Integration'
    ]) {
      const rows = readSheet(workbook, name);
      if (!rows) continue;

      for (const row of rows) {
        const sku = row.sku || row.SKU;
        if (!sku) continue;

        if (!itemMap[sku]) itemMap[sku] = {};
        Object.assign(itemMap[sku], row);
      }
    }

    const locRows = readSheet(workbook, 'Locations');

    if (locRows) {
      for (const row of locRows) {
        const sku = row.sku || row.SKU;
        if (!sku || !itemMap[sku]) continue;

        if (!itemMap[sku]._locations) {
          itemMap[sku]._locations = [];
        }

        itemMap[sku]._locations.push({
          locationId: Number(row.locationId || 0),
          reorderPoint: Number(row.reorderPoint || 0),
          preferredStock: Number(row.preferredStock || 0)
        });
      }
    }

    return Object.values(itemMap);
  }

  const name = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];

  if (!sheet) {
    throw new Error(
      `Sheet "${name}" not found. Available: ${workbook.SheetNames.join(', ')}`
    );
  }

  return XLSX.utils.sheet_to_json(sheet);
}

function loadItems(filePath, sheetName) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') return readCSV(filePath);

  if (ext === '.xlsx' || ext === '.xls') {
    return readExcel(filePath, sheetName);
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

// ── Field mapping ────────────────────────────────────

function mapRow(row) {
  return {
    sku: row['sku'] || row['SKU'],
    displayName: row['displayName'] || row['Display Name'],

    barcode:
      row['pieceBarcode'] ||
      row['barcode'] ||
      row['Barcode'] ||
      '',

    cartonBarcode: row['cartonBarcode'] || '',

    piecesPerCarton: Number(
      row['piecesPerCarton'] ||
      row['casePackQty'] ||
      row['Case Pack'] ||
      1
    ),

    lifecycleStatus:
      row['lifecycleStatus'] ||
      row['Lifecycle Status'] ||
      'Active',

    unitsTypeId: Number(row['unitsTypeId'] || 0),
    stockUnit: row['stockUnit'] || '',
    saleUnit: row['saleUnit'] || '',
    purchaseUnit: row['purchaseUnit'] || '',

    stockUomId: Number(
      row['stockUomId'] ||
      row['uomInternalId'] ||
      row['UOM ID'] ||
      0
    ),

    retailPrice: Number(
      row['retailPrice'] || row['Retail Price'] || 0
    ),

    wholesalePrice: Number(
      row['wholesalePrice'] || row['Wholesale Price'] || 0
    ),

    onlinePrice: Number(
      row['onlinePrice'] || row['Online Price'] || 0
    ),

    costPrice: Number(
      row['costPrice'] || row['Cost Price'] || 0
    ),

    weightKg: Number(
      row['weightKg'] || row['Weight(kg)'] || 0
    ),

    lengthCm: Number(
      row['lengthCm'] || row['Length(cm)'] || 0
    ),

    widthCm: Number(
      row['widthCm'] || row['Width(cm)'] || 0
    ),

    heightCm: Number(
      row['heightCm'] || row['Height(cm)'] || 0
    ),

    assetAccountId: Number(
      row['assetAccountId'] ||
      row['Asset Account ID'] ||
      0
    ),

    incomeAccountId: Number(
      row['incomeAccountId'] ||
      row['Income Account ID'] ||
      0
    ),

    cogsAccountId: Number(
      row['cogsAccountId'] ||
      row['COGS Account ID'] ||
      0
    ),

    leadTimeDays: Number(row['leadTimeDays'] || 0),

    subsidiaryIds: (row['subsidiaryIds'] || '3')
      .toString()
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => n > 0),

    locations: row['_locations'] || [],

    nsInternalId: row['nsInternalId'] || '',
    cartonCloudId:
      row['cartonCloudId'] ||
      row['CartonCloud ID'] ||
      '',

    lightSpeedId: row['lightSpeedId'] || '',
    ccWarehouseId: row['ccWarehouseId'] || '',
    ccRetailId: row['ccRetailId'] || ''
  };
}

// ── Write IDs back to Excel ──────────────────────────

function writeBackIds(filePath, results) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext !== '.xlsx' && ext !== '.xls') return;

  const workbook = XLSX.readFile(filePath);

  const isNewFormat = workbook.SheetNames.includes('ProductID');
  const sheetName = isNewFormat
    ? 'Integration'
    : workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) return;

  const range = XLSX.utils.decode_range(sheet['!ref']);
  const colIndex = {};

  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({
      r: range.s.r,
      c
    });

    if (sheet[addr]) {
      colIndex[sheet[addr].v] = c;
    }
  }

  const col = (...names) => {
    for (const n of names) {
      const k = Object.keys(colIndex).find(
        h => h.trim().toLowerCase() === n.toLowerCase()
      );

      if (k !== undefined) return colIndex[k];
    }

    return undefined;
  };

  const skuCol = col('sku', 'SKU');
  const ccCol = col('cartonCloudId', 'CartonCloud ID');
  const ccWCol = col('ccWarehouseId');
  const nsCol = col('nsInternalId');

  if (skuCol === undefined) return;

  const newCcIds = {};
  const newCcWIds = {};
  const newNsIds = {};

  for (const r of results) {
    if (
      r.cartoncloud?.status === 'ok' &&
      r.cartoncloud.ccId
    ) {
      newCcIds[r.sku] = r.cartoncloud.ccId;
    }

    if (
      r.ccWarehouse?.status === 'ok' &&
      r.ccWarehouse.ccWarehouseId
    ) {
      newCcWIds[r.sku] = r.ccWarehouse.ccWarehouseId;
    }

    if (
      r.netsuite?.status === 'ok' &&
      r.netsuite.internalId
    ) {
      newNsIds[r.sku] = r.netsuite.internalId;
    }
  }

  let updated = 0;

  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const skuAddr = XLSX.utils.encode_cell({
      r: row,
      c: skuCol
    });

    const sku = sheet[skuAddr]?.v;
    if (!sku) continue;

    if (ccCol !== undefined && newCcIds[sku]) {
      const addr = XLSX.utils.encode_cell({
        r: row,
        c: ccCol
      });

      if (!sheet[addr]?.v) {
        sheet[addr] = {
          t: 's',
          v: String(newCcIds[sku])
        };
        updated++;
      }
    }

    if (ccWCol !== undefined && newCcWIds[sku]) {
      const addr = XLSX.utils.encode_cell({
        r: row,
        c: ccWCol
      });

      if (!sheet[addr]?.v) {
        sheet[addr] = {
          t: 's',
          v: String(newCcWIds[sku])
        };
        updated++;
      }
    }

    if (nsCol !== undefined && newNsIds[sku]) {
      const addr = XLSX.utils.encode_cell({
        r: row,
        c: nsCol
      });

      sheet[addr] = {
        t: 'n',
        v: Number(newNsIds[sku])
      };

      updated++;
    }
  }

  if (updated > 0) {
    XLSX.writeFile(workbook, filePath);

    console.log(
      `Wrote ${updated} ID(s) back to Integration sheet: ${filePath}`
    );
  }
}

// ── Command-line arguments ───────────────────────────

const inputFile = process.argv[2];

const skuFlag = process.argv.find(
  a => a.startsWith('--sku=')
);

const filterSku = skuFlag
  ? skuFlag.slice('--sku='.length)
  : null;

const ccOnly = process.argv.includes('--cc-only');

const checkWarehouse = process.argv.includes('--check-warehouse');

if (ccOnly && checkWarehouse) {
  console.error('Cannot combine --cc-only and --check-warehouse');
  process.exit(1);
}

const sheetName = process.argv
  .slice(3)
  .find(a => !a.startsWith('--'));

if (ccOnly && !filterSku) {
  console.error(
    'Safety check: --cc-only requires --sku=...'
  );
  process.exit(1);
}

const OUTPUT_DIR = path.join(__dirname, 'output');

const OUTPUT_FILE = path.join(
  OUTPUT_DIR,
  'create-item-result.json'
);

if (!inputFile) {
  console.error('Usage:');
  console.error('  node run.js <file>');
  console.error('  node run.js <file> --sku=TP-88001');
  console.error(
    '  node run.js <file> --sku=TP-88001 --cc-only'
  );
  process.exit(1);
}

// if (!fs.existsSync(OUTPUT_DIR)) {
//   fs.mkdirSync(OUTPUT_DIR, { recursive: true });
// }

if (!checkWarehouse && !fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}


async function checkWarehouseProducts(items) {
  require('dotenv').config();
  const axios = require('axios');

  const productsUrl = String(
    process.env.CC_BASE_URL || ''
  ).replace(/\/$/, '');

  if (!/\/products$/.test(productsUrl)) {
    throw new Error('CC_BASE_URL must end in /products');
  }

  const warehouseUrl = productsUrl.replace(
    /\/products$/,
    '/warehouse-products'
  );

  const authUrl = process.env.CC_AUTH_URL ||
    'https://api.na.cartoncloud.com/uaa/oauth2/token';

  if (!process.env.CC_CLIENT_ID ||
      !process.env.CC_CLIENT_SECRET) {
    throw new Error('Missing CartonCloud credentials');
  }

  // OAuth authentication only; no product updates
  const tokenResponse = await axios.post(
    authUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.CC_CLIENT_ID,
      client_secret: process.env.CC_CLIENT_SECRET
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  const token = tokenResponse.data?.access_token;

  if (!token) {
    throw new Error('CartonCloud returned no access token');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Accept-Version': '8'
  };

  let matches = 0;

  for (const item of items) {
    const expected = String(item.barcode ?? '').trim();
    const id = String(item.ccWarehouseId ?? '').trim();

    let actual = null;
    let status;
    let detail = '';

    if (!id) {
      status = 'MISSING_WAREHOUSE_ID';
    } else {
      try {
        // GET only: retrieve existing warehouse product
        const response = await axios.get(
          `${warehouseUrl}/${encodeURIComponent(id)}`,
          { headers }
        );

        const product = response.data?.data ?? response.data;

        const returnedSku = String(
          product?.references?.code ??
          product?.code ??
          ''
        );

        if (returnedSku !== item.sku) {
          status = 'SKU_MISMATCH';
          detail = `Returned SKU: ${returnedSku}`;
        } else {
          const barcode = product?.unitOfMeasures?.E?.barcode;
          actual = barcode == null
            ? ''
            : String(barcode).trim();

          if (!expected) {
            status = 'MISSING_EXCEL_BARCODE';
          } else if (!actual) {
            status = 'MISSING_CC_BARCODE';
          } else if (expected === actual) {
            status = 'MATCH';
            matches++;
          } else {
            status = 'MISMATCH';
          }
        }
      } catch (err) {
        status = 'API_ERROR';
        detail = err.message;
      }
    }

    console.log('\n===== WAREHOUSE BARCODE CHECK =====');
    console.log('SKU:', item.sku);
    console.log('Warehouse ID:', id || '(missing)');
    console.log('Excel Barcode:', expected || '(missing)');
    console.log('CartonCloud Barcode:', actual ?? '(not checked)');
    console.log('Barcode Status:', status);

    if (detail) {
      console.log('Detail:', detail);
    }

    console.log('Action: NO UPDATE PERFORMED');
    console.log('===================================');
  }

  console.log(
    `\nWarehouse audit: ${matches}/${items.length} MATCH`
  );

  if (matches !== items.length) {
    process.exitCode = 2;
  }
}


// ── Main ─────────────────────────────────────────────

(async () => {
  console.log(`Reading items from: ${inputFile}`);

  const rows = loadItems(inputFile, sheetName);
  const allItems = rows.map(mapRow);

  const items = filterSku
    ? allItems.filter(i => i.sku === filterSku)
    : allItems;

  if (filterSku && items.length === 0) {
    console.error(`SKU "${filterSku}" not found.`);
    process.exit(1);
  }

  // Remove duplicate SKUs
  const seen = new Set();
  const uniqueItems = [];

  for (const item of items) {
    if (seen.has(item.sku)) {
      console.warn(
        `WARNING: duplicate SKU "${item.sku}" skipped`
      );
      continue;
    }

    seen.add(item.sku);
    uniqueItems.push(item);
  }

  // console.log(
  //   `Found ${uniqueItems.length} item(s). Mode: ${
  //     ccOnly
  //       ? 'CartonCloud transport product ONLY'
  //       : 'NetSuite + CartonCloud'
  //   }`
  // );

  console.log(
  `Found ${uniqueItems.length} item(s). Mode: ${
    checkWarehouse
      ? 'READ-ONLY Warehouse Audit'
      : ccOnly
        ? 'CartonCloud transport product ONLY'
        : 'NetSuite + CartonCloud'
  }`
);

  if (checkWarehouse) {
  if (uniqueItems.length === 0) {
    throw new Error('No items to check');
  }

  console.log('READ-ONLY MODE: warehouse barcode audit');

  await checkWarehouseProducts(uniqueItems);

  return;
}

  const results = [];

  for (const item of uniqueItems) {
    const result = {
      sku: item.sku,
      netsuite: {},
      cartoncloud: {},
      ccWarehouse: {}
    };

    // NetSuite
    if (!ccOnly) {
      try {
        const nsRes = await createItem(item);

        if (!nsRes?.success) {
          throw new Error(
            nsRes?.error || 'Unknown NS error'
          );
        }

        result.netsuite = {
          status: 'ok',
          internalId: nsRes.internalId
        };

        console.log(
          `NS OK ${item.sku} → ${nsRes.internalId}`
        );
      } catch (err) {
        result.netsuite = {
          status: 'error',
          error: err.message,
          detail: err.response?.data
        };

        console.error(
          `NS ERR ${item.sku} → ${err.message}`
        );
      }
    }

    // CartonCloud transport product
    try {
      if (ccOnly && !item.barcode) {
        throw new Error(
          'Missing pieceBarcode in ProductID sheet'
        );
      }

      const ccRes = await upsertProduct(item);

      if (!ccRes?.ccId) {
        throw new Error(
          'CartonCloud returned no product ID'
        );
      }

      result.cartoncloud = {
        status: 'ok',
        action: ccRes.action,
        ccId: ccRes.ccId
      };

      console.log(
        `CC OK ${item.sku} → ${ccRes.ccId} (${ccRes.action})`
      );
    } catch (err) {
      result.cartoncloud = {
        status: 'error',
        error: err.message,
        detail: err.response?.data
      };

      console.error(
        `CC ERR ${item.sku} → ${err.message}`
      );

      console.error(
        'CC DETAIL:',
        JSON.stringify(err.response?.data, null, 2)
      );
    }

    // CartonCloud warehouse product
    if (!ccOnly) {
      try {
        const wRes = await upsertWarehouseProduct(item);

        // result.ccWarehouse = {
        //   status: 'ok',
        //   action: wRes.action,
        //   ccWarehouseId: wRes.ccWarehouseId
        // };
        result.ccWarehouse = {
            status: 'ok',
            action: wRes.action,
            ccWarehouseId: wRes.ccWarehouseId,
            barcodeStatus: wRes.barcodeStatus,
            expectedBarcode: wRes.expectedBarcode,
            actualBarcode: wRes.actualBarcode
        };


        console.log(
          `CCW OK ${item.sku} → ${wRes.ccWarehouseId}`
        );
      } catch (err) {
        result.ccWarehouse = {
          status: 'error',
          error: err.message,
          detail: err.response?.data
        };

        console.error(
          `CCW ERR ${item.sku} → ${err.message}`
        );
      }
    }

    results.push(result);
    console.log('');
  }

  // Merge with existing results
  const existing = fs.existsSync(OUTPUT_FILE)
    ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'))
    : [];

  const merged = [...existing];

  for (const r of results) {
    const idx = merged.findIndex(
      e => e.sku === r.sku
    );

    if (idx >= 0) {
      const prior = merged[idx];

      merged[idx] = ccOnly
        ? {
            ...prior,
            cartoncloud: r.cartoncloud
          }
        : r;
    } else {
      merged.push(r);
    }
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(merged, null, 2)
  );

  writeBackIds(inputFile, results);

  const ccOk = results.filter(
    r => r.cartoncloud.status === 'ok'
  ).length;

  const nsOk = results.filter(
    r => r.netsuite.status === 'ok'
  ).length;

  const total = results.length;

  if (ccOnly) {
    console.log(
      `Done. CartonCloud transport products: ${ccOk}/${total} ok`
    );

    console.log(
      '(NetSuite and warehouse skipped)'
    );
  } else {
    console.log(
      `Done. NetSuite: ${nsOk}/${total} ok | CartonCloud: ${ccOk}/${total} ok`
    );
  }

  console.log(
    `Results saved to: ${OUTPUT_FILE}`
  );
})().catch(err => {
  console.error('Fatal error:', err.message);
  process.exitCode = 1;
});
