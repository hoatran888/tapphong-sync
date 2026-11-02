# NetSuite — How to Find Script ID and Deploy ID

*Date: 2026-10-20*

---

## Method 1 — Via Scripts page

```
Customization → Scripting → Scripts
```
- Find your RESTlet (`rl_create_item.js`) → click it
- **Script ID** is on the script record page
- Click the **Deployments** tab → **Deploy ID** is listed there

---

## Method 2 — Via Script Deployments page

```
Customization → Scripting → Script Deployments
```
- Find your deployment → both IDs are shown

---

## Method 3 — From the RESTlet URL

When you first deployed the RESTlet, NetSuite gave you this URL:
```
https://12222161-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=1942&deploy=1
```
- `script=1942` → `NS_SCRIPT_ID`
- `deploy=1` → `NS_DEPLOY_ID`

---

## Where they go in `.env`

```
NS_SCRIPT_ID=1942
NS_DEPLOY_ID=1
```
