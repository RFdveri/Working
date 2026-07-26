# AI Door Assistant for AmoCRM

A multi-agent AI sales assistant for a door retailer, built to run inside
AmoCRM as an installable Marketplace widget. See `docs/ARCHITECTURE.md` for
the full design and `docs/AMOCRM_WIDGET_PACKAGING.md` for Marketplace
packaging steps.

## Status

This is an architecture scaffold: real, working code for every module in the
spec (Director + 11 specialist agents, AmoCRM OAuth client, a live rf-dveri.ru
catalog feed, pricing engine, widget UI), wired together behind clean
interfaces so the remaining mocked pieces (LLM, OCR, STT, service price list)
can be swapped for production integrations without touching agent logic. See
"Known scaffold limitations" in `docs/ARCHITECTURE.md` before treating any
environment as production-ready.

## Project layout

```
packages/shared    Shared TypeScript types (Agent contracts, domain models)
services/backend   Node/Express API: Director + agents, integrations
apps/widget        React/TS widget SPA + AmoCRM widget package
docs/              Architecture and packaging docs
```

## Setup

```bash
npm install
cp .env.example .env   # fill in what you have; everything else falls back to mocks
```

Run the backend:

```bash
npm run dev:backend   # http://localhost:4000
```

Run the widget (proxies /api to the backend):

```bash
npm run dev:widget    # http://localhost:5173
```

Build everything:

```bash
npm run build
```

## Configuring real integrations

| Env var | Enables |
|---|---|
| `AMOCRM_SUBDOMAIN`, `AMOCRM_CLIENT_ID`, `AMOCRM_CLIENT_SECRET` | AmoCRM OAuth + CRM operations (deals/contacts/notes/tasks/Digital Pipeline) |
| `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` | Real LLM reasoning for Human Sales / Material Expert / Vision / Summary agents (defaults to a mock echo provider) |
| `CATALOG_FEED_URL`, `CATALOG_FEED_TTL_MS` | rf-dveri.ru catalog — **already real by default**, reads the live YML export feed (see `docs/ARCHITECTURE.md` for what's extracted vs. left blank) |
| `services/backend/src/config/service-prices.json` | Installation/measurement/delivery prices and the custom-size surcharge rule — the Price Agent refuses to guess these |

Until these are configured, the corresponding agents return a clarifying
question instead of fabricating an answer, per the spec's "не выдумывать"
rule (see `docs/ARCHITECTURE.md`).

## Quality gates before release

Per the spec, run before shipping to the Marketplace: Code Review, Security
Review, UX Review, Performance Review, Marketplace Review (AmoCRM's own
submission checklist — see `docs/AMOCRM_WIDGET_PACKAGING.md`).
