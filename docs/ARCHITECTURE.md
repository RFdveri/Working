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
   - The conversation's anchored product (`context.focusProduct`, see below) is
     re-resolved by SKU via `ProductAgent`; if there's no anchor yet, the
     fresh search's top result becomes it.
   - If the message has price intent or mentions a kit ("комплект"/"под
     ключ"/"коробк"/"наличник"/"добор"), `PriceAgent` computes a
     `PriceCalculation` for the anchored product — kits use `{ kit: {
     frameQuantity, casingQuantity, doorQuantity?, wallThicknessMm?,
     jambExtensionQuantity? } }` to auto-resolve the frame/casing (and,
     when the wall is thicker than the frame, the добор/jamb-extension board)
     from the door's own product-page configurator (see "The catalog feed"
     below). `doorQuantity` multiplies every per-door quantity so a bulk order
     (e.g. 5 doors) is one code-computed total, not the LLM doing the
     multiplication itself. Any ambiguous or missing match becomes a
     clarifying question, never a guess. (The same `POST
     /api/conversations/:id/price` endpoint also accepts explicit `{ sku,
     quantity, role }[]` components directly, outside the conversational flow.)
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

## Conversation continuity: the focus product

Found by testing a real multi-turn conversation: `DirectorAgent` used to
re-run `SearchAgent` from scratch on every turn's raw text alone. Once a
customer stopped repeating the product's name ("глухую беру, проём 2000×900"
mentions no product), the fresh search matched a *different, unrelated*
item, and `PriceAgent` priced that instead — silently wrong, not just
un-grounded.

Fix: `Conversation.focusProduct` (`{ id, sku, name }`) is set the first time
a product is established and persists across turns (`ConversationManager
.setFocusProduct`, read back into `AgentContext.focusProduct`). Every turn,
`DirectorAgent` re-resolves that SKU via `ProductAgent` (a cheap catalog
lookup, not a re-search) and uses *that* product for price/kit
calculations — the turn's fresh search results still populate "other options
found" grounding text, but never silently override what's being priced.
`groundedContext` also repeats "Клиент сейчас обсуждает: ..." every turn (not
just once) so `HumanSalesAgent` doesn't drift to a different item it saw in
that turn's search results.

The focus is sticky by default, but `mentionsProductByName()` allows an
explicit switch: if the customer's own text contains a distinctive 5+ letter
word from a *different* search result's name (not a generic material/color
word — see `GENERIC_PRODUCT_NAME_WORDS`), focus moves to that product even
mid-conversation. This needed two follow-up fixes, both found by live
testing:

- The check originally only looked at the search's top-ranked result. Search
  ranks by raw token-match count, so a phrase shared with many offers (e.g.
  "античный орех", present in dozens of unrelated products) can outrank the
  specific model the customer typed — a customer naming "Валенсия" mid-
  conversation didn't switch focus because Валенсия was ranked 13th, not
  1st. Fixed by scanning the *entire* result list for an explicit match, not
  just index 0.
- Standalone hardware/accessory offers (коробка, наличник, добор, капитель,
  ...) are themselves catalog products literally named "Добор ...", "Коробка
  ...". Once the accessory-name check was scanning the whole result list, a
  customer just asking about "добор" matched an actual "Добор телескопический
  ..." accessory SKU by name and switched focus to *that*, instead of staying
  on the door. Fixed by excluding anything under the "Комплектующие" category
  path from `foundProducts` before it's ever considered as a focus candidate
  — those are only ever kit *components* of a door, never the door itself.

## Bulk kits with jamb extensions (добор) and multiple doors

Found while pricing a real 5-door order: `PriceAgent`'s `kit` input now
supports `doorQuantity` (every per-door quantity — frame, casing, jamb
extension — is multiplied by it, so a bulk order is one code-computed total
instead of the LLM doing the multiplication itself) and `wallThicknessMm`.

When a wall is thicker than the frame's own depth, a добор (jamb extension)
board is needed to fill the gap — a real, common requirement, not an edge
case. `PriceAgent` parses the frame's depth from its configurator label
(e.g. the trailing "40" in "Массив дерева 2080x75x40") and the extension
each добор option covers (e.g. "100" in "Телескопический 2070x100x16"), then
picks the option whose extension exactly covers `wallThicknessMm - frameDepth`
— falling back to the next size up (and saying so) only when there's no
exact match, and asking a clarifying question when there's no добор option
at all rather than picking one arbitrarily. Verified against a real 140mm
wall: 140 − 40 = 100mm needed, which matched the "2070x100x16" option
exactly.

## Guarding against LLM fabrication

A live test with a real Anthropic key caught `HumanSalesAgent` inventing a
specific frame/casing SKU and price it was never given (a plausible-looking
"Коробка стандартная 2100×70×28, 630 ₽" that wasn't in that turn's grounded
facts at all). The original system prompt's "не выдумывай" instruction
wasn't load-bearing enough on its own. Two changes:

- The system prompt now states explicitly: any price/SKU/model/size named to
  the customer **must** appear verbatim in "Факты для ответа"; if it's
  missing, say so and ask, even if the number "seems typical" — the model is
  told outright that it is not the source of truth, the catalog is.
- `DirectorAgent` now actually calls `PriceAgent`'s kit resolution when the
  customer's message signals wanting a full kit price, so the real
  frame/casing facts are usually present in `groundedContext` for the model
  to cite — before this, "посчитайте комплект" produced grounded context
  with no component data at all, which is exactly when the model started
  inventing one.

Also caught by the same test: `AnthropicProvider` used to return `""`
silently when a response had no text content, which meant one customer
message got no reply and no error, anywhere. It now throws (with the
`stop_reason` and content block types in the message) so a failed turn
surfaces as a real error instead of a silently dropped conversation turn,
and `max_tokens` was raised (1024 → 4096) since a verbose sales reply was
observed hitting the ceiling.

## Recurring pitfall: `\w` and `\b` don't match Cyrillic in JS

Hit twice in this codebase (the catalog covering-keyword matcher, and
`DirectorAgent`'s wall-thickness parser) — `\w` in JavaScript regex is
ASCII-only ([A-Za-z0-9_]), and `\b` is defined in terms of `\w`, so both
silently fail to extend across or bound Cyrillic text. `толщин\w*` matches
only the literal ASCII-free prefix "толщин" (zero extension), and a trailing
`\b` after a Cyrillic unit like "см" never matches at all. Use an explicit
`[а-яё]*` character class for word stems, and a negative lookahead
(`(?![а-яё])`) instead of `\b` to bound a match. If you write a new regex
over Russian text anywhere in this codebase, check for `\w`/`\b` first.

## Where mocks vs. real integrations live

| Concern | Interface | Default (mock) | Real implementation |
|---|---|---|---|
| LLM reasoning | `LlmProvider` | `MockLlmProvider` (echoes input) | `AnthropicProvider` (set `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) |
| Catalog | `CatalogClient` | — | `RfDveriYmlCatalogClient` — **real**, reads the live rf-dveri.ru YML export feed (`CATALOG_FEED_URL`, ~7000 offers), cached on a TTL. See caveats below. |
| Per-door kit options (frame/casing) | `ProductConfiguratorClient` | — | `RfDveriProductConfiguratorClient` — **real**, scrapes a door's own product page for its frame/casing/добор/плинтус configurator options (not in the feed at all). |
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
    exports. This was initially flagged here as unreliable, but checking it
    against the real product pages' visible stock badge
    (`AvailabilityLabelForTheTradeOffer` — text "На складе"/"Под заказ")
    showed it agreeing on every sample checked. **Don't** trust the
    page's `itemprop="availability"` schema.org microdata for this, though —
    it reads `OutOfStock` on every page checked regardless of the real,
    visible badge; it looks like a stale/misconfigured SEO tag on this site,
    unrelated to actual stock.
- Search is in-process token-matching (no external search engine): the query
  is tokenized, matched against a precomputed per-offer haystack
  (name/sku/collection/color/material/covering/vendor/category), and results
  are ranked by token-match count. Good enough for conversational queries at
  ~7000 offers; swap for a real search index if the catalog grows much larger
  or ranking quality needs to improve.
- Frame ("коробка") and casing ("наличник") prices matched to a *specific*
  door are **not in the YML feed at all** — they only exist as that door's
  own product-page configurator (radio inputs with `data-price`, e.g.
  `Коробка: Массив дерева 2080x75x40` → 1315 ₽). Standalone "Комплектующие"
  offers in the feed (generic MDF telescoping frames/casings) are a
  *different, unrelated* product line — verified by comparing a real
  product's page (screenshot-driven) against feed search results, which
  returned the wrong SKUs at the wrong prices. `RfDveriProductConfiguratorClient`
  scrapes a door's own page for its real frame/casing/добор/плинтус options;
  `PriceAgent`'s `kit` input auto-picks the frame when there's exactly one
  option and the cheapest "прямой" (flat/straight) casing — the store's own
  default-casing convention — and turns anything ambiguous (multiple frame
  options, no matching casing) into a clarifying question instead of a guess.
  `PriceAgent`'s `components` input (explicit SKU+quantity) still works for
  cases the configurator doesn't cover.
- The XML parser (`fast-xml-parser`) is configured with `parseTagValue:
  false` deliberately — its default number-coercion silently turned some
  numeric-looking `vendorCode` values into JS numbers, which crashed
  `sku.toLowerCase()` calls at runtime. Only `price`/`categoryId` are
  explicitly `Number()`-converted; everything else stays a string.

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
