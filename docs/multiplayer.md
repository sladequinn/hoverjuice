# Phase 2: authenticated geographic multiplayer

This builds on [Phase 1](backend-foundation.md). GitHub remains the source of truth. Cloudflare serves the existing game assets, account API and multiplayer on **one HTTPS origin**. Accounts and multiplayer both default off. GitHub Pages, procedural maps and offline gameplay remain playable without these services.

## Architecture and trust boundary

The Worker authenticates the Phase 1 HttpOnly session cookie, checks the exact WebSocket Origin, derives the persistent UUID and driver name from D1, and admits the connection to that player's `PlayerSession` Durable Object. No URL, message or local save supplies an authoritative identity. Provider tokens and Cloudflare secrets never reach client code.

Each player has one browser WebSocket. A stored, monotonically increasing connection epoch replaces any older connection for that UUID, including other tabs/devices. The old connection receives code 4009 and does not fight to reconnect. Hibernation attachments retain validation state and subscriptions; an evicted object restores its epoch from durable storage. Sessions are checked again at most 30 seconds after the previous check while messages arrive. Signing out revokes HTTP access immediately; an existing socket stops within that recheck window.

`GeoCell` objects hold ephemeral publishers and subscriptions. Latitude bands are approximately 2.2 km tall, with longitude column counts adjusted by latitude. The grid wraps at the dateline and handles polar bands; it has no city-specific boundaries. A server-computed spherical halo watches every cell intersecting 1 km around the player. Cells forward only nearby poses. Clients render within 650 m, leaving room for subscription movement and interpolation. Watch positions refresh every five seconds or 100 m. Publishing in a new cell precedes removing the old cell entry; clients deduplicate by UUID, epoch and sequence. A cell change never reconnects the browser socket or emits a boundary leave event.

`CruiseRace` owns casual race membership, countdown, checkpoint order and elapsed time. Courses reuse the existing road-loop finder. The host proposes a bounded course; the server accepts only 2–32 nearby checkpoints and advances entrants from their validated movement. This is not a server terrain simulation or competitive anti-cheat system. No money, progression, records or global ownership comes from multiplayer poses or race finishes.

Cloudflare references: [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/). The existing PartyKit client and deploy configuration were retired because self-asserted identity and multi-socket tile/crew routing conflict with Phase 1 identity. The old relay remains an undeployed historical test fixture; `VITE_PARTYKIT_HOST` is unused. No new runtime dependency was added.

## Driving and presentation

Local driving never waits for the server. A network timer sends rounded positions, absolute elevation, road clearance, heading, planar velocity, chassis, mask, paint and boost at up to 10 Hz, or 1 Hz when unchanged. The animation loop only supplies the latest sample and renders remote poses. JSON handling and bounded mesh creation run outside that loop. Remote meshes use the actual existing vehicle builders, not proxy boxes. Each peer owns its disposable model and name texture; appearance churn cannot grow an unbounded cache.

The renderer uses a 150 ms arrival buffer, shortest-path yaw interpolation and no more than 150 ms of prediction, then holds the pose. A short render correction smooths arrivals. Absolute elevations are converted into the local city datum; low-clearance cars follow the locally loaded terrain/road layer. Nearby building intersections suppress extrapolated poses. This shares the existing map and terrain pipeline rather than introducing a competing physics system. Names appear within 160 m, with a UUID suffix to distinguish repeated names.

Cars are ghosts to one another. Traffic, police, NPCs, damage, jobs, weather and local economy remain independent single-player systems. Different map versions/terrain loads can still disagree, especially on stacked roads. Trusted map geometry, shared traffic and collision simulation are not implemented.

## Limits, scaling and bandwidth

| Item | Phase 2 limit |
|---|---:|
| Browser sockets | 1 per account; newest connection wins |
| Cell publishers / watchers | 64 / 256 |
| Forwarded/rendered peers | 24 desktop, 12 coarse-pointer/mobile |
| Movement / idle rate | 10 Hz / 1 Hz |
| Maximum accepted message rate | 16 per second |
| Message / processing queue | 4 KiB / 4 pending messages |
| Client queued output before skipping sends | 16 KiB |
| Visibility / watch radius | 650 m / 1 km |
| Publisher / watcher expiry | 8 s / 15 s |
| Client stale hide / removal | 3.5 s / 5 s |
| Heartbeat acknowledgement / reconnect threshold | about 2 s / 12 s |
| Race lobby | 8 entrants; 5 s countdown; 15 min race expiry |
| Friend invitation | 3 h; possession of link plus authentication required |

Raw JSON is roughly 250–400 bytes per outgoing pose and 350–500 bytes per forwarded pose, depending on names/coordinates. At 10 Hz this is about 2.5–4 KB/s uplink; two-player cruising is roughly 3.5–5 KB/s downlink. A full mobile view can approach 60 KB/s downlink, and desktop 120 KB/s, before WebSocket/TLS overhead. This is an estimate plus bounded-payload tests, not a measured cellular field result. Idle poses reduce traffic substantially. Counters `connection.bytesSent/bytesReceived` are available for diagnostics. Coarse-pointer devices request 12 peers and the server enforces the lower limit.

Cell/peer caps bound fanout; they are not a proven global concurrency capacity. A full cell rejects admission/publishing with a transient busy connection close, retains local play and backs off reconnects (1–30 seconds plus jitter). High-density crowds will require sharded cell instances/admission policy. Per-player objects, cross-object fanout and D1 session checks have cost and regional-latency implications. Benchmark in target Cloudflare regions before public rollout. No global simulation or multi-region active writer scheme is implemented.

## Security and failure recovery

Movement uses a strict whitelist with finite numbers, bounded altitude/clearance and known appearance IDs. The server checks increasing sequence numbers, an initial 250 m spawn envelope, horizontal movement budget (80 m burst; 220 m/s refill), a per-update vertical bound and a 220 m/s velocity ceiling. Three invalid moves close the socket. Oversized/binary frames and excessive rates/queue depth close it. HTTP admission and profile/invite/race creation have account quotas. Client identity, wallet balances and arbitrary reward fields are rejected/ignored, never credited. Race courses and cosmetic customization remain untrusted legacy gameplay inputs, not ownership proofs.

Acks detect half-open connections. Reconnects reauthenticate and receive a new epoch; old peers age out, and a successful welcome clears obsolete local instances. Hidden tabs pause networking and resume on visibility. Duplicate-session closes stop automatic retries until the user explicitly rejoins. Exceptions, missing services, expired sign-in, or malformed responses leave the local game playable. Turning **Play solo** on persists an opt-out. Network status is in the existing HUD, with fuller details under **More → Cruise with friends**.

Cloud saves and wallet ledgers are unchanged. Ephemeral positions need not be written to D1; browser refresh preserves identity and restores the existing local city/save, not the exact last online road position. Race state survives DO eviction and reconnect until expiry. Invites store only location, optional race ID and expiry, and cleanup uses the existing scheduled task. Disabling multiplayer does not alter any saves or balances.

## Deployment

1. Complete the [Phase 1 configuration](backend-foundation.md): D1, same HTTPS origin, GitHub OAuth application/client ID, `GITHUB_CLIENT_SECRET`, Cloudflare account/token for deployment, and real contact information. Never place secrets in `VITE_*`, tracked config or browser storage.
2. Start from `wrangler.example.toml` or update the existing ignored `wrangler.toml`. Preserve the `v1` migration. Add `PLAYERS → PlayerSession`, `CELLS → GeoCell`, `RACES → CruiseRace` bindings and the appended `v2-multiplayer` SQLite migration. Do not rename existing classes/namespaces on a live deployment.
3. Apply D1 migrations **before** deploying: `npm run migrate:remote`. `0002_multiplayer.sql` adds `players.display_name` and expiring invites; it does not change wallet or save semantics. Existing account IDs survive.
4. Set both `BACKEND_ENABLED = "true"` and `MULTIPLAYER_ENABLED = "true"` for the staging host. Keep exact `APP_ORIGIN`/`ALLOWED_ORIGIN`. The manual GitHub deployment workflow accepts a non-secret environment variable `MULTIPLAYER_ENABLED=true`; absence defaults off. Existing Cloudflare secrets must already be provisioned.
5. Run `npm ci`, `npm test`, `npm run check:server`, `npm run check:cloud`, then `npx playwright install chromium` and `npm run test:browser`. `npm run test:multiplayer` runs the focused server/transport suite. Tests compile the real Worker through Wrangler and run it in Miniflare with real D1 and Durable Objects; no cloud account or production data is used.
6. Deploy with `npm run deploy:cloud` or the manual Cloudflare workflow. Validate `/api/multiplayer/status`, HTTPS cookie login, successful socket upgrade and observability on staging. Neither localhost HTTP cookies nor cross-origin Pages/API combinations substitute for the same-origin deployment.
7. With **two different GitHub accounts on two devices**, sign in, choose a real city, open More → Cruise with friends, save names, and create/copy an invite from the host. The second player opens it, signs in if needed, and joins near the host's validated position. Match different chassis and paint choices. Drive together across cell boundaries, suspend/reopen a browser, refresh, briefly disable networking, then restore it. Confirm one entity per player and unchanged saves/wallets.
8. For a race, create near a connected main-road loop, wait for the lobby to appear (Refresh status), create an invite containing that race, and join before the host starts. The HUD shows countdown/checkpoint direction/distance; the map and world mark the next checkpoint. Refresh the panel for lobby/results. The road graph may not contain a valid nearby loop; this is reported, not replaced by a fabricated course.
9. Before production, perform the same smoke test on actual mobile devices and constrained cellular links, measure full-cell fanout/CPU/egress, and configure operational alerts/budgets. These need real infrastructure and were not verified in this workspace.

Rollback: set `MULTIPLAYER_ENABLED=false` and redeploy to stop new connections; if urgent, revoke sessions and allow the 30-second recheck window for existing sockets. A flag alone is an admission switch, not immediate eviction of every established socket. Keep D1 data, migration history and DO namespace bindings. Clients continue offline and cloud account APIs may remain enabled. Do not reverse migrations by deleting players or wallet data.

## Deferred scope

Global ownership, persistent crews, territorial control, markets/trading, authoritative economy gameplay, shared traffic/physics, ranked anti-cheat, voice/chat, matchmaking overflow instances and a global simulation are not part of this phase. Phase 3 requires separate approval.
