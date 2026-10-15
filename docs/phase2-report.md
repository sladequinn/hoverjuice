# Phase 2 implementation report

## Completed

- Reused Phase 1 GitHub OAuth identity, secure cookie sessions, D1, Worker asset hosting and deployment pipeline. Phase 1 remains available separately in PR #23.
- Replaced the browser's anonymous PartyKit tile/crew connections with one authenticated WebSocket per persistent account and server-owned geographic subscriptions.
- Added latitude-aware geographic cells, dateline/polar handling, overlapping subscriptions, stable peer IDs/epochs, duplicate-session replacement and nearest-peer limits.
- Added rounded 10 Hz movement / 1 Hz idle updates, server movement budgets and rate limits, 150 ms interpolation/prediction, terrain/road alignment, actual chassis/masks/paint, nearby names, and bounded model/queue lifetime.
- Added driver names, expiring authenticated friend links, join-at-friend location, persistent solo opt-out, unobtrusive connection status and reconnect/backoff/heartbeat recovery.
- Added casual road-loop race lobbies, host countdown, ordered server-observed checkpoints, finish times, checkpoint markers/map guidance and reconnect recovery. Races never issue rewards or modify the global wallet.
- Added D1 migration 0002, three SQLite Durable Object bindings and migration, default-off multiplayer configuration, workflow environment support, operating limits, deployment/rollback and two-device staging instructions.
- Preserved local gameplay, save/cloud migration, wallet isolation, existing map/terrain pipeline and offline/procedural play. Kept the old undeployed PartyKit server only as a historical regression fixture; removed its deploy configuration and development command.

## Verified

- **98 Node tests passed**, including all existing tests and Phase 1 authentication, persistence, concurrency, idempotent wallet and recovery tests.
- Real compiled Worker + Miniflare D1/Durable Objects: two independent authenticated accounts, exchanged customized poses, proximity exclusion, geographic boundary crossing, old connection replacement, reconnect identity, forged identity rejection, malformed/oversized messages, flooding, revocation, invite location integrity/expiry, race admission/countdown and a complete two-player finish without wallet credits.
- Pure geometry/protocol tests: halo coverage around geographic boundaries/dateline/poles, movement whitelist, finite values, bounded extrapolation, cell capacity, epoch guards, output backpressure, idle bandwidth, heartbeat recovery, static/disabled-host fallback and disposal during authentication.
- **All 13 browser scripts passed**, covering the existing gameplay/terrain/performance/UI/cloud-save regressions and new desktop/mobile custom models/paint, terrain alignment, stale pose rejection, appearance replacement, peer caps, solo cleanup and friend controls.
- TypeScript client/server checks, production Vite build, Wrangler deployment dry-run and whitespace checks passed. Vite retains its pre-existing large-bundle advisory; this is not a new split/rewrite of the game.

## Critical review changes

Corrected free-driving velocity axes and initial peer placement; bounded appearance work and disposed peer-owned resources without destroying shared rider materials; prevented duplicate connecting sockets and retry fights; added half-open connection detection and persistent backoff; checked stale connection epochs before applying async results; guarded malformed server messages; kept server and mobile peer limits consistent; prevented static hosts from endlessly retrying a missing backend; preserved friend invitations through OAuth and removed consumed URL parameters.

## Limitations and deployment blockers

This is implemented and locally verified, **not deployed or proven on two physical devices against Cloudflare**. No Cloudflare resources, production secrets or GitHub OAuth application credentials were supplied. Provision the Phase 1 account stack, apply migrations, enable the staging flag and execute the two-device acceptance checklist in [multiplayer.md](multiplayer.md). The automated Worker tests use issued test sessions, not a live GitHub login. Browser visual tests use controlled peer frames; Worker tests separately exercise real authenticated sockets.

Bandwidth figures in the guide are payload estimates and bounded-output tests. Mobile browser layout/input class was emulated in Chromium; actual mobile GPU/FPS, cellular jitter, cross-region latency, full-cell cost and load still require field/staging measurements. Caps (64 publishers/cell, 24 desktop or 12 mobile peers) intentionally limit the first rollout; crowd overflow instances are not implemented.

Remote vehicles are ghosts and follow each client's local terrain. Traffic, NPCs and collision outcomes are not shared; loaded terrain or stacked-road differences can remain visible. Validation is movement sanity, not full authoritative physics or ranked anti-cheat. Refresh retains account and legacy save/city, not exact network position. Race state is durable until expiry; cell presence is ephemeral. Race courses depend on an actual connected nearby main-road loop. Global gameplay currency integration remains deferred; local money is never imported into the authoritative wallet.

No global property ownership, persistent crews, territorial conquest, market trading or Phase 3 work was started.
