# Packaging for the AmoCRM Marketplace

This project ships two things AmoCRM needs kept separate:

1. **The backend service** (`services/backend`) — hosts the multi-agent API and
   must be deployed somewhere with a public HTTPS URL (`BASE_URL`).
2. **The widget frontend** (`apps/widget`) — a React SPA built with `npm run build
   -w apps/widget`, deployed as static files at, e.g., `BASE_URL/widget/`.
3. **The AmoCRM widget package** (`apps/widget/amocrm/`) — the small bootstrap
   AmoCRM itself loads into the CRM UI, which in turn embeds the SPA above in
   an iframe.

## Package contents

```
amocrm/
  manifest.json   # widget metadata + settings form (backend_base_url)
  script.js       # AmoCRM widget SDK bootstrap — mounts the iframe
  i18n/
    ru.json
    en.json
  images/         # add logo.png (182x182) and screenshots before submitting
```

To submit to the Marketplace, zip the contents of `amocrm/` (not the folder
itself) and upload through the AmoCRM developer account
(amocrm.ru → Настройки → Интеграции → Мои интеграции → создать виджет).

## Before submitting, verify against current AmoCRM docs

`manifest.json` and `script.js` follow the general shape of AmoCRM's classic
widget SDK (a `widget` metadata block, a `settings_template` form, and a
`callbacks` object with `render`/`init`/`bind_actions`/`settings`/`destroy`).
AmoCRM has changed this API across CRM platform versions, so before
submission:

- Confirm the exact `locations` values accepted today (lead card, contact
  card, etc.) in the AmoCRM widget SDK reference.
- Confirm the widget SDK global (`define(["jquery"], ...)` vs. a different
  loader) matches what the current Marketplace expects.
- Add a real logo (`images/logo.png`) and at least one screenshot — the
  Marketplace review rejects submissions without them.
- Fill in vendor/support contact details required by the Marketplace listing
  form (not part of this repo, entered in the developer portal itself).

## OAuth integration (for the CRM Agent's API calls)

Separately from the widget package, register an AmoCRM **OAuth integration**
(amocrm.ru → Настройки → Интеграции → Создать интеграцию) to get
`AMOCRM_CLIENT_ID` / `AMOCRM_CLIENT_SECRET`, and set its redirect URL to
`BASE_URL/api/amocrm/oauth/callback`. This is what `services/backend`'s
`AmoCrmClient` uses for deals/contacts/notes/tasks/Digital Pipeline calls —
independent of the widget package above.
