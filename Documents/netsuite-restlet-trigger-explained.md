# NetSuite RESTlet — What Triggers It

*Date: 2026-10-20*

---

## A RESTlet has no automatic trigger

It only runs when something calls it from outside via HTTP.

---

## What triggers it in this project

```
Your Mac
  node run.js
    → call-create-item.js builds the URL
    → ns-tba.js signs the request
    → axios sends HTTP POST
          ↓
    NetSuite receives the POST
          ↓
    RESTlet executes rl_create_item.js → post(body)
```

Every time you run `node run.js`, it fires the RESTlet once per item.

---

## RESTlet supports 4 HTTP methods

| HTTP Method | Function | Typical use |
|---|---|---|
| `GET` | `get(params)` | Fetch a record |
| `POST` | `post(body)` | Create a record |
| `PUT` | `put(body)` | Update a record |
| `DELETE` | `delete(params)` | Delete a record |

This project only uses `post()` — that's why `call-create-item.js` sends a POST.

---

## Other things that can trigger a RESTlet

| Trigger | Example |
|---|---|
| Node.js script | What this project does |
| Another system's webhook | CartonCloud calls NetSuite when an order ships |
| Scheduled script | NS runs a script every night that calls the RESTlet |
| Postman | Manually test during development |
| Any HTTP client | curl, Python, PHP — anything that can send HTTP |

---

## RESTlet vs other NS script types

| Script Type | Triggered by |
|---|---|
| **RESTlet** | External HTTP call |
| **Scheduled Script** | Timer (e.g. every night at 2am) |
| **User Event Script** | Saving/editing a record in NS UI |
| **Workflow Action** | A workflow step in NS |
| **Suitelet** | Browser URL visit |

RESTlet is the right choice when an external system needs to talk to NetSuite.
