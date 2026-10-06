# Hoverjuice

Industrial-noir hover courier prototype built with Three.js, Vite and TypeScript. Real streets and buildings stream from OpenFreeMap; the player stays vehicle-bound.

This branch is the **first playable overhaul**, not the complete online campaign. See [implementation status](docs/industrial-noir.md) for implemented systems, limitations and the remaining work.

## Run

Node 24 recommended.

```sh
npm ci
npm run dev
npm run build
npm test
npm run check:server
npx playwright install chromium
npm run test:browser
```

Choose a preset city or use the location button. The explicitly marked simulation grid is available offline. Place search requires the geocoding gateway described below. Progress and local property purchases remain local to this browser.

## Controls

| Input | Action |
| --- | --- |
| W / S | Throttle / brake, reverse when stopped |
| A / D | Tap for a lane snap; hold to choose a junction; steer in Free Hover |
| E | Mag-Lock / Free Hover |
| Shift | Boost |
| Space | Small rail hop |
| Q / touch BURN | Consume one Cyan-ade for 15 seconds at 300 km/h; costs 25 hull |
| F / fuel prompt | Start fueling; press again to pay; throttle away to steal |
| B / U | Bank / withdraw cash and cargo at a garage or owned property |
| V | Chase / overhead camera |
| J / N / G / K / P / M / H | Contracts / market / garage / masks / property / city / help |
| R | Nearby dealer |
| T | Tow to an available fuel depot |

The purple Hoverghini is awarded by a three-lap pink-slip race, gated by $10M net worth and ownership of the tallest loaded building. A contiguous highway-class road loop must exist in the loaded graph. There is no automatic substitute oval.

## Optional online services

- `server/rooms.ts`: PartyKit telemetry rooms. `npm run dev:rooms` starts development rooms. Configure `VITE_PARTYKIT_HOST` to enable them; unset means offline. `#toronto?crew=ironlungs` starts the matching preset and uses a shared crew room.
- `server/schema.sql`: sparse Cloudflare D1 tables for ownership, dead drops, verified speed records and flashpoints.
- `server/api.ts`: read-only ownership/record gateway. Set `VITE_API_BASE` after deploying it. **Global claims, transactions and leaderboard submissions are not enabled.** Never trust localStorage cash or client-supplied race times for global writes.
- Copy `wrangler.example.toml` to `wrangler.toml`, supply the real D1 ID, application origin and contact email, apply the schema, and deploy with your Cloudflare tooling. No account, database or hosting deployment is created by this branch.
- `server/geocoder.ts`: singleton Durable Object, query caching and an application-wide 1.1-second interval between Nominatim requests. Set `public/config.json`'s `geocoder` URL to the deployed `/api/geocode`; this runtime file allows provider changes without rebuilding the client.

Nominatim public service use must follow its [usage policy](https://operations.osmfoundation.org/policies/nominatim/): the maximum is one request/second **across the entire app**, results must be cached, requests must identify the app, and autocomplete/systematic POI extraction are forbidden. Search runs only on explicit form submission. Larger audiences need a suitable hosted or self-hosted Nominatim provider. Presets and browser geolocation work without place search.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Vector tiles supplied by [OpenFreeMap](https://openfreemap.org/).
