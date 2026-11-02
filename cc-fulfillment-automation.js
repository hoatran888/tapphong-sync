#!/usr/bin/env node
'use strict';

// Read-only CartonCloud fulfillment assessment.
// Run: node cc-fulfillment-automation.js --so=SO-2026-1004

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { getOrderLifecycle } = require('./cc-fulfillment-api');

// ======================================================
// 1. Configuration
// ======================================================

const so = process.argv
  .find(a => a.startsWith('--so='))
  ?.slice(5);

if (!so) {
  console.error(
    'Usage: node cc-fulfillment-automation.js --so=SO-2026-1004'
  );
  process.exit(1);
}

const outputDir = path.join(__dirname, 'output');

const productsUrl =
  (process.env.CC_BASE_URL || '').replace(/\/$/, '');

if (!/\/tenants\/[^/]+\/products$/.test(productsUrl)) {
  console.error(
    'CC_BASE_URL must end with /tenants/<tenantId>/products'
  );
  process.exit(1);
}

const baseUrl = productsUrl.replace(/\/products$/, '');

const authUrl =
  process.env.CC_AUTH_URL ||
  'https://api.na.cartoncloud.com/uaa/oauth2/token';

// ======================================================
// 2. Read NetSuite / CartonCloud Sales Order mapping
// ======================================================

function readOrderMapping() {

  const filename = path.join(
    outputDir,
    'create-so-result.json'
  );

  const parsed = JSON.parse(
    fs.readFileSync(filename, 'utf8')
  );

  const entries = Array.isArray(parsed)
    ? parsed
    : [parsed];

  const entry = entries.find(
    x => x.soNumber === so
  );

  if (
    !entry ||
    entry.netsuite?.status !== 'ok' ||
    entry.cartoncloud?.status !== 'ok' ||
    !entry.cartoncloud.ccId
  ) {
    throw new Error(
      `No successful NetSuite/CartonCloud order mapping for ${so}`
    );
  }

  return entry;
}

// ======================================================
// 3. Get CartonCloud OAuth 2.0 access token
// ======================================================

async function getToken() {

  const clientId =
    process.env.CC_FULFILLMENT_CLIENT_ID;

  const clientSecret =
    process.env.CC_FULFILLMENT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing CC_FULFILLMENT_CLIENT_ID or ' +
      'CC_FULFILLMENT_CLIENT_SECRET in .env'
    );
  }

  const response = await axios.post(
    authUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 20000
    }
  );

  if (!response.data?.access_token) {
    throw new Error(
      'CartonCloud did not return an access token'
    );
  }

  return response.data.access_token;
}

// ======================================================
// 4. Retrieve CartonCloud consignment and items
// ======================================================

async function readConsignment(consignmentId, token) {

  const headers = {
    Authorization: `Bearer ${token}`,
    'Accept-Version': '8'
  };

  const url =
    `${baseUrl}/consignments/${encodeURIComponent(consignmentId)}`;

  const [consignmentResponse, itemsResponse] =
    await Promise.all([

      axios.get(url, {
        headers,
        timeout: 20000
      }),

      axios.get(`${url}/items`, {
        headers,
        timeout: 20000
      })

    ]);

  const consignment =
    consignmentResponse.data?.data ||
    consignmentResponse.data;

  const rawItems =
    itemsResponse.data?.data ||
    itemsResponse.data;

  const items = Array.isArray(rawItems)
    ? rawItems
    : Array.isArray(rawItems?.items)
      ? rawItems.items
      : null;

  if (!items) {
    throw new Error(
      'Unexpected consignment items API response shape'
    );
  }

  return {
    consignment,
    items
  };
}

// ======================================================
// 5. Determine the next fulfillment action
// ======================================================

function nextActionFor(status, consignment) {

  if (status === 'DISPATCHED') {
    return 'CHECK_NETSUITE_ITEM_FULFILLMENT';
  }

  if (['DELIVERED', 'COLLECTED'].includes(status)) {
    return 'VERIFY_NETSUITE_FULFILLMENT_AND_DELIVERY';
  }

  if (status === 'AWAITING_STOCK') {
    return 'VERIFY_RECEIPT_AND_STOCK_ALLOCATION';
  }

  if (status === 'AWAITING_PICK_AND_PACK') {
    return 'WAREHOUSE_PICK_AND_PACK_CONFIRMATION_REQUIRED';
  }

  if (!consignment) {
    return 'REVIEW_ORDER_AND_CONSIGNMENT';
  }

  return 'REVIEW_LIFECYCLE_ACTIONS';
}

// ======================================================
// 6. Main automation function
// ======================================================

async function main() {

  // Step 1: Find Sales Order mapping

  const entry = readOrderMapping();

  const ccId = entry.cartoncloud.ccId;

  // Step 2: Retrieve outbound order

  const order = await getOrderLifecycle(ccId);

  // Step 3: Validate outbound order identity

  if (order.id && order.id !== ccId) {
    throw new Error(
      'CartonCloud outbound order ID mismatch'
    );
  }

  if (
    order.references?.customer &&
    order.references.customer !== so
  ) {
    throw new Error(
      'CartonCloud sales order reference mismatch'
    );
  }

  // Step 4: Find generated consignment tasks

  const tasks = Array.isArray(order.generatedTasks)
    ? order.generatedTasks
    : [];

  const consignmentTasks = tasks.filter(
    t => t.type === 'CONSIGNMENT' && t.id
  );

  const consignments = [];

  // Step 5: Retrieve each consignment

  if (consignmentTasks.length) {

    const token = await getToken();

    for (const task of consignmentTasks) {

      const { consignment, items } =
        await readConsignment(task.id, token);

      if (
        consignment.id &&
        consignment.id !== task.id
      ) {
        throw new Error(
          `Consignment ID mismatch: ${task.id}`
        );
      }

      if (
        consignment.generatedFromTask?.id &&
        consignment.generatedFromTask.id !== ccId
      ) {
        throw new Error(
          `Consignment ${task.id} belongs to a different outbound order`
        );
      }

      consignments.push({

        id: task.id,

        numericId:
          consignment.references?.numericId ?? null,

        status:
          consignment.status ?? null,

        transportItemCount:
          items.length,

        transportItems: items.map(item => ({

          id: item.id,

          label:
            item.references?.label ?? null,

          sku:
            item.details?.product?.references?.code ?? null,

          productName:
            item.details?.product?.name ?? null,

          quantity:
            item.measures?.quantity ?? null,

          weight:
            item.measures?.weight ?? null,

          verificationStatus:
            item.details?.status ?? null

        }))

      });
    }
  }

  // Step 6: Check labels and possible problems

  const labelsPrinted =
    order.details?.labelsPrinted ?? null;

  const warnings = [];

  if (labelsPrinted === false) {
    warnings.push(
      'CartonCloud reports labelsPrinted=false; ' +
      'verify label printing separately.'
    );
  }

  if (
    consignments.some(c =>
      c.transportItems.some(i => !i.sku)
    )
  ) {
    warnings.push(
      'At least one transport item has no product SKU; ' +
      'review before shipping changes.'
    );
  }

  if (
    order.status === 'DISPATCHED' &&
    consignments.some(c => c.status === 'IN_WAREHOUSE')
  ) {
    warnings.push(
      'Outbound order is DISPATCHED while a consignment ' +
      'is IN_WAREHOUSE; review transport status separately.'
    );
  }

  // Step 7: Build automation report

  const report = {

    inspectedAt:
      new Date().toISOString(),

    soNumber:
      so,

    netsuiteSalesOrderInternalId:
      entry.netsuite.internalId ?? null,

    ccId,

    status:
      order.status ?? null,

    orderedQuantity:
      order.measures?.totalQuantity ?? null,

    assignedPacker:
      order.assignee?.name ?? null,

    packed:
      Boolean(order.timestamps?.packed?.time),

    dispatched:
      Boolean(order.timestamps?.dispatched?.time),

    labelsPrinted,

    availableActions:
      order.lifecycleState?.actions ?? {},

    automaticConsignmentGeneration:
      order.lifecycleState?.automaticConsignmentGeneration ?? null,

    consignments,

    nextAction:
      nextActionFor(order.status, consignments[0]),

    warnings,

    readOnly: true
  };

  // Step 8: Save JSON report

  fs.mkdirSync(outputDir, {
    recursive: true
  });

  const filename = path.join(
    outputDir,
    `cc-automation-${so.replace(/[^a-z0-9_-]/gi, '_')}.json`
  );

  fs.writeFileSync(
    filename,
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );

  // Step 9: Display results

  console.log(
    JSON.stringify(report, null, 2)
  );

  console.log(
    `\nSaved report: ${filename}`
  );

  console.log(
    'READ-ONLY: No CartonCloud or NetSuite records were changed.'
  );
}

// ======================================================
// 7. Start program
// ======================================================

main().catch(err => {

  console.error(
    'Fulfillment assessment failed:',
    err.response?.status || '',
    JSON.stringify(
      err.response?.data || err.message
    )
  );

  process.exitCode = 1;
});