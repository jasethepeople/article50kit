# Article50Kit

Article50Kit is an early-access developer service for implementing AI interaction disclosures, recording disclosure receipts, signing supported media with C2PA manifests, and exporting hash-linked evidence packs. It is technical infrastructure—not a legal compliance certification or legal advice.

## Current status

The web app, account console, REST API, JavaScript client, React disclosure component, C2PA media-signing path, and PDF evidence export are implemented and locally tested. The project is **not yet ready to sell as a live production service**: Stripe has not been connected, the operator must supply a production C2PA signing identity, legal/operator details need review, and the npm packages have not been published. Account email verification and password recovery are also not implemented; the UI identifies the service as early access.

## Project layout

- `server.ts` — Hono/Vite server and SPA fallback.
- `backend-lib/api.ts` — account/session routes, API key management, Stripe Checkout/webhook, usage limits, public REST API.
- `backend-lib/core.ts` — canonical JSON and SHA-256 helpers.
- `backend-lib/audit.ts` — hash-chain verification for received events.
- `backend-lib/c2pa.ts` — C2PA signing for JPEG and PNG files (8 MiB maximum).
- `backend-lib/evidence.ts` — Unicode-capable PDF evidence pack generation.
- `packages/js/` — source and package metadata for `@article50kit/js`.
- `packages/react/` — `DisclosureNotice` React component source.
- `src/pages/` — marketing page, workspace console, API docs, draft terms and privacy notices.
- `tests/` — API, SDK, audit-chain, PDF, and C2PA tests. The C2PA test credentials in `tests/fixtures/certs/` are public, test-only credentials; never use them for production signing.

Runtime SQLite data is kept in `data/article50kit.sqlite` by default and is excluded from version control. Set `DATABASE_PATH` to change the path.

## Development and checks

```bash
bun run dev
bun run check
bun run build
bun run build:sdk
```

`bun run check` runs strict TypeScript checking and the Bun test suite. `bun run build` creates the production Vite build. `bun run build:sdk` builds the JavaScript and React package distributions locally; publishing either package to npm still requires the operator's npm account, namespace, and license decision.

## REST API

API base: the deployed Article50Kit origin plus `/v1`.

- `GET /v1/health` — unauthenticated service health and C2PA credential status.
- `POST /v1/events` — records a disclosure receipt; accepts a publishable or secret API key.
- `GET /v1/events` — lists records; requires a secret API key.
- `POST /v1/mark` — signs JPEG/PNG media with C2PA; requires a secret key and configured signing credential.
- `POST /v1/evidence-packs` — returns a PDF for the key's workspace; requires a secret key.

Send keys as `Authorization: Bearer <key>` (or `X-API-Key`). Browser origins are checked against each key's allowed origins. Publishable keys are for browser event writes; keep secret keys server-side. Event records contain the submitted disclosure text and related metadata—do not send chat transcripts or unnecessary personal data.

The account console uses `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/events`, `POST /api/evidence-pack`, `/api/keys`, `/api/billing/checkout`, and `/api/billing/portal`. Account deletion is `DELETE /api/account` and requires the account password.

## Operator configuration

Set secrets in the hosting environment, not source files:

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` — enable monthly checkout and signed webhook handling. Configure the Stripe endpoint at `/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
- `C2PA_CERT_PEM` and `C2PA_PRIVATE_KEY_PEM` — production C2PA certificate chain and matching private key. The private key must be an appropriate issuer-issued C2PA signing credential. A self-signed credential or the included test key is not a production identity.
- `PUBLIC_APP_URL` — trusted HTTPS origin used for Stripe return URLs; set this to the final product origin.
- `DATABASE_PATH` — optional SQLite file location.

The published plans are $29 / $79 / $199 monthly. Checkout is deliberately disabled until both Stripe secrets are present. Configure cancellation and payment-method settings in Stripe's customer portal before accepting customers.

## Legal and product boundaries

Article 50 contains separate duties for certain AI-system providers and deployers; it does not require every SaaS chatbot to display identical wording, nor does it name C2PA as the required format. Article50Kit records what an integration reports; it cannot independently prove a notice rendered, establish legal compliance, or guarantee that a recipient trusts a C2PA signature. Its C2PA endpoint covers supported JPEG/PNG media, not every form of AI output. Review the current regulation and obtain qualified legal advice for each deployment.

The €35 million / 7% headline penalty is tied to prohibited AI practices, not a general fine for every Article 50 transparency failure; other obligations have a separate penalty tier. See the regulation's Articles 50 and 99 and the European Commission's AI Act guidance before making legal claims in marketing.

The Terms and Privacy pages are launch drafts. Before public commercial launch, identify the legal operator and contact address, review lawful basis/retention and data-processing terms, complete the subprocessor list and DPA as needed, and verify all marketing statements.
