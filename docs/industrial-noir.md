# Industrial noir overhaul: implementation and next gates

## Implemented in this branch

- Vehicle-only input and camera path; walking physics, walk animation, drone targets and plasma combat removed. Legacy animal-mask selections migrate to a balaclava.
- ACES exposure 1.0; single antialiased forward pass, no bloom chain. Adaptive pixel budget, up to 1.25 DPR / 1.6M pixels. Dark concrete/asphalt/steel environment, amber lighting, turquoise propulsion. Boss body is metallic purple. Hue cycling, VHS grading and synthwave sun removed.
- Shared world-space flat facade shader, antialiased 3.5m floor grid and sparse amber/fluorescent windows. Fake interiors and room atlas removed after playtesting.
- Wet asphalt roughness/albedo noise. Simple distance fog for a cheaper and clearer street silhouette.
- Road widths, bridge/tunnel tag ingestion, interpolated road heights, short ramps, instanced bridge pillars, tunnel walls/caps and water retaining skirts. Ground uses stencil cutouts for water and tunnel trenches.
- Area-weighted polygon centroids, five-decimal coordinate building IDs, tile keys, POI/landuse ingestion, original OSM names and mapped fuel depots. Business renaming and nearby labels were removed. No per-building label textures.
- Three snap lanes, high-speed corner failures, collision failures, water drift, Cyan-ade overclock, hull and Heat, 15-second limp reserve, impound/confiscation, Flow from near misses/apex turns, Flow-adjusted tips and evaporation.
- Instanced courier/freight/patrol fleets, ground-plane interception/ramming, basic boxing detection, pooled exhaust/hazard particles, pay-at-completion fueling and pump-and-dash Heat/slicks.
- Six non-animal mask models visible on boards and in cockpit positions, HUD portrait, functional Iron Lung leakage protection, balaclava rival-Heat reduction and Oni collision protection.
- Local stash deposit/withdrawal, starter garage at nearest connected road to the selected real-world origin, property clearance, local net worth and notoriety, cold-open boss pass and gated three-lap pink-slip challenge.
- PartyKit room server plus browser client: 20Hz own-tile telemetry, 5km halo subscriptions, server-side distance filtering, crew override, peer validation and a fixed 32-mesh remote pool. Coordinates are global Web Mercator metres, converted to each client's local origin. Dead reckoning is limited to 200ms and stale peers expire after four seconds.
- Sparse D1 schema, read-only ownership/record endpoints, ownership polling and roof gang attributes on existing roof geometry. Claims do not add a new draw call to the roof batch.
- Cached, serialized geocoding proxy; runtime endpoint switching; explicit OSM attribution in loader and map view.

## Important boundaries

1. **This remains a local-economy prototype.** Property purchases, vaults, Heat and race rewards are browser state. Online ownership is read-only. Identity, authoritative balances, transactional claims, conflict handling and verified record submissions must precede global economic writes. PartyKit telemetry is ephemeral and not proof of race completion.
2. **Map tags are incomplete.** OpenMapTiles building geometry often lacks original `building`, `amenity`, `shop`, `brand` and `cuisine` tags. Unknown building use fails closed. A building must have explicit nonresidential use plus pass the blacklist; POI presence alone does not prove a building is nonresidential. Real cities may consequently have no eligible landmarks or dealers. The simulation grid explicitly has synthetic commercial metadata. A richer tagged OSM enrichment pipeline is required for a populated real-city criminal economy.
3. **Tile clipping changes centroids.** Footprints touching tile boundaries remain unclaimable until stitched or resolved to a canonical complete geometry. Five-decimal centroid IDs can still collide for distinct overlapping footprints; global ingestion needs a canonical collision policy. Existing index-based legacy holdings keep their saved income but are not silently remapped onto new buildings.
4. **Elevation is synthetic.** Bridge/tunnel ramps currently operate per tile feature and can repeat across fragmented spans. There is no source-road span stitching yet. Water polygons and holes are supported; narrow waterways available only as centerlines still need a ribbon pass. Pillar placement is every 25m within each feature. Terrain and islands are not a DEM.
5. **Rendering is a first art pass.** No reflection probes/SSR, detailed tunnel lighting or authored vehicle art. World rendering is WebGL; existing HUD minimap/full-map drawing remains Canvas2D. Facades use a simple cardinal wall projection.
6. **Multiplayer is transport-level.** Requires deployment and public endpoint configuration. No live accounts or credentials are supplied. Ambient subscription count grows with latitude and is explicitly disabled above 128 needed rooms; crew rooms remain available. Remote chassis are pooled proxy boxes with masks, not finished per-model vehicles. Room capacity is 128 connections, visual pool 32 peers. Authentication, abuse quotas, admission control and production load testing remain gates.
7. **Race scope is loaded data.** The highway loop finder uses connected arterial-width nodes and returns a valid cycle, not necessarily a municipality's optimal highway ring. Tallest-building gating is within loaded chunks. Local test funds remain for development and must never authorize global ownership or records.
8. **Fuel coverage follows data.** Real-world fuel depots use available fuel POIs. There are no invented stations in real cities. If the current tile lacks fuel POIs, keep exploring; the offline grid has explicit synthetic pumps.

## Remaining specification work

| System | Outstanding work |
| --- | --- |
| Global persistence | Authenticated economy, transactional property ownership, dead-drop read/write lifecycle, stash ownership and conflict resolution |
| Road records | Segment generation, verified timings, global crown HUD, record ghost capture/playback |
| Crews | Shared contract waypoints, convoy ambush events, split payouts and shared Flow |
| Flashpoints | Server scheduler, actual 48-hour regional shortages/lockouts, postcode mapping and client market effects |
| Territory campaign | Enforcer encounters, meaningful landuse domination, rival-owned corridor tolls and canonical city extent |
| Masks | Glitcher patrol-cone overlays/contract reveals, split-screen trade portraits, rotating rooftop owner-mask holograms |
| World aliveness | Tracking CCTV, variable-message boards, scattering roadside props, manhole/HVAC emitters, honks and positional district/PA audio |
| Visual finish | Waterway ribbons, stitched bridge/tunnel spans, complete 3-lane rail ribbons, higher-fidelity room atlas and exact 4.6×2.1×1.1 chassis envelopes |
| Traversal polish | Curb-scrape Flow events, full collision volumes, interception tuning and endgame race balancing |

## Validation

`npm test` checks exclusion logic, deterministic naming/centroids, overclock/limp/Heat/Flow, lane input, corner failure, closed race loops, spatial projection/halo coverage, packet validation, room filtering, crew routing and read-only API behavior.

`npm run test:browser` launches Chromium with software WebGL, forces the explicit offline map fixture, renders facade/asphalt/fog shaders, exercises vehicle movement, overclock, vault deposit/withdrawal and mask UI, and captures desktop/mobile screenshots under `.test-artifacts`. It does not validate a deployed PartyKit/D1 stack or live tile fidelity.

`npm run build` checks the client and bundles production assets; `npm run check:server` checks the PartyKit and Cloudflare server types. CI runs these gates. Keep this PR in draft until its art direction and broad gameplay changes have been playtested against real city data.

## October performance revision

Removed business renaming and the nearby business label. Preserve OSM names and safety eligibility rules. HUD and minimap refresh at 10 Hz while vehicle physics runs each frame. POI lookups use 128 m cells; tile building parsing yields every 128 features and streamed building mesh generation yields every 512 buildings. Simple distance fog replaces the custom height-fog shader. Steel bodywork, reflective courier trim and camera fill lighting improve player readability. Long sessions still accumulate loaded map geometry; tile eviction remains future work.

A paired 90-frame software-WebGL run in the same 403-building offline fixture measured median frame time 416.7 → 250 ms and p95 1049.9 → 600 ms before the final geometry polish. This is a constrained software-renderer comparison, not a hardware FPS guarantee. Run `BENCHMARK=1 npm run test:browser` after a production build to collect timings. Test on the actual device and real city to verify the reported freezes.
