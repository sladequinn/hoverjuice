# Industrial noir art review

Eight screenshot-reviewed rounds, stopping at the requested eight-round limit. Final critic score: **7.0/10**, not the aspirational 9/10.

Rubric: coherence/composition 20%, environment/material depth 25%, vehicle silhouette/readability 20%, lighting/depth 20%, HUD/type 15%. The critic judged actual desktop home, board, car and mobile gameplay captures, not implementation claims.

| Round | Score | Findings and response |
| --- | --- | --- |
| 1 | 4.2 | Flat city blocks, weak vehicle silhouette, oversized HUD, no game imagery on home. |
| 2 | 4.8 | Surface variation helped; chassis and street structure still weak. |
| 3 | 4.0 | Mixed indexed/non-indexed geometry merging dropped chassis parts. |
| 4 | 5.8 | Normalized geometry restored chassis; road ordering and mobile telemetry still needed correction. |
| 5 | 6.1 | Road ordering and mobile overflow resolved; sidewalks and lamps too crude. |
| 6 | 6.3 | Actual in-engine garage home scene; close-up exposed boxy canopy. |
| 7 | 6.8 | Sloped canopy, physical curbs, jointed paving and cantilever lamps improved hierarchy. |
| 8 | 7.0 | Facade relief, curb setbacks, crouched rider, narrower pods and finer garage texture. |

A workspace rollback lost the original round 1–4 screenshots and the unreviewed round-5 images. Scores were retained by the critic; round 5 was restored and freshly captured before scoring. No unseen round was counted. The restored work was checkpointed remotely before continuing.

## Changes

- Shared small procedural grain and soft-disc textures; no fake interior raymarching or per-building label textures.
- Explicit ground/road/marking render order; wet surface variation and subdued lane markings.
- Batched sidewalks and instanced lamps, facade coping, cornices, pilasters and service boxes.
- Merged static vehicle parts, sloped compact canopy, subdued materials and soft hover contact shadows.
- Board rider crouch and gloves; enclosed cars remain headless.
- Compact instrument-style desktop/mobile HUD and shorter dispatch/home text.
- A real garage title render refreshed only on startup/resize, with temporary geometry/material disposal.
- Clamped fallback-city height generation to avoid inverted buildings at outer corners.

## Reproduce and validation

Run `npm run build`, then `ART_ROUND=8 node tests/art-review.cjs`. Captures and metrics go to `.test-artifacts/art-8/`. This harness deliberately blocks map tiles, generating a repeatable offline city. It uses Chromium software WebGL, so it is **not a hardware FPS benchmark or validation of live MVT city appearance**.

Validation passed: production TypeScript/Vite build, 21 unit/server tests, server TypeScript check, browser gameplay checks, zero art-capture JavaScript/shader errors. Browser checks cover movement, overclock, vaults, masks, keyboard test flight, enclosed-car head removal and gang dealer dialogue. Regression tests cover chassis geometry preservation across vehicle classes and nonnegative fallback-city heights.

Final sampled mobile frame: 40 draw calls, 122,144 triangles, 86 geometries, 3 textures, pixel ratio 1. Round 7 had 39 calls and 50,096 triangles. Facade relief adds substantial geometry despite only one additional draw call; representative mobile hardware frame pacing needs measurement before expanding detail further. The production bundle still produces Vite's >500 kB chunk advisory.

## Critic's remaining limitations

The city remains repetitive, with broad empty setbacks and little district identity. Vehicle and courier models still reveal their primitive construction at close range. Lighting lacks alternating pools and material depth. Mobile shows a horizontal road-surface cutoff near the controls. The visual return from facade relief is modest relative to its triangle increase. These are explicitly unresolved at the eight-round stopping point.
