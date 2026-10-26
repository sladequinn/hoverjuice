# HOVERGHINI — Vanilla TypeScript Restoration, Art Round 9+, World Streaming & Gameplay Polish

This plan strips out the auto-imported React wrapper to restore **HOVERGHINI**'s pure zero-framework TypeScript + Three.js + Cloudflare Worker architecture, then delivers Art Review Round 9+ visual and triangle-budget improvements, MVT waterway ribbons and distant-sector eviction, Glitcher mask overlays and road segment time trials, and full verification across the existing test and server gates.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All choices below reflect your confirmed selections and preserve your live Cloudflare Worker (`hoverghini-staging.sladebquinn.workers.dev`), D1 migrations (`0000`–`0008`), and online-only progression invariants without adding any framework dependencies or client-side economy spoofing.

- **Confirmed Decision 1 — Pure Vanilla TypeScript Restoration**: Remove `react`, `react-dom`, `@vitejs/plugin-react`, and the wrapper components, restoring the original DOM + Three.js entry flow and test compatibility while keeping the Vite preview port on `3000` for workspace previewing.
- **Confirmed Decision 2 — Art Review Round 9+ (Triangle Budget, Silhouettes, Lighting Pools & Mobile Road Fix)**: Cut the Round 8 facade trim spike (122k → ~60k triangles) by moving repetitive vertical pilasters into the world-space facade shader, sculpt multi-part beveled silhouettes for the `truck`, `luxury`, and `super` vehicles, add rhythmic streetlamp ground/facade light pools and subtle district atmosphere, and resolve the portrait mobile road-surface cutoff near the bottom touch controls.
- **Confirmed Decision 3 — World Polish (Waterway Ribbons & Sector Eviction)**: Ingest `waterway` centerlines (`river`, `canal`) alongside polygon water bodies, and evict streamed MVT building/road geometry chunks beyond 2.5 km so long sessions remain within mobile memory budgets.
- **Confirmed Decision 4 — Gameplay Features & Verification Gate**: Implement functional Glitcher mask patrol/hazard overlays, rotating rooftop owner-mask holograms on owned titles, timed arterial road segments with ghost playback, and pass all `npm test`, `npm run check:server`, `npm run balance:economy`, and `npm run build` checks.

---

## 1. Overview & Core Concept

- **What It Does**: Restores HOVERGHINI's native vanilla TypeScript + Three.js engine and advances the visual, spatial, and gameplay frontier from the Round 8 art baseline and Phase 5/8 online progression baseline.
- **Target Audience / Persona**: Players driving and trading across real OpenStreetMap cities on desktop and mobile devices connected to the Cloudflare Worker backend.
- **Key Value**: Eliminates unnecessary framework bloat, cuts mobile triangle overhead by ~50% while elevating close-range vehicle and street lighting fidelity, prevents long-session geometry leaks, and brings mask perks and road time-trial segments to life.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Clean Native Ignition**: The title screen renders the 3D garage/alley preview directly on `#scene`, connects to the authoritative account session, and deploys into streamed OpenStreetMap cities without React wrapper overhead.
  2. **Art Round 9+ Street & Vehicle Readability**:
     - Every vehicle class (`board`, `compact`, `truck`, `luxury`, `super`) exhibits a cohesive composite silhouette with beveled bodywork, recessed thruster housings, distinct canopy glass, and grounded contact shadows.
     - Driving down streets at night reveals alternating warm sodium-amber streetlamp pools on wet asphalt and subtle district color temperature shifts across building windows and storefronts.
     - On mobile portrait screens (`430×932`), the camera near-plane and road ribbon draping extend cleanly beneath the bottom HUD and touch controls with zero horizontal cutoff.
  3. **Seamless Long-Distance City Streaming & Waterways**:
     - Rivers and canals mapped as OSM centerlines render as recessed water channels with concrete retaining walls.
     - Driving across multiple kilometres automatically prunes distant building and road batches outside the active radius while keeping the navigation graph and minimap responsive.
  4. **Glitcher Mask & Road Segment Trials**:
     - Equipping the **Glitcher** mask reveals traffic/patrol interception cones on the street and minimap, plus high-value supply shock highlights.
     - Owned buildings display a rotating rooftop hologram of the owner's equipped mask.
     - Entering marked arterial road segments triggers a live split timer against the segment's target/best time, accompanied by a translucent ghost hovercar of the previous best run and Flow bonuses for curb-scrape near misses.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: **Industrial Noir**—ACES filmic tone mapping (`exposure: 1.0`), wet asphalt puddle roughness modulation, dark concrete/steel architecture, warm sodium streetlamps (`#ffb35b`), and turquoise Mag-Lock propulsion (`#00f0ff`).
  - *Color Palette & Mood*:
    - `--bg`: Translucent dark slate (`rgba(18, 21, 28, 0.84)`) over deep asphalt (`#08090c`).
    - `--cyan`: Mag-Lock & HJ-77 telemetry (`#00f0ff`).
    - `--gold` / `--pink`: Sodium amber highlights and currency readouts (`#ff9d00`).
    - `--red`: Hull impact, heat alerts, and low-fuel warnings (`#ff3b5c`).
  - *Typography & Hierarchy*: `Orbitron` for numeric instrument clusters, speedometers, and timers; `Rajdhani` for dispatch cards, Night Market quotes, and navigation labels.
  - *Component Styling & Layout*: Compact instrument-grade corner HUD panels with unobstructed center viewport framing across both `1440×900` desktop and `430×932` mobile viewports.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Shader-Driven Facade Relief vs. Instanced Pilaster Boxes**
  - *Chosen Approach*: Replace the per-10m vertical box instances (`bi % 3 === 0` loop in `buildBuildings`) with procedural vertical pilaster ribs and window-sill relief inside `facadeMaterial`, reserving physical 3D instanced cornice/canopy trims for primary street-facing edges (`trimCount <= 1200`).
  - *Why*: Round 8's 6,000 instanced boxes added ~72,000 triangles for minimal silhouette change. Moving fine surface relief into the fragment shader preserves the 1-draw-call budget and cuts mobile triangle counts back toward ~60k while freeing GPU headroom for richer lighting pools and vehicle meshes.

- **Decision 2: Chunk-Indexed World Streaming & Eviction**
  - *Chosen Approach*: Tag streamed building and road batches by their origin sector/chunk coordinate and dispose batches whose center exceeds `2.5 km` from the player during `streamMap` ticks.
  - *Why*: Prevents unbounded WebGL buffer growth during cross-city freight and courier runs without hitching the main frame loop.

- **Decision 3: Non-Economic Road Segment Trials**
  - *Chosen Approach*: Keep road segment time trials and ghost replays strictly focused on skill timing, HUD crown status, and local/session Flow multipliers—never minting unverified client currency.
  - *Why*: Respects the core Phase 5/8 security invariant that all HG wallet credits come exclusively from authoritative server receipts (`street_receipts` and `Freight` Durable Object settlements).

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Native DOM & Three.js Client (index.html)                 │
├──────────────────────┬───────────────────────────┬──────────────────────────┤
│  WebGL Scene Pass    │    Instrument HUD & Map   │   Authoritative Modals   │
│  ├─ ACES ToneMapped  │    ├─ 10 Hz Telemetry     │   ├─ Courier & Freight   │
│  ├─ Warm/Cool Lights │    ├─ 2D Canvas Minimap   │   ├─ Night Market & Stash│
│  ├─ AlleyPreview     │    ├─ Full-Map Inspector  │   ├─ Garage & Masks      │
│  └─ Ghost & Holo FX  │    └─ Touch Stick/Pedals  │   └─ Crews & Properties  │
└──────────┬───────────┴─────────────┬─────────────┴────────────┬─────────────┘
           │                         │                          │
           ▼                         ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Core Simulation & World Engine                       │
│  ├─ Vehicle Physics: Sculpted 5-Class Meshes · Curb-Scrape Flow · Mag-Lock  │
│  ├─ World Builder: Shader Facade Relief · Light Pools · Waterway Ribbons    │
│  ├─ Tile Streamer: z14 MVT Ingestion · Stitched Spans · >2.5km Eviction     │
│  └─ Gameplay Systems: Glitcher Cones · Rooftop Mask Holos · Segment Ghosts  │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│          Cloudflare Worker + D1 + Durable Objects (/server/api.ts)          │
│  ├─ Google & GitHub OAuth · Revision-Checked Preferences Outbox             │
│  ├─ Street Accounts & Atomic SQLite Receipt Triggers (0008_street)          │
│  └─ Durable Objects: PlayerSession · GeoCell · Freight · Territory · Race   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Sculpted Vehicle Meshes (`VehicleSpec` -> `THREE.Group`)**: All five vehicle classes (`board`, `compact`, `truck`, `luxury`, `super`) merge static geometry by material (`body`, `dark`, `glass`, `glow`) into 4 batched meshes per vehicle, keeping draw calls constant while upgrading `truck`, `luxury`, and `super` with multi-part beveled cabs, wheel/thruster fairings, rear diffusers, and light bars.
- **Streamed Sector Lifecycle (`CityData` & `World`)**: Tracks sector-scoped `THREE.Group` batches for buildings, roofs, trims, and water ribbons so distant sectors can be cleanly removed and disposed (`geometry.dispose()`) when out of range.
- **Road Segment & Ghost State (`SegmentTrial`)**: Defines named arterial sprint segments from connected major road nodes, recording `10 Hz` pose samples (`x, y, z, heading`) for personal-best ghost playback and HUD split comparisons.

### Interactive Component & State Mapping

- **Camera & Mobile Viewport Framing**:
  - Adjusts camera vertical target offset and ground backdrop/road stencil ordering on high-aspect portrait viewports so road geometry extends flush to the bottom edge of the screen behind the touch controls.
- **Glitcher Mask & Rooftop Holograms**:
  - When `save.mask === 'glitcher'`, `TrafficSystem` and `NavigationMap` render translucent forward detection cones on patrol vehicles and highlight high-spread market districts.
  - When `properties.items` or local landmarks are owned in the active city, `World` attaches a spinning wireframe/hologram of the player's equipped mask above the building centroid.
- **Verification & Quality Gates**:
  - Executes `npm test` (unit, backend, economy, crews, properties, street progression, customization, traffic), `npm run check:server`, `npm run balance:economy`, and `npm run build` to verify zero TypeScript, Worker, or gameplay regressions.
