#!/usr/bin/env node
'use strict';

// Read-only NetSuite Sales Order / Item Fulfillment inspection.
// Usage: node inspect-ns-fulfillment-fixed-v3.js --so=SO-2026-1004

require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ======================================================
// 1. Configuration
// ======================================================

const soNumber = process.argv
  .find(x => x.startsWith('--so='))
  ?.slice(5);

if (!soNumber) {
  console.error(
    'Usage: node inspect-ns-fulfillment-fixed-v3.js --so=SO-2026-1004'
  );
  process.exit(1);
}

const outputDir = path.join(__dirname, 'output');

const mappingPath = path.join(
  outputDir,
  'create-so-result.json'
);

const ccReportPath = path.join(
  outputDir,
  `cc-automation-${soNumber}.json`
);

const account = (
  process.env.NS_ACCOUNT_ID ||
  process.env.NETSUITE_ACCOUNT_ID ||
  '12222161_SB1'
)
  .toLowerCase()
  .replace('_', '-');

const base = `https://${account}.suitetalk.api.netsuite.com`;

const accessToken =
  process.env.NS_ACCESS_TOKEN ||
  process.env.NETSUITE_ACCESS_TOKEN;

if (!accessToken) {
  console.error(
    'Missing NS_ACCESS_TOKEN. Set a valid NetSuite OAuth 2.0 access token.'
  );
  process.exit(1);
}

// ======================================================
// 2. Read JSON files
// ======================================================

function readJSON(filename) {
  return JSON.parse(
    fs.readFileSync(filename, 'utf8')
  );
}

// ======================================================
// 3. Find NetSuite Sales Order internal ID
// ======================================================

function mappingForSO() {

  const parsed = readJSON(mappingPath);

  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.results)
      ? parsed.results
      : [parsed];

  const entry = entries.find(
    e => e.soNumber === soNumber
  );

  if (!entry) {
    throw new Error(
      `Sales Order ${soNumber} not found in ${mappingPath}`
    );
  }

  const id =
    entry.netsuite?.internalId ??
    entry.netsuite?.id;

  if (!id) {
    throw new Error(
      `No NetSuite internal ID found for ${soNumber}`
    );
  }

  return {
    entry,
    id: String(id)
  };
}

// ======================================================
// 4. Configure NetSuite REST API
// ======================================================

const http = axios.create({

  baseURL: base,

  headers: {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json'
  },

  timeout: 30000

});

// ======================================================
// 5. NetSuite GET request
// ======================================================

async function get(url) {

  console.log('NetSuite GET:', url);

  const response = await http.get(url);

  return response.data;
}

// ======================================================
// 5a. Retrieve detailed Sales Order item lines
// ======================================================

async function getSalesOrderItemLines(soInternalId) {

  const endpoint =
    `/services/rest/record/v1/salesOrder/${encodeURIComponent(soInternalId)}/item`;

  const lines = [];

  let next = endpoint;

  while (next) {

    const page = await get(next);

    for (const entry of page.items || []) {

      const href = entry.links?.find(
        link => link.rel === 'self'
      )?.href;

      if (!href || typeof href !== 'string') {
        throw new Error(
          `Missing item detail link: ${JSON.stringify(entry)}`
        );
      }

      // Extract the numeric line ID without parsing the URL.
      // This works with a fully qualified NetSuite URL.

      console.log('Item self link:', href);

      const lineMatch = href.match(
        /\/item\/(\d+)(?:[/?#]|$)/i
      );

      if (!lineMatch) {
        throw new Error(
          `Cannot identify item line ID from link: ${JSON.stringify(href)}`
        );
      }

      const detailPath =
        `${endpoint}/${lineMatch[1]}`;

      const l = await get(detailPath);

      lines.push({

        line:
          l.line ?? null,

        lineUniqueKey:
          l.lineUniqueKey ?? null,

        item:
          l.item?.refName ??
          l.item?.id ??
          null,

        itemInternalId:
          l.item?.id ?? null,

        sku:
          l.item?.refName ?? null,

        description:
          l.description ?? null,

        quantity:
          l.quantity ?? null,

        quantityFulfilled:
          l.quantityFulfilled ?? null,

        quantityAvailable:
          l.quantityAvailable ?? null,

        quantityOnHand:
          l.quantityOnHand ?? null,

        quantityCommitted:
          l.quantityCommitted ?? null,

        units:
          l.units ?? null,

        location:
          l.location?.refName ?? null,

        rate:
          l.rate ?? null,

        amount:
          l.amount ?? null

      });

    }

    // Check for additional pages.

    const nextHref = page.links?.find(
      link => link.rel === 'next'
    )?.href;

    next = nextHref
      ? new URL(nextHref, base).pathname +
        new URL(nextHref, base).search
      : null;

  }

  return lines;
}

// ======================================================
// 6. NetSuite SuiteQL query
// ======================================================

async function query(q) {

  const response = await http.post(

    '/services/rest/query/v1/suiteql',

    { q },

    {
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'transient'
      }
    }

  );

  return response.data.items || [];
}

// ======================================================
// 7. Main inspection function
// ======================================================

async function main() {

  // Step 1: Find NetSuite Sales Order ID

  const { id } = mappingForSO();

  // Step 2: Read existing CartonCloud report

  const cc = fs.existsSync(ccReportPath)
    ? readJSON(ccReportPath)
    : null;

  // Step 3: Retrieve NetSuite Sales Order

  const order = await get(
    `/services/rest/record/v1/salesOrder/${encodeURIComponent(id)}`
  );

  // Step 4: Retrieve Sales Order item lines

  const itemLines = await getSalesOrderItemLines(id);

  // Step 5: Search existing Item Fulfillments

  const fulfillments = await query(

    `SELECT DISTINCT
        t.id,
        t.tranid,
        t.status
     FROM transaction t
     INNER JOIN transactionline tl
       ON tl.transaction = t.id
     WHERE t.type = 'ItemShip'
       AND tl.createdfrom = ${Number(id)}`

  );

  // Step 6: Read Sales Order status

  const status =
    order.status?.refName ||
    order.status?.name ||
    order.status ||
    order.orderStatus ||
    null;

  const approvalStatus =
    order.approvalStatus?.refName ||
    order.approvalStatus?.name ||
    order.approvalStatus ||
    null;

  // Step 7: Build inspection report

  const report = {

    inspectedAt:
      new Date().toISOString(),

    soNumber,

    netsuiteInternalId: id,

    netsuite: {

      tranId:
        order.tranId ?? null,

      status,

      approvalStatus,

      itemLines,

      itemFulfillments:
        fulfillments

    },

    cartoncloud: cc
      ? {

          status:
            cc.status,

          orderedQuantity:
            cc.orderedQuantity,

          consignments:
            cc.consignments?.map(c => ({

              id: c.id,

              status: c.status

            }))

        }
      : null,

    createItemFulfillment:
      false,

    nextAction:
      'REVIEW_NETSUITE_APPROVAL_INVENTORY_AND_FULFILLMENT',

    warnings: [],

    readOnly:
      true

  };

  // Step 8: Check for existing fulfillments

  if (fulfillments.length) {

    report.warnings.push(
      'Existing Item Fulfillment(s) found: do not create a duplicate.'
    );

  }

  // Step 9: Check approval status

  if (
    /pending approval/i.test(String(status)) ||
    /pending approval/i.test(String(approvalStatus))
  ) {

    report.nextAction =
      'WAIT_FOR_SALES_ORDER_APPROVAL';

  }

  // Step 10: Check CartonCloud status

  if (
    cc?.status === 'DISPATCHED' &&
    cc.consignments?.some(
      c => c.status === 'IN_WAREHOUSE'
    )
  ) {

    report.warnings.push(
      'CartonCloud outbound is DISPATCHED but consignment remains IN_WAREHOUSE.'
    );

  }

  // Step 11: Check item lines

  if (itemLines.length === 0) {

    report.warnings.push(
      'No item lines returned; inspect REST role permissions and response shape.'
    );

  }

  // Step 12: Save JSON report

  fs.mkdirSync(
    outputDir,
    { recursive: true }
  );

  const dest = path.join(

    outputDir,

    `ns-fulfillment-${soNumber.replace(/[^\w-]/g, '_')}.json`

  );

  fs.writeFileSync(

    dest,

    JSON.stringify(report, null, 2) + '\n'

  );

  // Step 13: Display report

  console.log(
    JSON.stringify(report, null, 2)
  );

  console.log(
    `\nSaved: ${dest}`
  );

  console.log(
    'READ-ONLY: No NetSuite or CartonCloud changes made.'
  );

}

// ======================================================
// 8. Execute program
// ======================================================

main().catch(e => {

  console.error(

    'Inspection failed:',

    e.response?.status || '',

    JSON.stringify(
      e.response?.data || e.message
    )

  );

  process.exitCode = 1;

});