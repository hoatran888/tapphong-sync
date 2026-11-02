require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getOrderLifecycle } = require('./cc-fulfillment-api');

function arg(name) {
    return process.argv
        .find(a => a.startsWith(`--${name}=`))
        ?.slice(name.length + 3);
}

const so = arg('so');
const packer = arg('packer');
const execute = process.argv.includes('--execute');

if (!so || !packer) {
    console.error(
        'Usage: node assign-cc-packer.js --so=SO_NUMBER --packer=USER_UUID [--execute]'
    );
    process.exit(1);
}

async function main() {

    const file = path.join(
        __dirname,
        'output',
        'create-so-result.json'
    );

    const records = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : [];

    const record = records.find(r => r.soNumber === so);

    const ccId = arg('cc-id') || record?.cartoncloud?.ccId;

    if (!ccId) {
        throw new Error(
            `CartonCloud ID not found for ${so}. Use --cc-id=UUID.`
        );
    }

    const order = await getOrderLifecycle(ccId);

    if (order.id !== ccId ||
        order.references?.customer !== so) {
        throw new Error('Sales Order or CartonCloud ID mismatch');
    }

    console.log('Sales Order:', so);
    console.log('CartonCloud UUID:', ccId);
    console.log('Current Status:', order.status);
    console.log('Current Assignee:', order.assignee?.task || null);

    if (order.status === 'DISPATCHED') {
        console.log('Order already dispatched.');
        return;
    }

    if (order.lifecycleState?.actions?.ASSIGN?.allowed !== true) {
        throw new Error('ASSIGN action is not permitted');
    }

    const body = {
        type: 'ASSIGN',
        details: {
            user: {
                id: packer
            }
        }
    };

    console.log('Assignment request:', JSON.stringify(body, null, 2));

    if (!execute) {
        console.log('PREVIEW ONLY — no changes made.');
        return;
    }

    const base = process.env.CC_BASE_URL || '';

    const match = base.match(
        /^(https:\/\/[^/]+\/tenants\/[^/]+)\/products\/?$/
    );

    if (!match) {
        throw new Error('Invalid CC_BASE_URL');
    }

    const fulfillmentClientId =
    process.env.CC_FULFILLMENT_CLIENT_ID;

const fulfillmentClientSecret =
    process.env.CC_FULFILLMENT_CLIENT_SECRET;

if (!fulfillmentClientId || !fulfillmentClientSecret) {
    throw new Error(
        'Missing CartonCloud Fulfillment credentials in .env'
    );
}

    const tokenRes = await axios.post(
        process.env.CC_AUTH_URL ||
        'https://api.na.cartoncloud.com/uaa/oauth2/token',
        new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.CC_FULFILLMENT_CLIENT_ID,
            client_secret: process.env.CC_FULFILLMENT_CLIENT_SECRET})
    );

    const url =
        `${match[1]}/activities/${ccId}/actions?activityType=OUTBOUND`;

    await axios.post(url, body, {
        headers: {
            Authorization: `Bearer ${tokenRes.data.access_token}`,
            'Accept-Version': '8',
            'Content-Type': 'application/json'
        }
    });

    console.log('Assignment request accepted.');

    const updated = await getOrderLifecycle(ccId);

    console.log(
        'Updated Assignee:',
        JSON.stringify(updated.assignee?.task, null, 2)
    );

    console.log(
        'START Permission:',
        JSON.stringify(
            updated.lifecycleState?.actions?.START,
            null,
            2
        )
    );
}

main().catch(err => {
    console.error(
        'ERROR:',
        err.response?.status,
        err.response?.data || err.message
    );
    process.exitCode = 1;
});