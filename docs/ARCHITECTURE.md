# Architecture

## Overview

```
apps/widget          React/TS SPA — the panel embedded in AmoCRM (status,
                      action log, analysis history, found products,
                      calculations, recommendations, tasks) + chat input.
apps/widget/amocrm    AmoCRM classic-widget package (manifest, i18n, bootstrap
                      script) that mounts the SPA in an iframe.
services/backend      Node/TS API: Director + 11 specialist agents, AmoCRM
                      client, catalog client, LLM/OCR/STT providers.
packages/shared       TypeScript types shared by both (Agent contracts,
                      Message/Product/Memory/Pricing/AmoCRM DTOs).
```

## Request flow

1. A message arrives either from the widget chat (`POST /api/conversations/:id/messages`)
   or from AmoCRM's Digital Pipeline webhook (`POST /api/amocrm/webhook`).
2. `ConversationManager` records it and builds an `AgentContext` (mode,
   manager-handoff flag, customer memory, message history).
3. `DirectorAgent.handle()` runs:
   - Attachments go to `VisionAgent` / `DocumentAgent` / `VoiceAgent` first, and
     their extracted text is folded into the message.
   - `SearchAgent` looks the query up in the rf-dveri.ru catalog.
   - If the message has price intent, `PriceAgent` computes a `PriceCalculation`
     — and lists exactly which inputs were missing instead of guessing them.
   - `HumanSalesAgent` (LLM-backed) drafts the customer-facing reply, grounded
     only in the facts the steps above actually found.
   - `CrmAgent` files an AmoCRM note with the AI's reply, if a deal is linked.
4. The reply, found products, price calculation, and the full per-agent log
   trail go back to the widget so every panel can render from one response.

## The manager handoff rule

The moment a `role: "manager"` message is posted to a conversation,
`ConversationManager.markManagerActive()` flips `managerActive` and forces
`mode` to `"hints-only"`. `DirectorAgent` checks `context.managerActive` first
and returns immediately without calling `HumanSalesAgent` — the AI stops
talking to the customer, and (in `hints-only` mode) keeps running the
grounding steps (search/price) so the manager still gets that context, without ever
sending it to the customer.

## Where mocks vs. real integrations live

| Concern | Interface | Default (mock) | Real implementation |
|---|---|---|---|
| LLM reasoning | `LlmProvider` | `MockLlmProvider` (echoes input) | `AnthropicProvider` (set `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) |
| Catalog | `CatalogClient` | — | `RfDveriYmlCatalogClient` — **real**, reads the live rf-dveri.ru YML export feed (`CATALOG_FEED_URL`, ~7000 offers), cached on a TTL. See caveats below. |
| AmoCRM | — | `null` when unconfigured (agents degrade to "not configured" + a clarifying question) | `AmoCrmClient` (OAuth + REST) |
| Service/custom-size pricing | `ServicePriceProvider` | `JsonServicePriceProvider` reading `config/service-prices.json` (starts empty) | Same interface, swap the JSON for a real price-list source |
| OCR | `OcrProvider` | `MockOcrProvider` | plug in a real OCR SDK behind the same interface |
| STT | `SttProvider` | `MockSttProvider` | plug in Whisper (or similar) behind the same interface |

Every agent depends only on these interfaces (constructor injection via
`AppContainer`), so replacing a mock with a real integration never touches
agent code.

## Why some agents look "thin"

`ProductAgent`, `SearchAgent`, `CrmAgent`, `TaskAgent`, `VoiceAgent`, and
`DocumentAgent` are mostly typed wrappers over a single integration call.
That's intentional: the spec's "не выдумывать" (don't invent data) rule means
these agents must be pass-throughs to the actual source of truth, not
LLM-generated guesses — the "intelligence" belongs in `DirectorAgent`'s
routing and `HumanSalesAgent`'s phrasing, not in these lookups.

## The catalog feed (`RfDveriYmlCatalogClient`)

Reads the real YML (Yandex Market) export at `CATALOG_FEED_URL` — a
Windows-1251-encoded XML feed with ~7000 offers, no auth required. Notes:

- The feed is fetched and parsed once, then cached for `CATALOG_FEED_TTL_MS`
  (default 30 min); concurrent callers during a refresh share one in-flight
  fetch instead of triggering duplicate downloads.
- The feed only carries `id`/`vendorCode`/`price`/`url`/`picture(s)`/`name`/
  `description`/`vendor`/`categoryId` — there's no structured width/height/
  covering field. `color`, `material`, `covering`, `weightKg`, `collection`
  (series), and `installation` are extracted from the free-text
  `description` with regexes tuned to the interior-door description
  template. That template doesn't cover every offer:
  - Entry doors (входные двери) and hardware/accessories use different
    description templates, so some of these fields come back `undefined`
    for them, or occasionally over-capture into `coveringRaw` — never a
    fabricated value, just a field the extractor couldn't cleanly parse.
  - `covering` maps a small set of known keywords (эмаль, экошпон/шпон, пвх,
    полипропилен, ламинат) to the shared `CoveringMaterial` enum; anything
    else is `"other"` with the raw source text kept in `coveringRaw` rather
    than being forced into the wrong bucket.
  - The feed's `available` attribute is `"true"` for every offer in current
    exports — treat `availability: "in-stock"` as "listed", not as a live
    stock guarantee, until this is cross-checked against a real inventory
    source.
- Search is in-process token-matching (no external search engine): the query
  is tokenized, matched against a precomputed per-offer haystack
  (name/sku/collection/color/material/covering/vendor/category), and results
  are ranked by token-match count. Good enough for conversational queries at
  ~7000 offers; swap for a real search index if the catalog grows much larger
  or ranking quality needs to improve.

## Known scaffold limitations (by design, see the task's scope discussion)

- `JsonServicePriceProvider` starts with an empty price list — the Price Agent
  correctly refuses to compute totals for services/custom sizes until you fill
  `services/backend/src/config/service-prices.json`.
- `DirectorAgent`'s routing (price-intent detection, when to call each
  specialist) is a heuristic, not an LLM planner — swap in function-calling /
  tool-use once end-to-end conversations need more nuanced routing.
- Memory, conversations, and tasks are in-memory (`InMemoryMemoryStore`,
  `ConversationManager`) — fine for local dev, needs a DB-backed
  implementation of the same interfaces before production traffic.
