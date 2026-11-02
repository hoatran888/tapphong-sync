#!/usr/bin/env node

// Read-only PO reconciliation.
// Requires Node.js 18+.
// No records are created, updated, or deleted.

import fs from 'node:fs';
import path from 'node:path';

// ============================================
// 1. Load environment variables
// ============================================

function loadEnv(file = '.env') {
    if (!fs.existsSync(file)) return;

    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {

        const m = line.match(
            /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/
        );

        if (!m || process.env[m[1]] !== undefined) continue;

        let v = m[2].trim();

        if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
        ) {
            v = v.slice(1, -1);
        }

        process.env[m[1]] = v;
    }
}

loadEnv();

// ============================================
// 2. Read command-line arguments
// ============================================

const args = Object.fromEntries(
    process.argv
        .slice(2)
        .filter(x => x.startsWith('--'))
        .map(x => {
            let [k, ...v] = x.slice(2).split('=');
            return [k, v.length ? v.join('=') : true];
        })
);

const poId = String(args['ns-po-id'] || '9');

const sku = String(args.sku || 'TP-2026-1004');

const ccId = String(
    args['cc-po-id'] ||
    '3d0ccd98-80e3-47e8-96b3-a18e6cc53eca'
);

// ============================================
// 3. NetSuite configuration
// ============================================

const account = (
    process.env.NS_ACCOUNT_ID || '12222161-sb1'
)
    .toLowerCase()
    .replace('_', '-');

const base =
    `https://${account}.suitetalk.api.netsuite.com/services/rest`;

const token = process.env.NS_ACCESS_TOKEN;

if (!token) {
    console.error('Missing NS_ACCESS_TOKEN in .env');
    process.exit(1);
}

// ============================================
// 4. Generic HTTP GET function
// ============================================

async function getJSON(url, bearer = token, headers = {}) {

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${bearer}`,
            Accept: 'application/json',
            ...headers
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = { raw: text.slice(0, 2000) };
    }

    if (!response.ok) {
        throw new Error(
            `GET ${new URL(url).pathname} -> HTTP ${response.status}: ` +
            JSON.stringify(data).slice(0, 900)
        );
    }

    return data;
}

// ============================================
// 5. Helper functions
// ============================================

function extractRows(x) {
    return Array.isArray(x?.items)
        ? x.items
        : Array.isArray(x)
            ? x
            : [];
}

function normalize(s) {
    return String(s ?? '').trim().toUpperCase();
}

function refId(x) {
    return x && typeof x === 'object'
        ? (x.id ?? x.refName ?? x.name)
        : x;
}

function getLineSku(line) {
    return line.item?.refName ||
        line.item?.name ||
        line.itemId ||
        line.sku ||
        line.itemid ||
        '';
}

function qty(line) {
    return Number(
        line.quantity ?? line.quantityReceived ?? 0
    );
}

// ============================================
// 6. Prepare reconciliation report
// ============================================

const report = {

    generatedAt: new Date().toISOString(),

    mode: 'READ_ONLY',

    sku,

    expected: {
        businessPo: 'PO-2026-1004',
        nsInternalId: poId,
        ccUuid: ccId,
        cartonSizePieces: 10
    },

    netsuite: {},

    cartoncloud: {},

    checks: [],

    warnings: []
};

// ============================================
// 7. Retrieve NetSuite Purchase Order
// ============================================

try {

    const po = await getJSON(
        `${base}/record/v1/purchaseOrder/${encodeURIComponent(poId)}`
    );

    report.netsuite.po = {
        id: po.id,
        tranId: po.tranId,
        externalId: po.externalId,
        status: po.status,
        location: po.location,
        memo: po.memo
    };

    // Retrieve PO item lines

    // const lines = await getJSON(
    //     `${base}/record/v1/purchaseOrder/${encodeURIComponent(poId)}/item?limit=1000`
    // );

    const lines = await getJSON(
    `${base}/record/v1/purchaseOrder/${encodeURIComponent(poId)}/item`
    );

    report.netsuite.lines = extractRows(lines).map(x => ({
        line: x.line,
        item: x.item,
        quantity: x.quantity,
        units: x.units,
        rate: x.rate,
        amount: x.amount,
        quantityReceived: x.quantityReceived,
        quantityBilled: x.quantityBilled
    }));

    // Retrieve individual line details

    const details = [];

    for (const line of extractRows(lines)) {

        const self = line.links?.find(
            l => l.rel === 'self'
        )?.href;

        if (self) {

            try {
                details.push(await getJSON(self));
            } catch (e) {
                report.warnings.push(
                    `PO line detail unavailable: ${e.message}`
                );
            }

        } else {
            details.push(line);
        }
    }

    report.netsuite.lineDetails = details.map(x => ({
        line: x.line,
        item: x.item,
        quantity: x.quantity,
        units: x.units,
        rate: x.rate,
        amount: x.amount,
        quantityReceived: x.quantityReceived,
        quantityBilled: x.quantityBilled
    }));

    report.checks.push({
        name: 'NetSuite PO fetched',
        result: 'PASS'
    });

    if (po.tranId !== 'PO02') {
        report.warnings.push(
            `NetSuite PO id ${poId} tranId is ` +
            `${po.tranId || '(missing)'}, not PO02; verify mapping.`
        );
    }

} catch (e) {

    report.netsuite.error = e.message;

    report.checks.push({
        name: 'NetSuite PO fetched',
        result: 'ERROR'
    });
}

// ============================================
// 8. Check NetSuite Item Receipts
// ============================================

// The program does not assume that the PO
// automatically contains all linked receipts.
//
// A verified read-only receipt URL can be supplied.
// Otherwise, inspect NetSuite:
// PO > Related Records > Receipts.

if (args['ns-receipts-url']) {

    try {

        const u = new URL(args['ns-receipts-url']);

        if (u.origin !== new URL(base).origin) {
            throw new Error(
                'Receipt URL must be on same NetSuite host'
            );
        }

        report.netsuite.receipts = await getJSON(
            u.toString()
        );

    } catch (e) {

        report.warnings.push(
            `Receipt read failed: ${e.message}`
        );
    }

} else {

    report.warnings.push(
        'Existing NetSuite Item Receipts NOT independently checked. ' +
        'Supply --ns-receipts-url if you have a verified read-only ' +
        'receipt endpoint; otherwise inspect PO > Related Records > Receipts.'
    );
}

// ============================================
// 9. Retrieve CartonCloud Purchase Order
// ============================================

// We do not guess tenant-specific CartonCloud
// API endpoints.
//
// Supply a verified URL or a saved JSON file.

if (args['cc-url']) {

    try {

        const u = new URL(args['cc-url']);

        if (u.protocol !== 'https:') {
            throw new Error(
                'CartonCloud URL must use HTTPS'
            );
        }

        if (!process.env.CC_ACCESS_TOKEN) {
            throw new Error(
                'Missing CC_ACCESS_TOKEN'
            );
        }

        const data = await getJSON(
            u.toString(),
            process.env.CC_ACCESS_TOKEN
        );

        report.cartoncloud = {
            source: 'live GET',
            urlOrigin: u.origin,
            record: data
        };

    } catch (e) {

        report.cartoncloud.error = e.message;
    }

} else if (args['cc-file']) {

    try {

        report.cartoncloud = {
            source: 'local snapshot',
            record: JSON.parse(
                fs.readFileSync(
                    args['cc-file'],
                    'utf8'
                )
            )
        };

    } catch (e) {

        report.cartoncloud.error = e.message;
    }

} else {

    report.cartoncloud = {

        source: 'previously observed; NOT live verified',

        poUuid: ccId,

        numericId: '18',

        initialPieces: 100,

        onHandPieces: 98,

        status: 'Allocated'
    };

    report.warnings.push(
        'CartonCloud values are historical observations, ' +
        'not a fresh API read. ' +
        'Provide --cc-url=YOUR_VERIFIED_GET_URL ' +
        'or --cc-file=cc-po18.json.'
    );
}

// ============================================
// 10. Safety warning
// ============================================

report.warnings.push(
    'No receipt or inventory movement will be created. ' +
    'Do not infer physical receipt or dispatch from status alone.'
);

// ============================================
// 11. Save reconciliation report
// ============================================

const out = args.output ||
    path.join(
        'output',
        `po-reconciliation-${poId}.json`
    );

fs.mkdirSync(
    path.dirname(out),
    { recursive: true }
);

fs.writeFileSync(
    out,
    JSON.stringify(report, null, 2)
);

// ============================================
// 12. Display summary
// ============================================

console.log(
    JSON.stringify(
        {
            mode: report.mode,
            netSuitePO: report.netsuite.po || null,
            cartonCloudSource:
                report.cartoncloud.source || 'error',
            warnings: report.warnings,
            output: out
        },
        null,
        2
    )
);