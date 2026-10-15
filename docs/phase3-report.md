# Phase 3 implementation report

## Completed

- Audited the latest main branch (Phase 1 merged) and Phase 2 implementation. This work builds on the Phase 2 branch and reuses its identity, wallet, Cloudflare and geographic notification infrastructure.
- Added a demand-loaded, server-verified OSM building catalog. Canonical way/relation IDs and member aliases replace tile-centroid identity for global titles while preserving legacy save IDs.
- Added deterministic area/floor/use/neighbourhood valuations, complete multipolygon/hole handling, dateline wrapping, source version tracking, protected original geometry and conservative reconciliation states.
- Added atomic, idempotent title purchases using the existing global wallet ledger. Quote, funds, title availability and quotas are validated inside the transaction; title/debit/receipt/audit either commit together or roll back together.
- Added map building inspection, owner/price display, purchase confirmation, account-scoped interrupted-purchase recovery, paginated global portfolios, waypoints and area travel. Existing local cash, safehouses and income remain explicitly separate.
- Added immediate geographic ownership invalidations through Phase 2 sessions and periodic canonical reads for missed-message/reconnect recovery, including multiplayer-disabled operation.
- Added D1 migration 0003, the source-cache Durable Object and migration, default-off configuration, deployment workflow variables, source/funding/rollback documentation and operating limits.
- No new dependencies. The geometry code reuses Clipper, already used by the game.

## Verification

**116 Node tests passed.** Coverage includes the complete existing gameplay/backend/multiplayer suite plus property concurrency, rollback injection, exact retries after lost responses, stale/stolen/expired quotes, origin/authentication checks, insufficient funds, atomic cooldown and daily quotas, source identity normalization, relation aliases/holes, dateline footprints, overlapping registration races, geometry changes, provider failures/oversized responses, account isolation and durable restart recovery.

The acceptance test runs the compiled Cloudflare Worker with real local D1 and Durable Objects: two authenticated accounts with funded test wallets submit competing purchases. Exactly one succeeds, the loser retains its full balance, both live sockets receive the ownership invalidation, and both read the same committed owner. Separate tests dispose/recreate the database service and recover the title, portfolio, ledger and original retry receipt.

**All 14 browser scripts passed**, including desktop/mobile inspection, escaped source labels, buying, global/local wallet isolation, portfolio reload, and all prior gameplay, map, terrain, startup, UI, cloud-save and multiplayer checks. The property browser script was rerun after final client recovery fixes.

Client/server typechecks, production Vite build, Wrangler deployment dry-run, local D1 migrations through 0003 and whitespace checks passed. The existing Vite bundle-size advisory remains; the game was not rewritten or split as part of this phase.

## Critical review fixes

The catalog now uses a transaction-guarded revision so concurrent overlap/alias checks cannot both register conflicting active titles. Database triggers protect title creation/reassignment and immutable purchase receipts. Relation geometry rejects unsupported member references/roles rather than silently importing a partial outline. Oversized source snapshots use bounded storage chunks. Interrupted purchases cannot be replayed under a different account; account switches clear stale portfolio UI; failed post-success wallet refreshes cannot obscure a confirmed purchase. Geographic UI coordinates wrap correctly at the dateline. Repeated source-review observations are deduplicated in the audit table.

## Remaining limitations and deployment gates

- **Not deployed to Cloudflare or field-tested on two physical devices.** Configure the existing OAuth/Cloudflare stack, provider endpoint/token and staging environment; follow [global-properties.md](global-properties.md). Automated browser tests use controlled API responses; the Worker acceptance test exercises the actual authenticated transaction and notification paths locally.
- **Global wallets still start at zero.** There is no trusted gameplay reward producer yet. The guide supplies a reviewed operator-only staging funding procedure. Production issuance policy must be deliberate; local cash and help-menu funds are never imported. This phase does not invent client rewards or silently mint starter grants.
- **OSM geometry/source splits and merges need review.** Titles/aliases/history remain reserved; changed or ambiguous footprints cannot be resold automatically. Reconciliation is an administrative process, with no automatic ownership transfer. Unsupported large/complex/polar buildings are not purchasable. Source updates are discovered on demand, not through planet-wide diff ingestion.
- **Initial rollout limits are explicit.** One D1 primary owns financial/title writes; source fetches are capped at 60/minute, purchases at one/minute and five/rolling day per account, portfolios at 200 titles, and nearby map markers at 500. Larger crowds, provider capacity, regional latency, mobile hardware and sustained global throughput need staging/load measurements and further partitioning design.
- Global properties currently provide permanent titles and portfolio management. No resale, rent, crews, territory warfare, commodity markets or Phase 4 functionality was implemented.
