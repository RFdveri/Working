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
| Catalog | `CatalogClient` | — | `RfDveriCatalogClient` (HTTP scrape of rf-dveri.ru; **selectors are placeholders**, see the file's header comment) |
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

## Known scaffold limitations (by design, see the task's scope discussion)

- `RfDveriCatalogClient` scrapes HTML with placeholder CSS selectors — it will
  need real selectors (or a real API/export) before it returns real data.
- `JsonServicePriceProvider` starts with an empty price list — the Price Agent
  correctly refuses to compute totals for services/custom sizes until you fill
  `services/backend/src/config/service-prices.json`.
- `DirectorAgent`'s routing (price-intent detection, when to call each
  specialist) is a heuristic, not an LLM planner — swap in function-calling /
  tool-use once end-to-end conversations need more nuanced routing.
- Memory, conversations, and tasks are in-memory (`InMemoryMemoryStore`,
  `ConversationManager`) — fine for local dev, needs a DB-backed
  implementation of the same interfaces before production traffic.
