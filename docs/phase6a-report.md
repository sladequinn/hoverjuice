# Phase 6A implementation report

Implemented swept, mass-aware player/NPC contacts, persistent NPC knockback, swept building-hull checks, physical roadside props, a dedicated six-unit police state machine, road-based pursuit/interception, search/escape and existing local impound integration. Scanner messages now reflect actual police state; impacts and nearby active units produce synthesized audio. Chase-camera damping, look-ahead and bounded impact feedback were improved. Remote players remain ghosted.

Root causes addressed: damage-only NPC overlap; endpoint-only building checks; generic traffic masquerading as police; disconnected scanner narration. Review additionally fixed double-applied forward impulse, compounding parked-car displacement, light-object damage balance, moving roadblock targets, near-road spawn discovery and collision corrections being transmitted one frame late.

## Verified

- 165 automated tests pass, including eleven new collision/police scenarios.
- All eighteen browser scripts pass, covering existing gameplay, startup, terrain, multiplayer, properties, crews, freight and the new physical-world scenario.
- Production client build, server typecheck and whitespace checks pass.
- Actual game-loop crash on desktop/mobile viewports: player remains approximately 1.55 m on the contact side of the NPC, hull falls from 100 to about 75, the NPC receives momentum and camera impact feedback activates.
- New component tests verify fast/glancing impacts, solid barriers, light-prop scattering/breakage, vertical separation, thin facades, parked knockback recovery, observation/stop/pursuit, occluded search/escape, impound, population limits and roadblock holding.
- Scanner regression verifies that high Heat without a police report does not announce a pursuit.

## Performance findings

The development-host browser fixture populates 72 civilian vehicles, two police units and eight props. Measured police/prop/contact CPU work had p95 around 0.3–0.5 ms; observed p99 ranged roughly 0.8–4.4 ms across desktop/mobile viewport runs. These measurements exclude full rendering and player terrain/building updates and are not phone FPS results. Limits remain six police, 48 props and the existing 192-car fleet; meshes are instanced and route/contact work is bounded.

## Remaining limits

Local NPCs and props differ between multiplayer clients; this is not authoritative global policing. Existing server-assisted freight retains its local collision/police exemption to preserve economic movement authority. Ordinary civilian-to-civilian avoidance still uses road queues/junction reservations. The hull solver is an arcade capsule approximation, not exact mesh physics, and police models/prop animations are deliberately simple. Road topology and building geometry errors can require map-specific handling.

No live deployment, physical-phone benchmark or sustained multi-city human pursuit session is claimed. Real-map slopes, bridge/underpass edge cases, audio feel and camera comfort need that playtest. Existing local Heat/damage/impound persistence is retained; police positions and broken props are transient. No economy expansion or additional major phase was started.

See [police-physical-world.md](police-physical-world.md) for behaviour, authority boundaries and acceptance steps. No new Cloudflare settings, secrets or database migrations are required.
