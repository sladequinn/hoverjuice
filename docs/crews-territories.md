# Phase 4 — Crews and territory control

## Scope and prerequisites

This layer extends the Phase 1 account system, Phase 2 geographic multiplayer and Phase 3 property registry. It does not replace the game's legacy NPC gangs, local save, local cash or single-player territory colouring. Personal building titles remain immutable. No commodities, trading, property transfers, passive income or currency rewards are added.

Enable only after deploying and verifying the earlier phases. A crew needs an active global property owned by its leader or an officer to establish HQ. Existing global wallets start empty: use the trusted funding procedure in `global-properties.md` for staging; local game money cannot purchase HQ titles. Production wallet funding still requires an operator-approved policy.

## Player flow

1. Sign in, enter a real-world city, go online, then open **More → Crews & global districts**.
2. Create a unique crew name and tag, or join with a private invite supplied by its leader. Leaders can rotate invitations, promote/demote officers, transfer leadership and remove members. An officer can establish HQ only in a title they personally own.
3. Inspect an owned title in **Global property portfolio** and choose **Establish crew HQ**. This gives the crew permission to use it as a rally landmark, not ownership of the property.
4. Drive into a district within 15 km of HQ. Open a contest, then join the two-driver squad. Another crew can join the same round. Admission uses the authenticated live player session; HTTP coordinates, identities and scores are not accepted.
5. Follow the green gate and map delivery marker along the selected public road, turn at its far end, and return. Gates are ordered. The first valid delivery locks that driver's time. A run interrupted by a connection gap or invalid movement resets to the start; there are at most three attempts.
6. At the end of the ten-minute round, the best valid crew time wins. A second valid driver improves the crew's score by 5%. Equal scores use immutable crew ID order. Every viewer reads the same result, including after changing city sessions or reconnecting.
7. Winners receive 10 crew reputation and a seven-day control lease. Crew members see shared rally-travel buttons for controlled districts, which use the existing city travel system. Control never improves vehicle stats or generates money.

The map distinguishes global district outlines, crew-coloured HQ markers and active delivery gates from legacy NPC zones. Crew tags appear above nearby cars; membership changes propagate to these labels at the existing 30-second session validation interval. Crew/district data refreshes every five seconds while the page is visible, independent of rendering. The panel displays errors and permits explicit recovery of an unconfirmed membership command.

## Authority and persistence

- D1 migration `0004_crews_territories.sql` adds crews, unique account membership, one-hour rejoin cooldowns, immutable idempotency receipts, command authorization triggers, global district control and immutable contest results.
- Every membership command includes a UUID request ID and the expected authenticated account. The account field is only an assertion: the cookie supplies authority. Reusing a key with different contents fails. The browser writes a per-account outbox before sending, so a lost response can be retried safely. An uncertain request is not automatically reassigned after sign-in changes.
- Membership limits, permissions, role transitions, HQ ownership and cooldowns are enforced inside the same D1 transaction as the mutation. One player belongs to at most one crew; each crew has at most 16 members. The last member can leave and retire the crew; a leader with other members must first transfer leadership. Former names/tags remain reserved with history.
- A member's departure atomically clears any HQ hosted in that member's title. Retired/review properties cannot authorize contests. The title itself is never changed. Final scoring checks both current membership generation and an eligible HQ, again inside the result insert to close concurrent membership-change races.
- One `Territory` SQLite Durable Object serializes each district's round. It persists the server-selected course, roster and checkpoint progress before acknowledging them. A single alarm ends an active round; reads also recover overdue rounds. No simulation runs in inactive districts.
- Final result insert, control transition and reputation award form one D1 transaction. A unique contest ID makes retry after a DO storage failure harmless. A contest with no eligible finishers preserves the previous controller and original expiry; it cannot erase or renew a rival's control. A full crew's fourth attempted district is excluded from winner selection. The database independently enforces the three-district cap across concurrent actors.
- Expiry is evaluated at read time. Dormant ownership does not require a worldwide timer or mass update. Immutable results retain history even after control expires.

## Geographic identity and scaling

District IDs are `d1:<latitude-row>:<longitude-column>`, using the Phase 2 0.02-degree latitude bands with longitude counts adjusted by latitude. They are approximately 2.2 km wide in ordinary inhabited latitudes. This is a versioned geographic grid, not an OSM neighbourhood label. Only canonical decimal IDs are accepted; leading-zero aliases are rejected so two actors cannot control the same district. Dateline wrapping and polar bands are covered by tests.

Each district is materialized only when accessed. The API reads one displayed/tracked district, not the world. Tracking a joined contest keeps its route visible across cell boundaries; **View current district** returns discovery to the driver's current position. Up to 50 HQ markers are returned per district. At most 16 drivers, two per crew, enter one contest; there is only one active round per district. The warmup is 30 seconds, admission two minutes and duration ten minutes, followed by a 30-minute rest.

A bounded OSM road snapshot comes from the existing private `PropertySource` DO and configured provider, cached for 15 minutes. Queries now include ordinary road ways as well as buildings. A deterministic eligible two-way public road of 250–850 m supplies the out-and-back course, with gates at most 35 m apart and a bounded point count. Private roads, motorways, one-way roads, roundabouts, incomplete snapshots and excessively complex routes are excluded. If there is no safe supported route, contest creation fails clearly; it does not substitute arbitrary coordinates or trust a client course. No external real-estate or routing dependency is added.

Movement is forwarded at most four times per second from the existing `PlayerSession`; there is no extra client movement stream. Territory failure does not disable ordinary driving or multiplayer. Active runs enforce server timestamps, ordered gates, monotonic session/sequence, continuity within three seconds, a 90 m/s displacement bound, bounded altitude changes, reported clearance at most eight metres and a 28 m road corridor. Reconnecting preserves admission and identity but resets an unfinished run when movement resumes. Finished deliveries survive reconnects.

Budgets: at most 64 internal movement calls/storage updates per second for a full district; foreground panel polling adds about 12 district reads per minute per viewer. These are bounded staging assumptions, not a measured production capacity claim. A large hotspot may need view caching, event-driven invalidation and more selective progress checkpoints before broad rollout. D1 is the global metadata authority; sharding that authority is a later operational migration, not a per-session duplicate registry.

## Fairness and limitations

Two-driver squads and a small, capped cooperation bonus avoid rewarding raw crew population. A lone driver can win. Three live districts per crew, expiring control and forced rest periods limit expansion and repeated attacks. Newcomers cannot lose cash, personal buildings, vehicle performance or access to streets through a contest. Cars remain ghosted to each other, so blocking or ramming cannot deny a gate. Regional rewards do not depend on crowd size; an isolated crew can establish control by completing a valid run without waiting for an opponent.

These are **server-validated movement contests, not a server physics simulation**. A modified client that generates physically plausible road-following poses can still cheat; botting and multiple OAuth accounts are not solved. Reported height/clearance is not independently verified against server terrain. Do not attach valuable wallet rewards or claim ranked anti-cheat guarantees without authoritative inputs/physics, terrain validation and abuse telemetry. This implementation deliberately grants only reputation and coordination conveniences.

Road availability and real-world hazards are not guaranteed by OSM. A single-way route can be unsuitable in a sparse/incomplete region; bridge elevations and imported rendering require staging inspection. Current property ingestion supports latitudes through ±85 degrees; the district grid itself covers the world, while unsupported road/property data fails closed. No city is hardcoded. There is one delivery time-trial mode, with bounded team cooperation; additional combat, race formats, seasons, diplomacy and advanced influence mechanics are deferred. The saved contest scores are this phase's influence measure; there is no passive influence farm.

## Deployment

1. Back up D1 and preserve the existing OAuth secrets and DO migration history. Apply migrations 0000–0004 in order. For an existing deployment only 0004 should be pending:
   ```sh
   npm ci
   npm test
   npm run check:server
   npm run build
   npx playwright install chromium --only-shell
   npm run test:browser
   npx wrangler d1 migrations apply DB --remote --config wrangler.toml
   npx wrangler deploy --config wrangler.toml --dry-run
   npx wrangler deploy --config wrangler.toml
   ```
2. Copy the `TERRITORIES` binding and appended `v4-crews` migration from `wrangler.example.toml` into your deployment config. Do not edit or reuse earlier migration tags. The export is `Territory`.
3. Set `CREWS_ENABLED="true"` only with `BACKEND_ENABLED`, `MULTIPLAYER_ENABLED` and `PROPERTIES_ENABLED` also true. The checked-in defaults are false. The manual GitHub deployment workflow and `scripts/configure-cloud.mjs` accept the new non-secret GitHub environment variable.
4. Retain `APP_ORIGIN`, GitHub OAuth configuration, `APP_CONTACT`, `PROPERTY_SOURCE_URL` and optional secret `PROPERTY_SOURCE_TOKEN`. No new secret is required. The dedicated source must permit the expanded road query. Source fetches bind the Worker global receiver and use manual redirect handling; non-success/redirect responses fail without forwarding the token.
5. Deployment credentials remain `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; keep them out of client code. Verify configured OAuth callback and same-origin HTTPS API as in the Phase 1 guide.

Disable `CREWS_ENABLED` to roll back availability without deleting memberships, titles, contest history or wallets. Do not remove migrations/tables or DO bindings to disable the feature. Previously scheduled round alarms may finalize already admitted rounds; the flag stops new public requests/movement forwarding, not historical settlement. Pause deployment and use an audited operator procedure if settlement itself must be halted.

## Staging acceptance procedure

Use two separately authenticated devices/accounts with trusted staging funds. Each purchases a different verified building and creates a crew/HQ. Check that an unrelated member cannot set another player's title as HQ. Meet in the same district, open one contest and join both crews. Complete the displayed road delivery with different valid times and wait for settlement. A second driver may join each squad to exercise the 5% cooperation bonus.

Verify one result, the expected controller, exactly one 10-point reputation award, unchanged personal title owners and unchanged wallet balances. Refresh both clients, join another geographic session and confirm the same controller. Interrupt a run's network for more than three seconds; reconnect with the same identity and roster entry, and restart the delivery. Rotate a crew invite, remove a member and verify their permissions and tag update. Repeat during a source outage and with crews disabled: local driving and existing saves must continue.

Automated tests cover database concurrency, atomic rollback, post-commit storage failure, membership/HQ authorization, movement validation, no-finisher protection, global caps, immutable results, actual compiled Worker crew admission/reconnect, cross-session reads and desktop/mobile UI. Physical-device performance, live Cloudflare deployment and a real ten-minute two-device contest still require this staging exercise and operational credentials.
