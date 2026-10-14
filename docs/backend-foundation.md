# HOVERGHINI Phase 1 backend foundation

## Scope and current behaviour

The game still runs offline with its existing local economy. Phase 1 adds a persistent account, manual cloud backup/restore of legacy progress, and a **separate server-authoritative global wallet**. It does not make existing courier rewards, trading, purchases, test money or property income authoritative. None of that client state can credit the global wallet. The global wallet starts at zero and has no public mutation endpoint or gameplay reward producer yet.

Accounts use GitHub OAuth as the initial provider. No repository or email scope is requested. GitHub's immutable numeric subject maps to a provider-independent UUID, so account names, devices, cities and PartyKit connections do not define identity. Other providers can be added through the identities table later; automatic account linking by email is deliberately absent.

### Audit of the starting repository

| Area | Existing implementation | Phase 1 treatment |
| --- | --- | --- |
| Game | Vite, TypeScript, Three.js; real map tiles with procedural fallback | Preserved; added account panel on title and More menu |
| Saves | `hoverghini.save.v1` in localStorage; `Game.persist()` and `loadSave()` | Key/format retained; validated legacy cloud snapshots, manual synchronization |
| Currency | Direct client writes throughout `src/game.ts`, including debug funds, vaults, dealers, income | Remains local sandbox progress; never used as global wallet authority |
| Cloudflare | Read-only API, D1 schema scaffold, geocoder Durable Object, example Wrangler file | Existing reads/DO retained; additive migrations, account routes, assets hosting, scheduled cleanup |
| Multiplayer | PartyKit tile/crew-name rooms; ephemeral client UUIDs; bounded telemetry relay | Untouched. Self-asserted positions and peer IDs are not identity, rewards or ownership evidence |
| Ownership/records | Sparse table scaffolds and read routes; no authenticated writes | Preserved. Existing records are not retroactively certified or linked to new accounts |
| Deployment | GitHub Pages client workflow; backend not provisioned in repository | Existing Pages workflow retained; opt-in Cloudflare deployment configuration/workflow |
| Tests | Node/tsx unit tests and Playwright gameplay smoke scripts | Added real local D1 tests plus client failure/recovery tests |

No Cloudflare account, live database contents, deployed Worker settings or production secrets were available for inspection. Repository configuration is not evidence of a live deployment.

## Architecture and trust boundary

Cloudflare Worker serves built static assets and `/api/*` on **one HTTPS origin**. D1 holds identity, sessions, legacy saves, retry receipts and wallets. The existing geocoder Durable Object stays separate. GitHub remains the source repository. No new runtime package is required: auth uses fetch and Web Crypto; SQL uses D1 bindings. Pinned Wrangler and Miniflare are development/deployment dependencies (the locked Wrangler release currently depends on Miniflare 5 beta).

The browser can write only its authenticated player's validated `legacy_saves` payload. These are explicitly untrusted backups, even after loading from D1. They must never be used for global unlocks, inventory, trade settlement, ownership, territory strength or rewards. A new authoritative save domain can be added later without changing legacy progress. Location and safehouse data in a backup are private to that player; do not expose backups in public APIs.

D1 operations currently use the primary database; do not introduce replica reads in transactional decisions without reviewing session/bookmark consistency. Geographic sessions must never own independent copies of balances or property titles.

## HTTP contract

All account routes require `BACKEND_ENABLED=true` and the exact configured `APP_ORIGIN`. Wrong deployment hosts fail closed. Writes also require an exact matching `Origin` header. Account responses include a correlation `X-Request-ID` and are `no-store`, `nosniff`, `no-referrer` and do not enable credentialed CORS. Cross-origin static clients can still use existing public map/radio reads, but not account APIs.

| Route | Method | Behaviour |
| --- | --- | --- |
| `/api/auth/login` | GET | GitHub redirect with random browser-bound state and S256 PKCE; 10-minute attempt |
| `/api/auth/callback` | GET | Single-use state consumption, server code exchange and `/user` verification; fixed redirect home |
| `/api/me` | GET | Stable player UUID and explicit save/wallet modes |
| `/api/auth/logout` | POST | Revoke current session and expire cookie |
| `/api/auth/logout-all` | POST | Revoke every session for the player |
| `/api/save` | GET | `{playerId,schemaVersion:1,mode:"legacy-local",revision,payload,updatedAt}` |
| `/api/save` | PUT | `{playerId,schemaVersion:1,expectedRevision,requestId,payload}` |
| `/api/wallet` | GET | `{playerId,currency:"HG",unit:"minor",balance,version}` |

PUT requires a 16–80 character alphanumeric/underscore/hyphen request ID (UUID accepted), matching player ID and current revision. A matching retry returns the original accepted revision even if later saves exist. A reused ID with different data or a stale revision gives 409. The route rejects unknown top-level fields and future schemas. Actual streamed bodies are capped at 128 KiB, independent of Content-Length; nested content is bounded and validated on both server and restore client.

401 means sign in again; 403 is an origin rejection; 409 requires explicit conflict resolution; 413 is too large; 429 has `Retry-After: 60`; 503 leaves local progress/outbox intact. Authentication/provider failures require starting sign-in again; callbacks cannot be replayed.

Sessions use 256-bit opaque secrets in `__Host-hg_session` cookies (`HttpOnly; Secure; SameSite=Lax; Path=/`). Only SHA-256 hashes are stored; expiry is 30 days, with no implicit sliding extension. Provider access tokens are used only during verification and never persisted or exposed to the browser. Recovery uses the same GitHub account; lost GitHub access is recovered through GitHub. There is no admin impersonation, password database or unsafe email-based merge.

The application limits login/callback attempts to 20/minute per hashed Cloudflare-supplied IP and authenticated account requests to 120/minute/player. Cron removes expired sessions, OAuth attempts and rate buckets in bounded batches every 15 minutes. This is an application backstop, not volumetric DDoS protection; configure Cloudflare edge protections before a public launch. Save retry receipts and the wallet ledger intentionally do not expire.

## Atomicity and currency

`server/wallet.ts::transactWallet` is server-only. It accepts a **trusted domain operation**, not browser input. There is no HTTP/admin-secret shortcut to this function. A future producer must validate the event, derive reward/price server-side, and supply a stable event-specific operation ID. Never forward a client-selected delta, reason, receipt or request ID as evidence of earning.

All amounts are integer minor units (100 = 1 HG). Balances and deltas are bounded to 9,000,000,000,000 minor units. Negative balances, overflow and fractional/invalid amounts fail. `(player_id,operation_id)` is unique; replay with identical delta/reason returns the original resulting balance/version, while a different operation with that key fails.

A ledger insertion computes the new balance from the current wallet row. Its SQL trigger updates that wallet with matching prior version and balance in the same SQLite statement. Constraint/trigger failure rolls back both. D1 batch returns the resulting receipt atomically. Concurrent debits cannot both spend the same balance. Ledger update/delete triggers prevent accidental mutation; corrections must be compensating entries with new IDs. D1 administrators remain trusted and can alter schemas, so restrict database credentials. Future multi-player settlement must atomically include both ledger legs and asset mutation in one D1 transaction, not two calls to this helper.

Save update and retry receipt are one D1 batch with compare-and-swap revision checking. Failure after receipt insertion rolls back the receipt. No client-side read/modify/write is used as a concurrency lock.

## Safe local-save migration and recovery

1. Deploy a staging host first. Preserve the existing public game origin on final cutover when possible: localStorage is origin-bound. A different host cannot see the old host's save. Keep the old host available until players have backed up or moved their save; never claim an automatic cross-origin migration.
2. On the existing origin, the original game/save remains playable. Account sign-in does not upload or overwrite progress. Select **Account & cloud saves → Check account / refresh**.
3. Choose **Back up this device**. The first backup starts at revision 0. Replacing an existing cloud snapshot requires confirmation. Global currency remains zero unless trusted server operations already exist for that account.
4. Before sending, the client persists a player-scoped outbox with the exact payload, revision and request ID. An offline error or lost response leaves it available after reload. **Retry interrupted upload** sends that exact operation. Switching accounts cannot replay it into another player, including a cookie switch between requests (server checks payload player ID).
5. On conflict, preserve local progress and the pending upload. Refresh to inspect the cloud revision/city, then explicitly discard the pending upload if choosing to replace the cloud with local progress. Discard does not undo an already accepted server request. No automatic last-write-wins merging.
6. Restore rechecks account/revision and payload, then saves the existing local save under `hoverghini.save.before-cloud.v1` before replacing the active key. If the backup write fails, restore aborts. **Recover pre-restore local backup** restores that copy without removing it. Only one pre-restore backup is retained; export it before repeated restores if needed.
7. New Game / Reset changes local progress only. It does not erase the cloud, revoke identity or clear an interrupted upload. Backups are manual and clearly labelled; there is no claim of automatic cloud synchronization.

For a domain change before account enablement, users must carry their local save from the old origin (browser storage export) or the operator should keep the original origin and move its hosting. Do not read another origin's browser storage or silently import balances into the global wallet.

## Schema evolution for the future (design only)

Applied Phase 1 tables: `players`, `identities`, `sessions`, `oauth_attempts`, `request_limits`, `legacy_saves`, `save_receipts`, `wallets`, `wallet_ledger`. Migration 0000 only reproduces the **existing** ownership/dead-drop/speed-record/flashpoint scaffold with `IF NOT EXISTS`; migration 0001 adds the foundation. Inspect any pre-existing database for divergent table definitions before applying.

The following is a proposed model, not deployed tables or enabled features:

| Future entity | Proposed key / relationships | Required invariants |
| --- | --- | --- |
| Map feature identity | `(provider,source_type,source_id)` plus geometry revision; canonical `building_id` and alias mapping | Do not use tile number or geometry hash alone as title identity; deduplicate cross-tile and changed map representations |
| Property title | `building_id` PK; `owner_player_id` FK or `owner_crew_id` FK, exactly one; version, spatial index | One global title; ownership transfer and currency settlement atomic; no local-save ownership imports |
| Crew | UUID PK, founder/player FK, version | Stable identity independent of display name or room hash |
| Crew membership | `(crew_id,player_id)` PK, role, joined_at | Explicit server-checked permissions; one-crew constraint only if gameplay adopts it |
| Territory | UUID PK, canonical boundary/region key, version | Geometry and geographic indexing versioned independently of ownership |
| Territory control | `territory_id` PK, crew FK, version, settled event | Competition rules validated server-side; no client telemetry as proof |
| Market and item | Stable market/item IDs, regional index; `(market_id,item_id)` quote/version | Quotes and stock server-owned, price units integer |
| Market order / settlement | Unique order ID, player FK, item FK, expiry, quote version, transaction group ID | Atomic inventory+wallet settlement, idempotent fulfilment, bounded quantities |

Keep authoritative shared state in the single registry initially. Sparse claimed-feature storage avoids importing the entire world map. Future geographic Durable Objects can coordinate nearby simulations, but D1 remains the source for identity/title/settlement. Global write throughput and hot markets require measurement before selecting any sharding model. Legacy schema rows need a verified reconciliation/backfill before foreign keys or global claims are enabled.

## Configuration and deployment

Node 24 is used by CI. `npm ci` installs the pinned toolchain. No cloud resource is provisioned by install/build/tests.

| Setting | Where | Purpose |
| --- | --- | --- |
| `APP_ORIGIN` | Worker variable | Exact HTTPS origin, no trailing slash/path; game and account API share it |
| `BACKEND_ENABLED` | Worker variable | `false` by default; `true` after binding/configuration checks |
| `GITHUB_CLIENT_ID` | Worker variable | Separate OAuth app per staging/production |
| `GITHUB_CLIENT_SECRET` | Worker secret | OAuth code exchange; never a VITE variable or committed file |
| `DB` | D1 binding | One global registry database per environment; real database ID required |
| `GEOCODER` | Durable Object binding | Existing geocoder class, migration tag `v1` retained |
| `ASSETS` | Static assets binding | Built `dist`, routes `/api/*` to Worker first |
| `ALLOWED_ORIGIN` | Worker variable | Existing public read CORS origin; not used to enable credentialed CORS |
| `APP_CONTACT`, `NOMINATIM_URL` | Worker variables | Existing geocoder identification and provider |
| `RADIO_CONFIG_JSON` | Worker variable | Existing public station config |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Local environment / GitHub environment secrets | Deployment only; use least privileges for selected Worker, D1, assets and DO migration |

`VITE_API_BASE` and `VITE_PARTYKIT_HOST` remain optional for the pre-existing read gateway/telemetry. Cloud accounts intentionally use relative `/api` paths and cannot be redirected to an arbitrary credentialed cross-origin host. Do not set any secret in `VITE_*`, `public/config.json` or static assets.

### First staging deployment

```sh
npm ci
cp wrangler.example.toml wrangler.toml
npx wrangler login
npx wrangler d1 create hoverghini-staging
```

Set a distinct staging Worker name, returned D1 ID/name, `APP_ORIGIN`, `ALLOWED_ORIGIN`, contact and GitHub client ID in ignored `wrangler.toml`. Register an OAuth app with callback **exactly** `https://YOUR-STAGING-HOST/api/auth/callback`, homepage your game origin. Set its secret:

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.toml
npm run migrate:local
npm run migrate:remote
npm test
npm run check:server
npm run check:cloud
npm run test:browser
```

Before setting `BACKEND_ENABLED=true`, verify the database migrations and correct OAuth app/origin, then:

```sh
npm run deploy:cloud
```

The template defaults accounts off. The deployment serves the game and API together; the returned workers.dev hostname or configured custom domain must match `APP_ORIGIN`. If the host is unknown initially, deploy with accounts off, register the assigned host and OAuth callback, then enable/redeploy. For local OAuth development use HTTPS (`npm run dev:cloud`), `https://localhost:8787` as origin and a separate development OAuth app/secret in ignored `.dev.vars`; trust the local development certificate. Auth has no insecure cookie bypass. Unit/integration tests do not need OAuth credentials.

### Production promotion and optional Actions workflow

Use a separate production Worker, D1 database and OAuth app. Back up an existing D1 database before migrations (`wrangler d1 export DB --remote --output=<secure-file>`). Confirm its existing scaffold matches `server/schema.sql`; additive `IF NOT EXISTS` is not schema reconciliation. Do not run deployment against a guessed account/database.

The manual `cloudflare.yml` workflow uses the selected GitHub environment (`staging` or `production`). Configure environment secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; environment variables `CF_WORKER_NAME`, `CF_DATABASE_ID`, `CF_DATABASE_NAME`, `APP_ORIGIN`, `GITHUB_CLIENT_ID`, `APP_CONTACT`. Provision the OAuth Worker secret **before** this workflow. GitHub environment protection can gate production. The workflow validates inputs, tests, builds, applies additive migrations and deploys. It does not alter DNS or disable GitHub Pages.

The GitHub Pages deployment stays intact while staging is verified. For final same-origin cutover, configure the existing game domain on the production Worker in Cloudflare, verify `/api` and assets reach it, and update DNS only after staging acceptance. Retain the old Pages deployment for rollback. Do not run both hosts as independently authoritative economies; both environments are intentionally separate.

### Live acceptance and rollback

Run real GitHub sign-in in two browsers/devices, verify the same player UUID, backup/restore progress, logout-all, session expiry, empty global wallet and refusal of public wallet writes. Verify a deliberate stale save produces 409 and an interrupted upload can retry. Check existing geocode/radio reads and gameplay. Real provider/cookie/custom-domain flows require operator staging acceptance; local tests mock only the external GitHub responses.

If backend health fails, set `BACKEND_ENABLED=false` and redeploy; offline play and local saves remain. Roll back the Worker bundle without dropping D1 tables. Keep migration history additive. D1 Time Travel/export is an operator disaster-recovery option, not an automatic per-player restore. After restoring an older database, revoke sessions and assess replays before reopening writes: retry receipts and ledger history must be restored consistently. Never delete receipts to “fix” a conflict.

Monitor Worker errors, D1 latency/failures, 401/409/429/503 rates and storage growth. Do not log cookie values, OAuth codes, tokens or save payloads. Manage retention/account deletion before public launch; the append-only ledger needs an explicit accounting/pseudonymisation policy rather than casual cascading deletes.

## Verification and remaining gates

Run `npm test`, `npm run check:server`, `npm run check:cloud`, and `npm run test:browser`. Backend tests execute the actual migrations/triggers with Miniflare D1 rather than a mocked SQL interpreter. They cover stable identity, auth rejection/revocation, OAuth state/PKCE/replay/provider outage, cross-account/CSRF checks, persistence, concurrent saves/debits, immutable ledger, idempotency mismatch, malformed/oversized saves, injected transaction failure, and retry recovery. Client tests cover durable outbox, conflicts, storage exhaustion, account switches and restore backup safety.

Remaining deployment gates: real Cloudflare resources/secrets, real OAuth app, staging provider/cookie test, database audit if an existing DB is reused, custom-domain cutover and operator monitoring/retention choices. The repository alone cannot verify these.

Explicitly deferred: authoritative gameplay reward validation and spending integration, live authenticated geographic sessions, persistent crews, global property claims/transfers, territories, markets, trading, payments and monetisation. No Phase 2 feature is enabled.

Primary implementation references: [D1 transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [GitHub OAuth authorization and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
