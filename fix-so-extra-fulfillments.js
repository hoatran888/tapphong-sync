require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_HOST = `https://${process.env.NS_ACCOUNT.toLowerCase().replace('_', '-')}.suitetalk.api.netsuite.com`;

// Find all Item Fulfillments for a SO, keep the first, void the rest
async function fixExtraFulfillments(soNumber, dryRun = true) {
  // Step 1: find SO internalId
  const searchUrl = `${NS_HOST}/services/rest/record/v1/salesOrder?q=otherRefNum IS "${soNumber}"`;
  const searchRes = await nsRequest('GET', searchUrl);
  const items = searchRes?.items || [];
  if (!items.length) throw new Error(`SO not found: ${soNumber}`);
  const soId = items[0].id;
  console.log(`Found SO ${soNumber} → internalId: ${soId}`);

  // Step 2: query all recent item fulfillments, then load each to check createdfrom
  const sqlUrl = `${NS_HOST}/services/rest/query/v1/suiteql?limit=50`;
  const ifListRes = await nsRequest('POST', sqlUrl,
    { q: 'SELECT id, tranid, trandate FROM transaction WHERE type = \'ItemShip\'' },
    { Prefer: 'transient' });
  const candidates = ifListRes?.items || [];
  console.log(`Found ${candidates.length} recent item fulfillment(s), checking which belong to ${soNumber}...`);

  // Load each IF and check if its createdfrom matches our SO
  const fulfillments = [];
  for (const c of candidates) {
    const rec = await nsRequest('GET', `${NS_HOST}/services/rest/record/v1/itemFulfillment/${c.id}`);
    const cfId = rec?.createdFrom?.id || rec?.createdfrom?.id;
    if (String(cfId) === String(soId)) {
      fulfillments.push(c);
      console.log(`  Matched IF #${c.id} (${c.tranid})`);
    }
  }
  console.log(`Found ${fulfillments.length} Item Fulfillment(s)\n`);

  if (fulfillments.length === 0) {
    console.log('No fulfillments found.');
    return;
  }

  // Sort by id ascending
  fulfillments.sort((a, b) => Number(a.id) - Number(b.id));

  // Check how many lines each fulfillment has
  for (const f of fulfillments) {
    const rec = await nsRequest('GET', `${NS_HOST}/services/rest/record/v1/itemFulfillment/${f.id}?expandSubResources=true`);
    const lines = rec?.item?.items || [];
    const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    f.lineCount = lines.length;
    f.totalQty  = totalQty;
    console.log(`IF #${f.id} (${f.tranid}): ${lines.length} line(s), total qty=${totalQty}`);
  }

  // Void all fulfillments so inventory is fully restored, then user recreates cleanly
  for (const f of fulfillments) {
    if (dryRun) {
      console.log(`[DRY-RUN] Would void IF #${f.id} (qty=${f.totalQty})`);
    } else {
      await nsRequest('DELETE', `${NS_HOST}/services/rest/record/v1/itemFulfillment/${f.id}`);
      console.log(`Voided IF #${f.id} — ${f.totalQty} unit(s) returned to inventory`);
    }
  }

  if (dryRun) {
    console.log(`\nDry-run complete. Re-run with --apply to void all ${fulfillments.length} fulfillment(s) and restore inventory.`);
    console.log(`Then run:  node run-fulfillment.js Data/TP-Info-V2.xlsx --so=${soNumber}`);
  } else {
    console.log(`\nDone. All fulfillments voided. Now recreate with:`);
    console.log(`  node run-fulfillment.js Data/TP-Info-V2.xlsx --so=${soNumber}`);
  }
}

const soNumber = process.argv.find(a => a.startsWith('--so='))?.split('=')[1];
const apply    = process.argv.includes('--apply');

if (!soNumber) {
  console.error('Usage: node fix-so-extra-fulfillments.js --so=SO-2026-1012 [--apply]');
  console.error('       Omit --apply for a dry-run (shows what would be voided)');
  process.exit(1);
}

fixExtraFulfillments(soNumber, !apply).catch(err => { console.error('Error:', err.message); process.exit(1); });
