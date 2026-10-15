# Phase 6: Living Cities

## What changes while cruising

Cities retain the existing pooled traffic and vehicle physics. Up to four nearby mapped businesses now join fuel stops and gang dealers as destinations, using the same checked roadside parking and safe merge-out behaviour. Visitor trips use a bounded connected-road search instead of relying solely on greedy turns; unreachable trips are declined. Commercial and residential streets run slower than industrial corridors. Visitors dwell longer around industrial and residential destinations. Existing junction queues, clearance checks, horns, near misses, terrain profiles and congestion responses remain in place.

A new `CityLife` layer reads actual land-use polygons and nearby venue tags. Residential areas emphasize errands and quieter nights; commercial areas have more daytime/rush-hour foot traffic; industrial areas have fewer pedestrians and freight activity; nightlife areas become busier after hours. Time is approximate local solar time derived from longitude and UTC, independent of the player's device timezone. The game's stylized night lighting is unchanged. Missing tags produce a conservative residential fallback. No city names or boundaries are hardcoded.

Pedestrians walk and pause on short, prevalidated roadside segments. They retreat along those segments when a fast or hot player approaches. Water, building intersections, tunnels and large road/ground height differences exclude paths. They are cosmetic, non-colliding figures, not combat targets. The initial low-poly models have distinct clothing/skin tones and a lightweight walking bob; full skeletal animation and street crossing are not included.

After a short cruising interval, the director may propose an incident: a stalled car with flashing hazards, an arriving delivery, an after-hours curbside meet or a flashing patrol. It must recruit a nearby existing traffic agent; deliveries and meets also need valid parking. No vehicle is created or teleported to perform an event. Proposals without a performer are silent. A stalled vehicle slows its queue; stopping within 18 metres for three seconds helps clear it early, with a brief acknowledgement and no payout. Incidents otherwise expire, and a 65–99 second quiet interval separates proposals. The ordinary road/queue rules still govern their participants.

Heat makes civilians cautious and existing enforcement-class traffic more aggressive. Familiar local gang reputation and a player's live controlling crew increase the tolerance threshold. Controlled districts show a small selection of crew-coloured vehicles/pedestrians and a HUD description; contested districts favour patrol activity. Crew data is the existing authenticated server response, accepted only for the current matching district and an unexpired control lease. A tracked contest in another city cannot recolour local streets.

## Authority and persistence

Ambient people, traffic and incidents remain local simulations, as existing NPC traffic already was. They are not shared NPC entities and may differ between multiplayer clients. Their geometry is never used to verify freight, territory scores or wallet payouts. The Phase 5 server-input freight model, all global ownership, memberships and economic records are unchanged. No new endpoint, migration, dependency, secret or Cloudflare binding is needed.

The only new persistence is a bounded 64-entry local incident cooldown journal (`hoverghini.city-life.v1`). Stable geographic keys suppress immediate incident repetition after refresh or city travel for ten minutes. Malformed/blocked/quota-exceeded storage degrades to in-memory behaviour. This journal contains no currency, inventory or ownership and is intentionally not uploaded as authoritative history. Helping a driver only clears local traffic sooner; there is no reward to farm.

## Performance design

- Existing traffic cap remains 192, with three instanced fleet meshes. No extra traffic actors are allocated for incidents.
- Foot traffic is capped at 24 and adds one instanced draw call. Geometry/materials are allocated once per city and disposed on travel.
- Pedestrian simulation runs at 10 Hz and pauses with the game. It inspects at most 12 road candidates per tick, reusing the traffic system's nearby-node discovery. Existing distant figures recycle outside 180 metres.
- Land-use classification checks at most 32 polygons per second, each capped at 512 vertices, and at most 256 fallback venues. Large/late-streamed datasets converge over successive samples rather than blocking startup. Crossing 100 metres restarts local classification. Source-tag sparsity and this bounded scan can delay the displayed mood.
- New ordinary destination searches are limited to two per half-second, 256 explored nodes each. Unsupported/disconnected/over-budget trips are declined and cooled down.
- With living-city integration active, traffic beyond 500 metres skips fine movement/render work; the existing recycling logic brings cars into the neighbourhood outside the near field. Existing full road candidate scanning remains an optimization opportunity on exceptionally large loaded maps.
- No new downloads, startup await, global timers or background planetary simulation. No per-frame server calls are introduced.

The browser scenario reports combined traffic plus city-life CPU update percentiles to `.test-artifacts/phase6-performance.json`. This is a headless Chromium/software-rendering scenario on the development host, with desktop/mobile viewport layouts; it is not a physical phone GPU benchmark or an FPS guarantee. See the implementation report for measured results.

## Verification and manual checks

Run `npm test`, `npm run build`, `npm run check:server`, and `npm run test:browser`. New `living-cities.test.ts` covers land use/time, population/work budgets, pause, unsafe paths, bounded/reloadable incident memory, vehicle stop/recovery, help/expiry, crew presentation and connected routing. `living-cities.cjs` tests the actual game with the network map provider unavailable, in desktop/mobile layouts, checks unchanged local cash/cargo, records CPU timings and captures screenshots. Existing suites exercise driving, traffic junctions, startup, terrain, multiplayer, properties, crews and freight.

For real-map playtesting, cruise residential streets, a shopping area and an industrial district for several minutes. Observe visits, queues and hazard clearance; slow beside a stalled vehicle. Accelerate near pedestrians, then stop and watch routines resume. Enter/leave a controlled district and compare appearance against another account, allowing the existing crew poll interval. Pause, refresh and travel elsewhere; verify cooldowns, disposal and ordinary saving. Repeat on a physical mobile device with terrain streaming active and economy enabled.

## Deliberate limits

This is a lightweight ambient simulation, not a complete shared civilian population. Pedestrians do not cross streets or enter interiors. Patrol identity is stylized, using existing fleet geometry and colour signals; no new pursuit/combat system is introduced. Incidents offer local reactions and roadside assistance, not economic contracts. Existing NPC cars remain locally simulated during multiplayer; authoritative freight continues to ignore local traffic damage. Behaviour depends on available OSM tags and safe stopping geometry. Live-device smoothness and the subjective feel of long real-city drives still need human playtesting; automated scenario success alone does not establish either.
