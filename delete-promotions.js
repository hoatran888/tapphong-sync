require('dotenv').config();
const Imap = require('imap');

const imap = new Imap({
  user:     process.env.SMTP_USER,
  password: process.env.SMTP_PASS.replace(/\s+/g, ''),
  host:     'imap.gmail.com',
  port:     993,
  tls:      true,
  tlsOptions: { rejectUnauthorized: false },
});

const open  = (box) => new Promise((res, rej) => imap.openBox(box, false, (e, b) => e ? rej(e) : res(b)));
const search = (q)  => new Promise((res, rej) => imap.search(q, (e, u) => e ? rej(e) : res(u || [])));
const expunge = ()  => new Promise((res, rej) => imap.expunge((e) => e ? rej(e) : res()));

function flagDeleted(uids) {
  return new Promise((res, rej) => {
    // Process in chunks of 1000 UIDs to avoid oversized commands
    const chunks = [];
    for (let i = 0; i < uids.length; i += 1000) chunks.push(uids.slice(i, i + 1000));
    let i = 0;
    const next = () => {
      if (i >= chunks.length) return res();
      imap.addFlags(chunks[i++], '\\Deleted', (e) => e ? rej(e) : next());
    };
    next();
  });
}

async function run() {
  await new Promise((res, rej) => {
    imap.once('ready', res);
    imap.once('error', rej);
    imap.connect();
  });
  console.log(`Connected as ${process.env.SMTP_USER}`);

  // ── Step 1: flag ALL Promotions in All Mail as \Deleted, then expunge ─────
  // (Gmail moves them to Trash — does NOT permanently delete from All Mail)
  await open('[Gmail]/All Mail');
  const promoUids = await search([['X-GM-RAW', 'category:promotions']]);
  console.log(`Found ${promoUids.length} Promotions emails — flagging all as deleted...`);

  if (promoUids.length) {
    await flagDeleted(promoUids);
    console.log('Flags set. Expunging from All Mail (moves to Trash)...');
    await expunge();
    console.log('Done — emails are now in Trash');
  }

  // ── Step 2: open Trash, flag ALL as \Deleted, expunge → permanent delete ──
  console.log('\nOpening Trash to permanently delete...');
  const trashInfo = await open('[Gmail]/Trash');
  const trashCount = trashInfo.messages?.total ?? trashInfo.exists ?? 0;
  console.log(`Trash contains ${trashCount} emails`);

  if (trashCount > 0) {
    const trashUids = await search(['ALL']);
    console.log(`Flagging ${trashUids.length} Trash emails as deleted...`);
    await flagDeleted(trashUids);
    console.log('Expunging Trash (permanently deletes)...');
    await expunge();
    console.log(`Permanently deleted ${trashUids.length} emails from Trash`);
  }

  console.log(`\nDone. ${promoUids.length} Promotions emails permanently deleted.`);
  imap.end();
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
