require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_HOST = `https://${process.env.NS_ACCOUNT.toLowerCase().replace('_', '-')}.suitetalk.api.netsuite.com`;

// Close duplicate lines on a SO — keeps the first line per SKU open, closes the rest
async function fixDuplicateLines(soNumber) {
  // Step 1: find SO internalId — take oldest to avoid stale duplicates
  const searchUrl = `${NS_HOST}/services/rest/record/v1/salesOrder?q=otherRefNum IS "${soNumber}"&limit=50`;
  const searchRes = await nsRequest('GET', searchUrl);
  const allMatches = (searchRes?.items || []).sort((a, b) => Number(a.id) - Number(b.id));
  if (!allMatches.length) throw new Error(`SO not found: ${soNumber}`);
  const soId = allMatches[0].id;
  console.log(`Found SO ${soNumber} → internalId: ${soId}`);

  // Step 2: use SuiteQL to get ALL SO lines (avoids REST subresource pagination limit)
  const SUITEQL = `${NS_HOST}/services/rest/query/v1/suiteql`;
  const sqlRes = await nsRequest('POST', `${SUITEQL}?limit=500`,
    { q: `SELECT id, item, linesequencenumber, isclosed FROM transactionLine WHERE transaction = ${soId} AND mainline = 'F' AND taxline = 'F'` },
    { Prefer: 'transient' });
  const lines = sqlRes?.items || [];
  console.log(`Found ${lines.length} line(s)`);

  // Step 3: group by item, keep first open line, close the rest
  const seen = {};
  let closedCount = 0;

  for (const line of lines) {
    const itemId  = String(line.item);
    const lineNum = line.linesequencenumber;  // SuiteQL field name
    const isClosed = line.isclosed === 'T' || line.isclosed === true;

    if (isClosed) continue;

    if (!seen[itemId]) {
      seen[itemId] = lineNum;
      console.log(`Keeping  line ${lineNum} for item ${itemId}`);
    } else {
      console.log(`Closing  line ${lineNum} for item ${itemId} (duplicate)`);
      const patchUrl = `${NS_HOST}/services/rest/record/v1/salesOrder/${soId}/item/${lineNum}`;
      await nsRequest('PATCH', patchUrl, { isclosed: true });
      closedCount++;
    }
  }

  console.log(`\nDone. Closed ${closedCount} duplicate line(s) on ${soNumber}`);
}

const soArg = process.argv.find(a => a.startsWith('--so='))?.split('=')[1];
if (!soArg) {
  console.error('Usage: node fix-so-duplicate-lines.js --so=SO-2026-1007,SO-2026-1008,...');
  process.exit(1);
}

const soNumbers = soArg.split(',').map(s => s.trim());

(async () => {
  for (const soNumber of soNumbers) {
    try {
      await fixDuplicateLines(soNumber);
    } catch (err) {
      console.error(`Error on ${soNumber}: ${err.message}`);
    }
    console.log('');
  }
})();
