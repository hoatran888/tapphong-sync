# NetSuite TBA — Where to Get Your Credentials

---

### `NS_ACCOUNT` — Your Account ID

1. Log into NetSuite
2. Go to **Setup → Company → Company Information**
3. Look for **Account ID** — it looks like `1234567` or `1234567-SB1` (SB1 = sandbox)

Or check the URL when logged in:
```
https://1234567.app.netsuite.com  ← the number before .app is your account ID
```

---

### `CONSUMER_KEY` + `CONSUMER_SECRET` — From the Integration record

1. Go to **Setup → Integration → Manage Integrations → New**
2. Fill in:
   - **Name**: e.g. `Node.js TBA`
   - **State**: Enabled
   - Check **Token-Based Authentication**
   - Uncheck OAuth 2.0 options
3. Click **Save**
4. NetSuite shows the **Consumer Key** and **Consumer Secret** once — copy them immediately, they won't be shown again

---

### `TOKEN_KEY` + `TOKEN_SECRET` — From the Access Token record

1. Go to **Setup → Users/Roles → Access Tokens → New**
2. Fill in:
   - **Application Name**: pick the Integration you just created
   - **User**: your NetSuite user (e.g. admin)
   - **Role**: Administrator (or the role your scripts run under)
3. Click **Save**
4. NetSuite shows the **Token ID** and **Token Secret** once — copy them immediately

---

### Summary

| Constant | Where in NetSuite |
|---|---|
| `NS_ACCOUNT` | Setup → Company → Company Information → Account ID |
| `CONSUMER_KEY` | Setup → Integration → Manage Integrations → Save → shown once |
| `CONSUMER_SECRET` | Same page as Consumer Key → shown once |
| `TOKEN_KEY` | Setup → Users/Roles → Access Tokens → New → Save → shown once |
| `TOKEN_SECRET` | Same page as Token Key → shown once |

> All five values are shown **only once** at creation time — if you miss them you have to delete and recreate the integration or token.

---

*Generated: 2026-10-15*
