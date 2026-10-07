# Sidewalk junction and streetlight correction

The previous width change left three separate defects: endpoint-based trimming missed intersections without a shared graph node; overlapping tile strips rendered multiple pavement surfaces; a 40 km ground plane wrote depth over raised streets at some camera angles. Lamps were placed once per map segment, creating clusters on short segments.

Pavement now subtracts nearby road footprints, buildings and previously accepted pavement with integer-centimetre polygon clipping. Curbs use the resulting boundaries, including holes. This removes pavement across road mouths without relying on graph-node identity. Invalidly narrow corridors and bridge/tunnel spans do not receive pavement.

Lamp candidates use 32 m world-distance stations. Their entire footplate must fit surviving pavement, and accepted lamps are at least 22 m apart. Light pools are smaller and dimmer. The ground remains visible and depth-tested, but does not write depth that can hide the street surfaces.

Streamed road/pavement rebuilds yield every 16 road records. Old geometry remains displayed until the replacement is complete, then its resources are disposed and the driving index swaps with the visual geometry.

## Validation

- Production build and browser gameplay smoke checks pass.
- 28 tests cover un-noded T junctions, duplicate strips, holes, lamp spacing/footplates, existing driving behavior and captured Kitchener geometry.
- `tests/fixtures/kitchener-pavement.json` contains 36 road features and 37 building footprints from OpenFreeMap's October 4, 2026 tile archive. Source/ODbL attribution is embedded in the fixture.
- Desktop, mobile and overhead junction captures were checked against actual Kitchener MVT data at 43.4516, -80.4925, not just the procedural grid. Before/after diagnostics confirmed that removing ground depth writes restores surfaces hidden at the same desktop camera angle.
- The final streamed capture loaded two Kitchener sectors (1,075 road records) with no captured JavaScript/shader errors. It sampled 91 draw calls and 843,500 triangles across the full scene; these are workload counts, not measured phone FPS.
- Floating-point polygon clipping failed on nearly coincident real tile edges during development. The shipped implementation uses integer clipping; the captured fixture guards that case.

For the normal offline capture run `npm run build && ART_ROUND=pavement node tests/art-review.cjs`. For recorded real tiles, set `TILE_FIXTURE` to a directory containing `tilejson.json` and `14_x_y.pbf` files; the harness asserts that the game did not fall back to its procedural city. Captures remain software-WebGL visual checks, not mobile hardware frame-rate measurements.
