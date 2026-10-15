# Phase 5 — Global underground economy

## Player flow

Sign in, enter a real-world city and go online. Open **More → Global freight markets**. The board shows three fictional commodities (Glimmer crystals, Ghostware chips and Nightbloom extract), local and neighbouring prices, stock, incoming consignments, shortages and price direction. Choose a neighbouring destination and commodity; request a quote, follow its source-depot waypoint and load within 100 metres. Quotes expire after 60 seconds: get another at the depot if necessary.

Freight assist follows an OSM road route using your customized hovercar. GO and BRAKE control speed; steering changes lanes. Follow the displayed alternating lane gates. Passing a gate too fast outside its lane damages cargo; slow below 8 m/s for a safe pass. Three damaged gates destroy the shipment. Reaching the destination settles the consignment and global wallet automatically. Local cash, cargo, jobs and saves remain separate.

Deliveries are protected by default. A crew member can opt a shipment into rival interception. Rival crew members see competitive convoys on the local board and can track one, approach within 200 metres and pay a nonrefundable 25 HG challenge fee. Admission is open between 25% and 85% route progress. The pursuer starts 60 metres behind and must catch within 12 metres, match lanes within 1.5 metres and hold for three seconds with both drivers connected. Successful disruption destroys cargo and raises destination demand pressure. It gives the interceptor no cargo or currency. One pursuer per consignment, two challenges per account per rolling day; a challenge occupies that account until the convoy settles. It cannot cancel someone else's consignment.

After refresh, return to the shipment's city, reconnect and choose **Resume online driving**. Server progress persists; offline time never advances travel. A carrier can cancel. Cancellation or deadline expiry before 25% restores source inventory; after departure it destroys cargo and increases destination pressure. No failed shipment pays. Gate damage always destroys cargo. Deadlines are 15 minutes, or 17 with eligible HQ support.

## Markets and utility

The existing versioned `d1:row:column` grid supplies worldwide identity. Only accessed districts are materialized; a board reads the current district and four neighbours. Three commodity rows per district use deterministic geographic baselines and a local price multiplier. Supply reduces price; shortages increase it. Price bounds are 0.5–2.5 times the geographically adjusted base. Prices are game values, not real-estate or real-world contraband prices.

On access, each elapsed hour moves stock two units toward its baseline and reduces shortage pressure by one, capped at 24 hours of adjustment per access; the clock advances fully so repeated requests cannot repeatedly collect missed-time production. Stock plus reserved incoming capacity never exceeds 500. Successful freight removes source goods and replenishes the destination; lost freight adds demand pressure. A change from a live rival territory controller adds two pressure once to already materialized markets. No continuous world simulation or global broadcast runs. Visible boards refresh every ten seconds; another geographic session reads the same D1 state.

An active owned source property of at least 150 square metres gives warehouse capacity of six units instead of four. An owned destination building supplies a one-percentage-point fee rebate; live crew control at either endpoint supplies two points. An eligible member-owned crew HQ at either endpoint adds two minutes to the deadline. These are bounded logistical benefits, not passive income or property transfers. Ownership survives every market and territory change. This first implementation uses size/location eligibility rather than installing warehouse upgrades or introducing business management.

## Currency and atomicity

Migration `0005_underground_economy.sql` creates a **one-time 1,000,000 HG global freight reserve**, tracked in integer minor units (100 per HG). It never automatically refills. Admission reserves the full gross reward, source stock and destination capacity in one D1 transaction. Delivery atomically inserts the immutable event and wallet ledger entry, adds destination stock, releases capacity and moves reserve to paid currency plus burned fees. Failure returns the escrow to available funds. The invariant is `available + reserved + paid + burned = 100000000` minor units. Interception fees are separate wallet sinks.

Six admitted consignments per account per rolling 24 hours, gross rewards of 20–200 HG, a 12% standard fee and minimum 9% fee cap earnings at 1,092 HG/day/account. Cancellation consumes an admission allowance. An account may participate in only one active consignment as carrier or interceptor. Empty funding halts new admission. There is no personal commodity inventory to duplicate, free-form sale, arbitrary price setting or player trading.

The sealed-consignment design deliberately does not require purchasing cargo first. New accounts can earn global funds without importing local balances. Coordinated deliveries affect actual bounded stock; crews cannot submit prices. The finite reserve, sinks and daily limits contain farming but do not solve bots or multi-account abuse. Production rollout needs telemetry and an explicit, reviewed reserve policy; do not silently reset the fund or delete receipts.

A server quote fixes prices, route, capacity, benefits and net reward. Admission checks both market revisions, source stock, destination capacity, account, current warehouse ownership and crew membership generation. Quotes are short-lived contractual offers; the small fee/HQ benefits are fixed when quoted. UUID load requests have immutable per-account receipts. The client writes its account-bound request to local storage before submitting and retries the same key after unknown failure. Storage failure prevents submission. Concurrent loads for the last cargo/capacity admit one; the other reserves nothing. Concurrent or repeated settlement cannot credit twice. D1 failure rolls back the entire event, stock and wallet operation.

## Movement authority and recovery

One private `Freight` Durable Object serializes each active shipment and persists its course and vehicle states. Existing authenticated `PlayerSession` sockets forward four input commands per second containing only monotonic sequence, throttle and steering. The server supplies identity and elapsed time. Arbitrary poses, scores, elapsed time and completion requests cannot pay freight. Normal movement continues at ten Hz for geographic visibility; authoritative freight positions replace its horizontal movement during a consignment. No competing identity system or extra public socket is introduced.

The server advances a constrained 32 m/s road-following vehicle, with lane gates, braking and damage. Per-command simulation is capped at 300 ms; stale controls brake after 700 ms. Client prediction is capped at 500 ms with reconciliation. Freight processing is asynchronous outside the rendering path. Clients retain local terrain height for visual alignment; the server does not simulate terrain, traffic collisions or general free-roaming physics. Bridge/terrain visuals require staging inspection. Automated input remains possible, but cannot invent extra time, inventory or rewards.

A terminal D1 event is authoritative even if the following actor storage write fails. Reads and retry recover that event. Interceptor fee receipts persist the starting pursuit position so a lost response cannot recharge or improve the starting position. Current rival membership generations are checked again at interception settlement. Alarms recover deadlines; the existing scheduled Worker also visits up to 100 expired active shipments per run, including admissions whose initial actor setup failed. It removes up to 500 expired unused quotes older than a day; referenced quotes and financial receipts are retained.

Routes come from the existing private OSM provider through a separate freight cache. A bounded graph follows shared OSM node IDs, rejects private/no-access ways, one-way roads and roundabouts, and finds a connected road between neighbouring district depots. Limits: 4,000 ways, 12,000 nodes, 256 selected points, 300–6,000 metre routes and a 3.5 km source query radius. Missing or unsupported roads fail closed. No city boundary is hardcoded. Polar/property-provider coverage limits from Phase 3 still apply.

## Configuration and deployment

This is stacked on Phases 1–4. Merge/deploy those prerequisites first; retain their OAuth configuration, database and Durable Object migration history. No new dependency or secret is required.

1. Back up D1. Review the one-time reserve and staging limits before applying migration 0005. On a fresh database apply 0000–0005 in order. Do not replay seed SQL manually.
2. Add `FREIGHT` binding, class `Freight`, and appended `v5-economy` migration from `wrangler.example.toml`. Keep all previous migration tags and bindings unchanged.
3. Retain `APP_ORIGIN`, `GITHUB_CLIENT_ID`, secret `GITHUB_CLIENT_SECRET`, `APP_CONTACT`, HTTPS `PROPERTY_SOURCE_URL`, and optional secret `PROPERTY_SOURCE_TOKEN`. The provider must support the expanded roads query. Tokens stay in Worker secrets; redirects fail closed.
4. Set `ECONOMY_ENABLED="true"` only when `BACKEND_ENABLED`, `MULTIPLAYER_ENABLED`, `PROPERTIES_ENABLED` and `CREWS_ENABLED` are also true. Default is false. The existing manual GitHub Cloudflare workflow accepts the economy environment variable and applies migrations before deployment.
5. Deployment credentials are still `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Configure these as GitHub environment secrets, never client variables. The config renderer uses the existing `CF_WORKER_NAME`, `CF_DATABASE_ID`, `CF_DATABASE_NAME`, origin and OAuth variables.

```sh
npm ci
npm test
npm run check:server
npm run balance:economy
npm run build
npx playwright install chromium --only-shell
npm run test:browser
node scripts/configure-cloud.mjs
npx wrangler deploy --config wrangler.toml --dry-run
npm run migrate:remote
npx wrangler deploy --config wrangler.toml
```

Disable `ECONOMY_ENABLED` to stop new public activity and freight forwarding without deleting persistence. Existing alarms can still close admitted shipments; this is an availability switch, not a financial rollback. Preserve bindings and tables. Investigate/reconcile an accounting incident using immutable receipts before any operator repair.

## Validation and operating limits

`npm run test:economy` covers concurrency, wallet rollback, exact retries, identity, malicious input, offline time, interception, service restart, property benefits, deadlines and an actual compiled Worker/WebSocket freight delivery. `tests/economy.cjs` covers mocked desktop/mobile board, load and recovery UI. `npm run balance:economy` checks geographic price extrema, ordinary payout, maximum daily earnings and reserve exhaustion. Existing tests cover single-player, authentication, properties, crews and multiplayer.

For staging, use two accounts in neighbouring districts and compare board prices. Complete a protected consignment; verify one wallet credit, destination stock and price change from the other account, then refresh both. Create rival crews and fund the pursuer through earned freight or the documented staging funding procedure. Opt in a shipment, drive past 25%, approach and challenge. Hold the pursuit lock; verify one fee, no carrier payout, destination loss/pressure and unchanged titles. Interrupt each network, resume, and repeat after a Worker restart. Attempt a duplicate load and verify one receipt. Disable economy and verify ordinary driving and local saves.

No live Cloudflare deployment or physical two-device acceptance was performed in this workspace. Real mobile FPS/bandwidth, provider road coverage, production database latency and hotspot capacity need staging measurement. Each active participant adds up to four actor requests/storage writes per second; boards read 15 market rows every ten seconds per visible client and up to eight competitive convoys. This is a bounded pilot, not a tested worldwide capacity claim. D1 remains a shared authority; read caching, batched persistence and abuse telemetry are future operational improvements. The system deliberately omits personal commodity trading, configurable warehouses, general economic agents and further major phases.
