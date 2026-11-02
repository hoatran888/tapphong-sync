# NetSuite TBA — Where to Get the 4 Secret Keys

*Date: 2026-10-20*

---

## Consumer Key + Secret

```
Setup → Integration → Manage Integrations → New
```

Fill in:
- **Name:** Tapphong Sync (anything)
- **Authentication:** check Token-Based Authentication
- Save → copy the 2 keys immediately

---

## Token Key + Secret

```
Setup → Users/Roles → Access Tokens → New
```

Fill in:
- **Application Name:** pick your integration
- **User:** your admin user
- **Role:** Administrator
- Save → copy the 2 keys immediately

---

## Important

Both pages only show the secrets **once** — copy them to `.env` before navigating away. NetSuite will never show them again.

---

## Where they go in `.env`

```
NS_ACCOUNT=12222161_SB1
NS_CONSUMER_KEY=abc123...
NS_CONSUMER_SECRET=xyz789...
NS_TOKEN_KEY=token123...
NS_TOKEN_SECRET=tokensecret456...
NS_SCRIPT_ID=1942
NS_DEPLOY_ID=1
```
