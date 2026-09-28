# Hoverghini

A cyberpunk courier and tycoon simulator that turns any real-world city into a neon playground.
Buildings and streets come live from OpenStreetMap and get rebuilt as extruded, glowing cyber towers.

You start as a broke gutter courier on a leaky hoverboard, run delivery contracts, buy up landmark
real estate for passive income, and work your way up the garage to the ultimate status symbol: the **Hoverghini**.

## Features

- **Any city on Earth**: pick a preset hot zone (Tokyo, New York, Hong Kong, Seoul, Dubai…) or search any place.
  Map data is fetched from the Overpass API; if it is unreachable a procedural simulation grid is generated instead.
- **Dual-mode flight**
  - **Mag-Lock** snaps you to street conduits. Hold `A`/`D` to choose the branch at the next junction.
    Collision-free and fuel-efficient, with a HUD hint showing which way your route turns.
  - **Free Hover** gives you inertia drifting, `Shift` hyper-boosts and altitude (`Space`/`C`). Towers are solid,
    and higher-tier vehicles can climb over them.
- **Hoverjuice (HJ-77)**: repulsor fuel that evaporates constantly, even when parked. Refuel at turquoise pumps (`F`)
  or call a grav-tow (`T`). Cyan-ade precursor contracts pay big but leak into your tank.
- **Contracts**: Parcel, Express and HJ-77 Precursor jobs with timers, speed tips and late penalties. Pay scales with your vehicle's cargo class.
- **Garage**: Gutter Hoverboard → Neonic → Sky-Duty Z150 → Hovercedes-Benz → Repuls-Royce Goblin → Hoverarrari → Hoverghini.
- **Real estate**: buy the city's landmark towers for passive rent per minute. Holdings keep paying in every city.
- Progress autosaves to `localStorage`.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | Thrust / brake (hold `S` when stopped in Mag-Lock to reverse) |
| `A` / `D` | Steer, or pick the junction branch in Mag-Lock |
| `E` | Toggle Mag-Lock / Free Hover |
| `Shift` | Hyper-boost (Free Hover) |
| `Space` / `C` | Climb / descend (Free Hover) |
| `F` / `T` | Refuel at pump / grav-tow |
| `J` `G` `P` `M` `H` | Contracts, Garage, Real estate, Warp, Help |
| Mouse wheel | Camera zoom |

On touch devices, on-screen controls appear automatically.

## Running locally

Requires Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:47291
npm run build    # type-check + production build to dist/
```

## Tech

Vite, TypeScript and Three.js (with UnrealBloom post-processing). No backend and no API keys:
map data comes from public OpenStreetMap services (Overpass for geometry, Nominatim for search).

Map data © OpenStreetMap contributors, ODbL.
