# Phase 6 implementation report

## Implemented

Living Cities builds on the merged Phase 5 source without changing backend authority. Existing traffic gains nearby business destinations, bounded connected routes, neighbourhood speeds/dwell times and a limited assignment budget. A new local director supplies geography/time-based activity, up to 24 pooled sidewalk pedestrians, heat/reputation/crew reactions, and occasional breakdown, delivery, curbside-meet and patrol scenes using existing vehicles. Stopping to assist a stalled driver clears the lane early. A bounded local cooldown journal prevents immediate repeats after reload.

No dependencies, migrations, Cloudflare configuration, economy changes or unrelated progression were introduced. Existing global wallets, property titles, crews, multiplayer authentication and server-simulated freight remain authoritative and unchanged.

## Verification

- Full automated suite: 154 tests passed, including nine new Living Cities scenarios.
- All 17 browser scripts passed, including desktop/mobile Living Cities, single-player UI, startup, terrain, multiplayer, properties, crews and economy.
- Client production build and server typecheck passed. `git diff --check` passed.
- Connected/disconnected routing, junction fairness, queue spacing and merge-out regression tests passed.
- New checks exercise changing neighbourhoods in one session, geographic local time, bounded populations/work, unsafe geometry rejection, pause, incident expiry/assistance, actual stalled-car recovery, crew presentation and persistence/storage failure.
- Browser scenario confirms local cash/cargo remain unchanged and no mobile page overflow. Close-up and mobile screenshots were inspected.

## Performance findings

The automated cruising fixture used 72 existing traffic vehicles, four safe pedestrian paths and one additional instanced draw call. Over 600 combined traffic/ambient updates in headless Chromium:

| Layout | Median CPU update | p95 | p99 |
|---|---:|---:|---:|
| Desktop | 0.10 ms | 0.30 ms | 1.00 ms |
| Mobile viewport | 0.10 ms | 0.40 ms | 1.20 ms |

These are development-host CPU measurements, not real-phone FPS. The fixture has no mapped land-use polygons; separate unit scenarios cover classification and a 10,000-node map with fixed per-tick discovery budgets. Dense real-city GPU costs, long streaming drives and physical mobile thermals remain unmeasured. The pedestrian cap is 24, road checks are at most 12 per 10 Hz tick, and land-use checks at most 32 polygons per second. No added network request or startup await is required.

## Critical review

The strongest improvement is behaviour: vehicles have reachable stopping destinations, blocked lanes clear, pedestrians react within safe paths, and crew/local reputation changes the neighbourhood's response. It adds reasons to watch the streets without accepting a contract. The scene director is deliberately sparse instead of continuously spawning spectacle.

Review fixed announcements without performers, unsupported incident parking/routes, greedy trip loops, repeat assignment starvation, local discovery latency by reusing existing nearby-road candidates, and same-location incident recovery. Pedestrian clothing was separated visually from skin and trousers after screenshot inspection.

The result is an incremental living-city layer, not a complete shared NPC simulation. Pedestrians do not cross roads or enter interiors; patrols retain simple existing fleet geometry. NPC activity is local and may differ between multiplayer clients. Land-use classification can take several samples on large datasets, and sparse/unsafe maps remain quieter. Full skeletal animation, synchronized NPC incidents and physical-device real-city playtesting are deferred. No additional major phase was started.

## Delivery

See [living-cities.md](living-cities.md) for behaviour, persistence boundaries, budgets and manual acceptance steps. Deploy through the existing frontend/Cloudflare workflow after merging the Phase 5 prerequisite. No new secrets or database operations are necessary for this phase.
