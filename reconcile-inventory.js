require('dotenv').config();
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const { getNSInventory } = require('./call-get-inventory');

const CC_AUTH_URL  = process.env.CC_AUTH_URL;
const CC_TENANT_ID = process.env.CC_TENANT_ID;
const CC_BASE_URL  = process.env.CC_BASE_URL || '';
const CC_WAREHOUSE = CC_BASE_URL.replace(/\/products\/?$/, '/warehouse-products');

async function getCCToken() {
  const r = await axios.post(CC_AUTH_URL, new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.CC_CLIENT_ID,
    client_secret: process.env.CC_CLIENT_SECRET,
  }));
  return r.data.access_token;
}

async function getAllCCWarehouseProducts() {
  const token      = await getCCToken();
  const headers    = { Authorization: `Bearer ${token}`, 'Accept-Version': '8' };
  const warehouseId = process.env.CC_WAREHOUSE_ID;
  const result     = {};
  let page = 0;

  // Fetch all warehouse products (paginated)
  const products = [];
  while (true) {
    const res  = await axios.get(CC_WAREHOUSE, { headers, params: { page, size: 100 } });
    const data = res.data?.data || (Array.isArray(res.data) ? res.data : []);
    products.push(...data);
    if (data.length < 100) break;
    page++;
  }

  // Fetch stock for each product
  await Promise.all(products.map(async (p) => {
    const sku = p.references?.code || p.code || p.sku;
    if (!sku) return;
    try {
      const stockRes = await axios.get(`${CC_WAREHOUSE}/${p.id}/stock`, {
        headers, params: { warehouse: warehouseId },
      });
      const stockList = Array.isArray(stockRes.data) ? stockRes.data : [stockRes.data];
      const stock = stockList[0];
      const qty = stock?.measures?.quantityFree ?? stock?.measures?.quantity ?? 0;
      result[sku] = { sku, name: p.name || sku, qty: Number(qty) || 0 };
    } catch {
      result[sku] = { sku, name: p.name || sku, qty: 0 };
    }
  }));

  return result;
}

function statusLabel(ccQty, nsQty, ccOnly, nsOnly) {
  if (ccOnly) return 'CC_ONLY';
  if (nsOnly) return 'NS_ONLY';
  if (ccQty === nsQty) return 'MATCH';
  return ccQty > nsQty ? 'CC_OVER' : 'CC_UNDER';
}

async function reconcile() {
  console.log('Fetching CC warehouse inventory...');
  const ccMap = await getAllCCWarehouseProducts();
  console.log(`  CC: ${Object.keys(ccMap).length} products`);

  console.log('Fetching NS inventory...');
  const nsItems = await getNSInventory();
  const nsMap   = {};
  for (const i of nsItems) nsMap[i.sku] = i;
  console.log(`  NS: ${nsItems.length} items`);

  // Merge all SKUs from both systems
  const allSkus = new Set([...Object.keys(ccMap), ...Object.keys(nsMap)]);
  const rows    = [];

  for (const sku of [...allSkus].sort()) {
    const cc     = ccMap[sku];
    const ns     = nsMap[sku];
    const ccQty    = cc?.qty ?? null;
    const nsQty    = ns?.quantityAvailable ?? null;
    const nsOnHand = ns?.quantityOnHand ?? null;
    const name     = ns?.name || cc?.name || sku;
    const variance = ccQty !== null && nsQty !== null ? ccQty - nsQty : null;
    const status   = statusLabel(ccQty, nsQty, !ns, !cc);
    rows.push({ sku, name, ccQty, nsQty, nsOnHand, variance, status });
  }

  // Console summary
  const mismatches = rows.filter(r => r.status !== 'MATCH');
  console.log(`\nTotal SKUs: ${rows.length} | Mismatches: ${mismatches.length} | Matches: ${rows.length - mismatches.length}`);
  console.log('\nAll SKUs:');
  console.log('SKU'.padEnd(20), 'CC Qty'.padStart(8), 'NS Avail'.padStart(10), 'NS OnHand'.padStart(11), 'Variance'.padStart(10), '  Status');
  console.log('-'.repeat(80));
  for (const r of rows) {
    console.log(
      r.sku.padEnd(20),
      (r.ccQty    ?? 'N/A').toString().padStart(8),
      (r.nsQty    ?? 'N/A').toString().padStart(10),
      (r.nsOnHand ?? 'N/A').toString().padStart(11),
      (r.variance ?? 'N/A').toString().padStart(10),
      `  ${r.status}`
    );
  }

  // Save CSV
  const date    = new Date().toISOString().split('T')[0];
  const outDir  = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outFile = path.join(outDir, `inventory-reconciliation-${date}.csv`);

  const header = 'SKU,Name,CC Qty Available,NS Qty Available,NS Qty On Hand,Variance,Status';
  const csvRows = rows.map(r =>
    [r.sku, `"${r.name.replace(/"/g, '""')}"`, r.ccQty ?? '', r.nsQty ?? '', r.nsOnHand ?? '', r.variance ?? '', r.status].join(',')
  );
  fs.writeFileSync(outFile, [header, ...csvRows].join('\n'));
  console.log(`\nCSV saved: ${outFile}`);
}

reconcile().catch(err => { console.error('Error:', err.message); process.exit(1); });
