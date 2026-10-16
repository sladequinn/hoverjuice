# Phase 6A: Police and physical world

## Audit and changes

The previous traffic system reported proximity damage but did not separate the player from a car or transfer momentum. Heat made generic traffic hostile; flashing ambient patrols and scanner scripts were not a dedicated police simulation. Buildings largely checked the player's centre at the movement endpoint. Phase 6A replaces those gaps while retaining the existing driving, terrain, traffic queues, local damage/impound and global backend systems.

### Physical contacts

`PhysicalWorld` uses a 16-metre spatial grid and swept relative-motion capsule contacts. Three overlapping discs approximate each vehicle's scaled hull. A contact stops the player at the surface, resolves overlap, applies a mass-weighted impulse with low restitution, and transfers momentum to the NPC. At most four distinct contacts are resolved per update. Different road elevations are separated by height. Police, civilian traffic and roadside objects use the same contact representation; online players are never registered as colliders.

NPC impulses persist through road-following updates. Forward momentum changes road speed; lateral momentum produces a damped displacement. Parked vehicles receive free displacement rather than repeatedly adding the same offset. Struck drivers brake before recovering their routine. Police resolve contacts with civilian traffic, physical props and other police units. Ordinary civilian-to-civilian traffic continues to rely on its existing queue spacing and intersection reservations rather than a full all-pairs rigid-body solver.

Player building checks sweep the hull in increments of at most 0.3 metres, with a 256-step ceiling. Hull rotation is rejected if it would newly intersect a building at the starting position. A blocked movement stops at the last safe sample and rebounds. Existing centre checks remain as a second guard. This is arcade collision, not continuous mesh-level rigid-body physics: extreme initial overlaps, unusual overlapping OSM decks and malformed geometry still require map-specific inspection.

Damage follows transferred impulse, so a light cone does not hurt like concrete. Significant impacts trigger existing damage/particles plus a gesture-unlocked synthesized crunch and a brief, capped camera kick. Camera yaw/position damping is frame-rate independent, look-ahead grows with speed, FOV is bounded, and camera obstruction is rechecked after shake. Reduced-motion preference disables camera shake. The traffic-sound toggle controls horns, impacts and sirens.

### Roadside objects

Up to 48 nearby props occupy checked roadside locations: cones, bins, signs, concrete barriers and benches. Five instanced meshes hold the whole pool. Light objects translate, tumble and settle; sufficiently struck signs break and fall flat. Concrete barriers remain solid. Debris reuses the original instance and adds no particle/body allocation cascade. Water, tunnels, building overlap and large terrain/deck mismatches reject placement.

Props are transient local scene state. Leaving the area or reloading can restore them. They grant no inventory, currency or progression. No pedestrians are made physical damage targets.

### Police and wanted behaviour

Two dedicated patrol units maintain a road-based presence when suitable roads are available. New units appear on connected road nodes 160–450 metres away, never beside the player. One unit is added at most every eight seconds, with a hard cap of six. Existing nearby-road discovery supplies spawn candidates; the system does not scan or simulate other cities.

A unit must see an offence: Heat above 0.4, speed above 30 m/s, or a recent significant crash. Patrol vision is limited by distance, facing, building occlusion and elevation. Two seconds of observation leads to a traffic stop for minor offences or pursuit at Heat 2+. Ignoring a stop for eight seconds while moving above 5 m/s escalates it. Visible detection and evasion raise the existing local Heat value.

Pursuit units route over connected OSM road nodes using bounded searches and follow the last confirmed position. With Heat 4+, additional units can route ahead and hold a physical roadblock position. Units do not teleport to intercept. Unsupported or disconnected routes fall back to road patrol/search behaviour. Police speed is capped at 48 m/s, allowing a fast, well-driven hovercar to escape.

After twelve seconds without visual contact, units search the last known location. After thirty-two seconds without contact, they disengage, clear local Heat and observe a reacquisition cooldown. Seeing the player again during search resumes pursuit. Sustained speed below 2 m/s for four seconds within twelve metres of a unit that can see the player triggers the existing local impound flow: cargo confiscation, $250 local fee, return to the garage and repair. Global funds, inventory contracts and building titles are untouched. A garage no longer clears Heat during an active stop/pursuit/search.

Traffic slows around sirens and dangerous driving. The old Heat-based generic-traffic hostility and cosmetic ambient patrol assignment are removed. The scanner reads actual police messages and updates immediately on state transitions when tuned in. Its fallback reports telemetry without inventing a pursuit, abandoned vehicle or dispatched interception.

## Integration boundaries

This is a responsive local gameplay simulation. NPC pursuit and props are not shared authoritative entities between multiplayer clients. Existing intentional remote-player ghosting remains. Normal local collision corrections are sent through the existing multiplayer movement stream after resolution.

**Phase 5's server-assisted freight keeps its existing collision exemption.** Applying local impulses to a server-controlled courier would contradict its authoritative route and economic verification. Police/physical processing pauses for that local freight mode; normal driving uses the new systems. Adding authoritative freight collisions is a separate networking design, not silently implemented here.

Existing local Heat/hull/impound saves remain intact. Patrol positions and pursuit search timers are transient; reload reconstructs patrols while saved Heat can provoke new detection. No backend endpoints, schema migrations, secrets, dependencies or economy rules were added. Deploy the frontend through the existing workflow after Phase 6; Cloudflare configuration is unchanged.

## Verification and budgets

- Six police, 48 props, existing maximum 192 civilian vehicles.
- At most four contact resolutions per body/update, spatial broadphase and height rejection.
- Police route planning once per second, graph searches limited to 512 nodes; spawns throttled to eight seconds.
- Props reuse nearby road candidates and inspect at most eight candidates per half-second.
- Two instanced police draw calls and five prop draw calls when populated. Paused gameplay does not advance simulation.

`physical-police.test.ts` covers high-speed head-on/glancing contacts, overlap correction, momentum transfer, thin facades, bridge separation, parked-car recovery, prop breaking/solid barriers, visible detection, traffic-stop escalation, search/escape, impound, distant spawns, caps and stationary roadblocks. `physical-world.cjs` drives the actual game loop into an NPC on desktop/mobile layouts and checks position separation, hull loss, transferred momentum and camera feedback. The radio regression checks that Heat alone cannot invent a pursuit. Existing gameplay and backend suites remain enabled.

For human playtesting, repeat head-on/rear/side collisions with a board, car and truck; scrape buildings at speed; hit light props and concrete; obey a stop, then separately evade one through turns/occlusion; provoke reinforcements; escape; and verify impound. Repeat on sloped roads and elevated decks in several real cities. Check mobile FPS, input latency and audio after a touch gesture. The browser fixture uses a procedural map because the remote provider is blocked in the test; it does not prove every real-world road layout or physical-phone performance.
