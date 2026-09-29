# Hoverghini

A cyberpunk courier and tycoon simulator that turns any real-world city into a neon playground.
Buildings and streets come live from OpenStreetMap and get rebuilt as extruded, glowing cyber towers.

You start as a broke gutter courier on a leaky hoverboard, run delivery contracts, buy up landmark
real estate for passive income, and work your way up the garage to the ultimate status symbol: the **Hoverghini**.

## Features

- **Any city on Earth, continuously streamed**: real OpenStreetMap vector tiles load from OpenFreeMap's global CDN,
  are cached locally, and expand in the background as you travel. The round minimap opens into a full-city map.
- **Dual-mode flight**
  - **Mag-Lock** snaps you to street conduits. Hold `A`/`D` to choose the branch at the next junction.
    Collision-free and fuel-efficient, with a HUD hint showing which way your route turns.
  - **Free Hover** gives you inertia drifting, `Shift` hyper-boosts and altitude (`Space`/`C`). Towers are solid,
    and higher-tier vehicles can climb over them.
- **Hoverjuice (HJ-77)**: repulsor fuel that evaporates constantly, even when parked. Refuel at turquoise pumps (`F`)
  or call a grav-tow (`T`). Cyan-ade precursor contracts pay big but leak into your tank.
- **Contracts**: Parcel, Express and HJ-77 Precursor jobs with timers, speed tips and late penalties. Pay scales with your vehicle's cargo class.
- **Garage**: Gutter Hoverboard → Neonic → Sky-Duty Z150 → Hovercedes-Benz → Repuls-Royce Goblin → Hoverarrari → Hoverghini.
- **On foot & masks**: hop off your ride and run around as a masked courier. 19 low-poly animal masks to collect.
- **Living streets & combat**: ambient AI hover traffic follows the real road graph. Gang drones patrol the city;
  fire plasma on foot or from any ride and collect a bounty for each drone.
- **Night Market**: six physical dealers are procedurally placed around every city. Trade six fictional contraband
  types across local price differences, timed supply shocks and gluts; cargo capacity depends on your ride.
- **Look**: Hotline Miami-style neon grade, VHS scanlines, chromatic fringe, synthwave sun, rain and neon billboards.
- **Real estate**: buy the city's landmark towers for passive rent per minute. Holdings keep paying in every city.
- Progress autosaves to `localStorage`.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | Thrust / brake (hold `S` when stopped in Mag-Lock to reverse) |
| `A` / `D` | Steer, or pick the junction branch in Mag-Lock |
| `E` | Toggle Mag-Lock / Free Hover |
| `Shift` | Boost (both modes) / sprint on foot |
| `Space` / `C` | Climb / descend (Free Hover), hop (Mag-Lock), jump (on foot) |
| `X` | Hop off / on your ride |
| `V` | Chase / top-down camera |
| `Q` | Fire plasma weapon |
| `N` / `R` | Open the dealer map / trade with a nearby dealer |
| Tap minimap | Open the expanded live city map |
| `F` / `T` | Refuel at pump / grav-tow |
| `J` `G` `K` `P` `M` `H` | Contracts, Garage, Masks, Real estate, Warp, Help |
| Mouse wheel | Camera zoom |

On touch devices, on-screen controls appear automatically: a d-pad in Mag-Lock and an analog stick in Free Hover and on foot. The Garage and Help tabs have a test-funds button for playtesting.

## Running locally

Requires Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:47291
npm run build    # type-check + production build to dist/
```

## Tech

Vite, TypeScript and Three.js (with UnrealBloom post-processing). No backend and no API keys:
map geometry streams as vector tiles from OpenFreeMap and place search uses Nominatim.

Map data © OpenStreetMap contributors, ODbL.
