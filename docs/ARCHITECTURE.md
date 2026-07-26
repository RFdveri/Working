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
     ключ"/"коробк"/"наличник"/"добор") — or the conversation's persisted
     `orderSpec` (see below) already exists — `PriceAgent` computes a
     `PriceCalculation` for the anchored product, but only once quantity,
     each door group's leaf-vs-opening size, and wall thickness are all
     known; anything missing becomes a clarifying question instead of a
     default/guess. Once known, `{ kit: { frameQuantity, casingQuantity,
     doorQuantity, wallThicknessMm } }` auto-resolves the frame/casing (and
     добор, when the wall is thicker than the frame) from the door's own
     product-page configurator (see "The catalog feed" below) and multiplies
     every per-door quantity by `doorQuantity` so a bulk order is one
     code-computed total, not the LLM doing the multiplication itself. (The
     same `POST /api/conversations/:id/price` endpoint also accepts explicit
     `{ sku, quantity, role }[]` components directly, outside the
     conversational flow.)
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

## Conversation continuity: the order spec

The business owner asked, explicitly: the agent must ask for quantity, each
door's size (leaf *or* opening — and say which), and wall thickness, rather
than silently assuming any of them. `OrderSpec` (`doorGroups: {quantity,
widthMm, widthKind, heightMm?, heightKind?}[]`, `wallThicknessMm`) is tracked
per-conversation exactly like `focusProduct` — parsed and merged every turn
(`ConversationManager.setOrderSpec`), not re-derived from scratch each time.

- `parseDoorGroups()` reads lines like "3 двери 70, 2 двери 80" — a bare
  number after "двер..." is assumed to be centimeters when ≤200, millimeters
  otherwise, and is tagged `leaf`/`opening`/`unspecified` depending on whether
  a "полотно"/"проём" word appears nearby. A group whose kind is
  `unspecified` blocks the kit calculation with a clarifying question — the
  agent will not assume which one the customer meant, since the difference
  is exactly the ~80-100mm margin the standard-size table documents.
- `parseRoomBasedDoorGroups()` handles "3 штуки в жилые комнаты и 2 на
  кухню" — matching room-keyword stems (кладов/санузел·ванн/кухн/жил/гостин)
  against `standard-door-sizes.json`'s leaf sizes — but **only** when the
  customer's text also contains a hand-off phrase ("по стандарту",
  "ориентируйтесь", "стандартный размер"). Without that phrase, a bare room
  mention is something to ask about, not permission to assume a size.
- The kit calculation only runs once `doorGroups` is non-empty, every
  group's size kind is resolved, and `wallThicknessMm` is known; whichever of
  those is still missing becomes the specific clarifying question (not a
  generic "I need more data"). `clarifyingQuestions` is folded into
  `groundedContext` before calling `HumanSalesAgent` — it previously only
  went out on the wire, so the sales reply never actually asked the specific
  thing Director determined was missing, only whatever the model improvised.
- Once `wantsKit` is triggered by keywords once, it stays triggered for the
  rest of the conversation as long as `orderSpec.doorGroups` is non-empty —
  otherwise a later turn that just answers "толщина стены 14см" (no
  "комплект" in it) would skip the kit branch entirely and the calculation
  would never actually run once all the missing pieces arrived.
- Caught by testing: the door-group size regex initially matched "5 дверей:
  **3** штуки в жилые комнаты" as if "3" were a size (→ nonsense 30mm door),
  because a sub-count between two colons/words happened to sit within the
  lazy `\D{0,15}?` gap the regex used to bridge "двери" and a number. Fixed
  with a plausibility filter (300–1500mm) that rejects any parsed width
  outside real door dimensions rather than accepting whatever number was
  nearest.

Verified end to end: "5 дверей: 3 в жилые комнаты, 2 на кухню, ориентируйтесь
по стандарту" correctly resolved to 3×800mm + 2×700mm (leaf, from the
reference table); "толщина стены 14см" three turns later (no kit keywords in
it) still triggered the calculation and produced the same 143,480 ₽ total
verified earlier via the direct `/price` endpoint.

A follow-up test (a different model, "Скай-3" / WanMark) surfaced one more
gap in the same area: a customer answering the leaf-vs-opening question with
just "Это размер полотна" — no numbers repeated — didn't match
`parseDoorGroups` at all, so the answer was silently lost and the group
stayed `unspecified` forever. Fixed with a second, narrower parse: when this
turn introduced no *new* size numbers but the text contains a standalone
"полотно"/"проём" word, that resolves every currently-`unspecified` group in
the existing `orderSpec` instead of waiting for the customer to repeat sizes
that were already given.

## Search ranking: rare words need to outweigh common ones

The same "Скай-3" test also caught a real search-quality bug. A query like
"Посчитайте 3 двери 80 на 200 ... модель скай 3 ... фабрики ванмарк" scores
every candidate by *how many* query tokens its text contains, with no
weighting — so "двери" (in ~3000 offers) counted the same as "скай" (in 32
offers), and the specific model didn't even make the top 20 results, ranking
below dozens of unrelated products that happened to share more of the
generic words.

- `RfDveriYmlCatalogClient.search()` now weights each matching token by
  `1/documentFrequency` (computed over the candidate set per search — cheap
  at ~7000 offers) instead of counting matches flatly, so a rare, specific
  token like a model name or vendor counts far more than a common one.
- That alone wasn't enough: "модель" (how customers say "the model is X") is
  rare enough in the catalog to score highly on its own — except several
  unrelated product lines are literally *named* "Модель 33.24 ...", so it
  coincidentally tied a generic instruction word with an unrelated product
  family. Added to the search stopword list, since it's never itself a
  distinguishing search term.
- The result window was widened 20 → 30 for headroom, since `DirectorAgent`'s
  explicit-name-match check (see above) only ever scans within what
  `SearchAgent` actually returns.
- `mentionsProductByName()`'s matching also needed two fixes surfaced by the
  same test: it compared strings directly, so "Скай-3" (hyphenated in the
  catalog) never matched a customer typing "скай 3" (space); and its 5-letter
  minimum excluded legitimately short model names like "Скай" (4 letters).
  Now compares with spaces/hyphens stripped and a 4-letter minimum. When a
  model has both ПГ (blind) and ПО (glazed) variants that both match the same
  name, "глухая"/"остеклённая" wording (when present) picks the right one
  instead of whichever ranks first.

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
| Standard door leaf/opening sizes | — | `config/standard-door-sizes.json`, loaded by `DoorSizeReference` — **real data**, given by the business owner. Advice-only: informs what the agent recommends/asks, never overrides a size the customer stated. |
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
- Task tracking (`TaskAgent`) delegates straight to AmoCRM's own tasks API —
  there's no local task store to persist.

## Persistence: SQLite via `node:sqlite`

Conversations, messages, agent logs, and customer memory are stored in a
single SQLite file (`core/persistence/Database.ts`), not in memory. This
replaced the original `InMemoryMemoryStore`/in-memory `ConversationManager`,
which lost all state on every process restart — a real problem during
testing (a server crash mid-conversation meant replaying the whole message
history by hand) and a blocker for production (any redeploy would wipe every
open conversation).

- Uses Node's **built-in** `node:sqlite` (`DatabaseSync`, stable since Node
  22.5, still flagged experimental — hence the startup warning) rather than
  `better-sqlite3` or a Postgres driver. That means zero native dependencies:
  `npm install` never needs a C++ toolchain, which matters both for
  constrained deploy targets and for someone self-hosting this on their own
  machine (see "Local install" below).
- `DATABASE_PATH` (default `./data/app.db`) controls the file location — set
  it to an absolute path in production so it survives working-directory
  changes across redeploys. WAL mode is enabled for concurrent read/write
  safety.
- `ConversationManager` and `SqliteMemoryStore` keep the exact same public
  method signatures the old in-memory versions had (`create`, `get`,
  `appendMessage`, `setFocusProduct`, `setOrderSpec`, etc.) — routes
  (`api/routes/widget.ts`, `api/routes/amocrm.ts`) didn't need to change.
- This is a single-file, single-process store — correct for one backend
  instance, not for horizontally-scaled multi-instance deploys (SQLite
  doesn't arbitrate concurrent writers across machines). If you outgrow a
  single instance, swap `Database.ts` for a Postgres pool behind the same
  `ConversationManager`/`MemoryStore` interfaces; nothing else in the
  codebase needs to know.
- Verified by killing and restarting the backend process mid-conversation
  and confirming `GET /api/conversations/:id` still returns the full message
  history afterward.

## Running this yourself without the AmoCRM Marketplace

You don't need a Marketplace listing to use this. Two ways to run it against
your own AmoCRM account:

- **Local install (fastest to test)**: run `services/backend` on your own
  machine (or a small VPS) with a real `.env` (Anthropic key, catalog feed
  URL), expose it via a tunnel (e.g. `ngrok http 4000`) for a public HTTPS
  URL AmoCRM can reach, then upload the zipped `apps/widget/amocrm/` package
  as a **private integration** in your AmoCRM account (Настройки →
  Интеграции → Мои интеграции) — no Marketplace review needed for this. Set
  the widget's `backend_base_url` setting to your tunnel URL.
- **Real deploy**: same widget package, but `services/backend` runs on
  persistent hosting (VPS/Render/Railway/etc.) with a stable domain instead
  of a tunnel, and `DATABASE_PATH` points at a persistent disk/volume so the
  SQLite file isn't lost on redeploy.

Either way you still need: an AmoCRM OAuth integration (`AMOCRM_CLIENT_ID`/
`AMOCRM_CLIENT_SECRET`, redirect URL `BASE_URL/api/amocrm/oauth/callback`)
registered in your AmoCRM account, and a production `ANTHROPIC_API_KEY`.
Marketplace submission (logo, screenshots, public listing) is a separate,
optional step only needed if you want other AmoCRM accounts to install it.
