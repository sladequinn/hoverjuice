# Phase 3: worldwide property registry

This extends the Phase 1 identity/wallet service and Phase 2 geographic multiplayer. It adds permanent game-world titles for supported OpenStreetMap buildings. It does not create real-world legal ownership, crews, territory control, income, resale or commodity markets.

## Identity and source authority

The existing renderer identifies buildings from rounded centroids. Those IDs change across clipped tiles and are not safe global keys. They remain untouched for legacy saves. Global inspection sends only a geographic point; no client geometry, tile ID, building type, price, identity or balance becomes authoritative.

A server-side `PropertySource` Durable Object loads an Overpass-compatible OSM snapshot for the selected geographic cell. Requests use a fixed operator-configured HTTPS endpoint, a bounded query, a 12-second timeout and a 2 MiB streamed response ceiling. Partial/error responses fail closed. One object per demand-loaded cell coalesces requests and persists a 15-minute snapshot; inactive source caches expire after 24 hours. Large snapshots are stored in bounded chunks, not oversized KV values. No planet-wide preload occurs. Source credentials stay in Worker secrets.

The parser accepts complete OSM building ways and multipolygon relations, joins complete member rings, preserves holes, excludes building parts and reserves relation member-way aliases. IDs are `osm:way:<id>` or `osm:relation:<id>`, independent of tile, city origin, session or device. Ring start and winding are normalized before fingerprinting. Unsupported/incomplete/ambiguous geometries do not become purchasable. The game uses a Mercator map: footprints beyond ±85° latitude, footprints extending over 500 m from their anchor, fewer than 12 m², or overly complex geometries are currently excluded. Dateline wrapping is handled for supported footprints and UI positions.

A source ID remains reserved permanently. Original registered geometry and valuation are retained. Normal OSM version/name changes preserve the same title. Geometry, use, level or eligibility changes put a title into **review**, with its owner unchanged. Missing source objects can be marked **retired**, retaining ownership, portfolio and history. New overlapping footprints or conflicting aliases freeze both records; a source split/merge never automatically mints a second purchasable title or transfers an existing owner. Snapshot refresh occurs on inspection/requote, not via a worldwide OSM diff stream. Source changes are therefore discovered on demand and within the configured cache window when revisited.

A global catalog revision/CAS guard makes overlap and alias checks serializable across Worker instances. If a concurrent registration changes the catalog, the operation retries its reads rather than using stale geometry checks. This guard is for catalog metadata; live driving remains geographically partitioned. Indexed nearby-cell lookups bound candidate reads, and dense catalogs over 2,000 candidates fail closed pending partitioning. Clipper, already a project dependency, computes footprint intersections; there is no new dependency.

## Valuation

Valuation version 1 is a deterministic game-economy formula using server-observed footprint area, estimated floor count, use and nearby building density:

- Footprint area comes from complete rings, subtracting holes.
- Floors use OSM `building:levels`, then height/3.4, then one; bounded to 1–80.
- Base HG is `max(5,000, area × floors × 60)`.
- Commercial/retail/office factor is 1.3; warehouse/industrial is 0.8; other supported uses are 1.
- Neighbourhood factor is `1 + min(200, buildings within 300 m) / 100`.
- Round to 100 HG, cap at 100 million HG, store integer minor units (100 minor = 1 HG).

Density is evaluated from the building's canonical source cell, not whichever tile or city the buyer uses. The initial price and source fingerprint are stored in the registry, so providers updating snapshots cannot silently change an outstanding sale. This is geographically responsive game pricing, not an appraisal or external real-estate price feed. Explicitly tagged civic/protected uses and unsupported building states are not offered. Unknown or incomplete source geometry is never guessed from a render mesh.

## Purchase transaction and safeguards

Inspection issues a five-minute, player-scoped quote containing a property revision and server price. The only purchase request fields are `playerId`, `quoteId` and a UUID `requestId`; the authenticated cookie must match `playerId`. The quote is not a reservation.

One D1 transaction inserts an immutable purchase receipt. Database triggers validate quote ownership/expiry/revision, source freshness, title availability, wallet funds and purchase quotas; insert the existing wallet ledger debit; assign the title; and append an audit event. Any failure rolls back all of these. Unique property and request keys prevent double selling and duplicate debits. The existing wallet trigger controls balances and versions. Titles cannot be reassigned/deleted through this API, and the database guards prohibit an owner without a purchase/ledger record. Successful receipts survive quote cleanup and are retained indefinitely for exact retries.

Two simultaneous buyers serialize at D1: one succeeds; the other gets a conflict and loses no money. Two different purchases competing for the same wallet or quota are validated within the transaction, not against an earlier balance read. Limits are one purchase per minute, five per rolling 24 hours, and 200 titles per account. There are also HTTP per-account limits, inspection limits and an aggregate source-fetch ceiling of 60/minute. These reduce bursts; they are not proof of a unique human or complete Sybil protection. No resale, transfers, passive income or tradeable rewards make account farming profitable in this phase.

The browser writes an account-scoped purchase outbox **before** sending. Storage failure prevents the request. Unknown/5xx/network outcomes retain the exact request for explicit retry after refresh. A retry preflights the signed-in identity, cannot cross accounts, and returns the original receipt even after quote expiry. Definitive invalid/conflict responses clear the failed outbox. A failed wallet refresh after a confirmed purchase does not turn that confirmed success into an apparent failed purchase.

D1 remains the single primary registry and wallet writer. Do not introduce independent per-city copies or read replicas without a consistency strategy. [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) provide rollback of the complete batch; the critical title/debit operation is also enforced inside a single insert-trigger chain.

## Client and multiplayer integration

On a real-world map, tap/click a building and choose **Inspect global property**. The inspector shows canonical OSM ID, source version, title status, owner, valuation and global wallet. A purchase requires a fresh server quote and explicit confirmation. More → **Global property portfolio** loads durable holdings with pagination; owners can inspect titles, set waypoints or visit the area.

The original local safehouse/rent gameplay and save IDs are preserved and labelled as legacy/local. They never confer a global title. Local cash and help-menu funds never credit the authoritative wallet. Global titles grant no local rent or territory.

After commit, the server sends a best-effort `property-changed` invalidation through the existing geographic cell/player objects. Clients then read the canonical registry. A selected title also refreshes every five seconds, and nearby owned markers every ten seconds. This repairs missed WebSocket messages, outages, reconnects and server restarts, and works with multiplayer disabled. Presence is not the title database. Up to 500 nearby owned markers are loaded in paginated batches; individual inspection remains authoritative beyond that display cap. Portfolio pages contain 50 titles. Network work runs outside the animation loop, source lookup only happens on explicit inspection/requote, and disabled/static hosts retain single-player play.

## Configuration and deployment

1. Merge/deploy Phase 1 and Phase 2 first (PR #23 / #24), preserving their D1 database and Durable Object namespaces. This branch stacks on Phase 2.
2. Copy/update `wrangler.toml` from `wrangler.example.toml`. Preserve migration tags `v1` and `v2-multiplayer`; add `PROPERTY_SOURCE → PropertySource` and the appended SQLite migration `v3-properties`.
3. Provision a dedicated, appropriately licensed/capacity-managed Overpass-compatible OSM endpoint. Set the non-secret `PROPERTY_SOURCE_URL` to its HTTPS interpreter URL. Public Overpass instances are not configured by default and are not an unrestricted production dependency. The service must return `out meta geom` JSON for building ways and multipolygon relations, with full geometries and versions.
4. If the provider needs authentication, provision `PROPERTY_SOURCE_TOKEN` with `wrangler secret put PROPERTY_SOURCE_TOKEN --config wrangler.toml`. It is sent as a Bearer token only to that fixed endpoint, with redirects disabled. Never embed credentials in the URL or `VITE_*`. Retain Phase 1 `GITHUB_CLIENT_SECRET`, OAuth client ID, exact `APP_ORIGIN`, contact information and deployment credentials.
5. Apply `npm run migrate:remote` before deploying. Migration `0003_global_properties.sql` creates the registry, aliases, catalog CAS clock, quotes, receipts, audit and transaction guards. It imports **no** local ownership, balances, old read-only `ownership` rows or save claims. Existing accounts and wallets are unchanged.
6. Set `BACKEND_ENABLED="true"` and `PROPERTIES_ENABLED="true"` on staging. `MULTIPLAYER_ENABLED` controls live invalidations but is optional for title persistence/polling. The manual Cloudflare workflow now accepts GitHub environment variables `PROPERTIES_ENABLED` and `PROPERTY_SOURCE_URL`; provider tokens are provisioned directly as Worker secrets. Defaults remain off.
7. Run `npm ci`, `npm test`, `npm run check:server`, `npm run check:cloud`, `npx playwright install chromium --only-shell`, and `npm run test:browser`. Focused checks: `npm run test:properties`. Deploy using the existing Cloudflare workflow or `npm run deploy:cloud`.
8. Verify status, OAuth, canonical inspection and source-provider limits on the deployed HTTPS host. No external resources or credentials are provisioned by this code change.

### Wallet funding prerequisite

Phase 1 wallets intentionally start at zero. There is still no trusted gameplay reward producer. **Do not import local cash or add a browser credit endpoint.** Fund acceptance-test accounts through an authenticated operator/D1 workflow. For example, after replacing the player UUID in a reviewed SQL file, execute it with `wrangler d1 execute DB --remote --config wrangler.toml --file <reviewed-file.sql>`:

```sql
-- Staging only: one 1,000,000 HG fixture credit per account.
-- Use the same operation ID on retries; do not create new IDs to repeat a grant.
INSERT INTO wallet_ledger
 (player_id,operation_id,delta,reason,balance_after,version,created_at)
SELECT player_id,'staging-property-fixture-v1',100000000,
 'operator staging fixture',balance+100000000,version+1,unixepoch()*1000
FROM wallets
WHERE player_id='REPLACE-WITH-PLAYER-UUID'
 AND NOT EXISTS (SELECT 1 FROM wallet_ledger
  WHERE player_id='REPLACE-WITH-PLAYER-UUID'
    AND operation_id='staging-property-fixture-v1');
SELECT operation_id,delta,balance_after FROM wallet_ledger
WHERE player_id='REPLACE-WITH-PLAYER-UUID'
 AND operation_id='staging-property-fixture-v1';
```

The existing wallet trigger applies this credit atomically. Restrict D1 credentials, retain an audit of operator grants, and verify the returned receipt/amount. This is not automatically run, exposed to players, or a production issuance policy. A deliberate trusted funding/reward policy is still required before opening purchases broadly.

### Two-device acceptance

Use two different authenticated accounts with trusted staging funds. Choose a supported unowned building and inspect it on both devices, including across different city origins/cell boundaries. Both press Buy: one receives a title/receipt, the other a no-charge conflict. Check both HUD/map inspector owners, both wallet balances, one ledger debit and one purchase record. Refresh/log out/reconnect and restart/redeploy the Worker; the winner's portfolio and owner remain unchanged. Drop a purchase response and retry its stored request; verify no second debit. Disable multiplayer to check polling recovery. Interrupt the OSM provider: new quotes stop safely, while existing title and portfolio reads remain available.

### Source reconciliation and operations

Do not clear `review` flags simply to unblock purchases. Compare current full OSM geometry/version, original registered rings, aliases, existing owners and audit events. For an unambiguous edit to the same physical building, a reviewed offline administrative D1 transaction may update canonical metadata/aliases, increment both catalog clock and property revision, and record the evidence/reason in `property_audit`, preserving the owner and purchase receipt. Keep exclusive maintenance control while reconciling; no admin HTTP route or automatic owner reassignment is included. Splits/merges involving existing titles require an explicit adjudication policy; keep every affected record non-purchasable until resolved. Do not delete aliases or silently return retired properties to the market.

Back up D1 and test restore procedures; retain purchases, wallet ledger, properties, aliases and audit indefinitely. Quotes expire and are removed by the existing bounded cron cleanup. Monitor conflict rates, source failures, catalog retries, scan/egress costs and the review backlog. Cloudflare/D1 capacity is finite: before substantial global load, benchmark the single primary write path and design catalog partitions that preserve atomic wallet/title settlement. The 60/minute source cap and candidate/marker limits are explicit initial-rollout bounds, not a claim of unlimited scale.

Rollback: set `PROPERTIES_ENABLED=false` and redeploy. Preserve tables, ledger data and migration history. Global reads/purchases stop; local saves and gameplay continue. Never roll back a successful title by deleting its ledger or restoring only one half of the registry/wallet database.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Maintain attribution and applicable database licensing obligations when hosting source snapshots or distributing derived data. Source protocol reference: [Overpass output formats](https://dev.overpass-api.de/overpass-doc/en/targets/formats.html).
