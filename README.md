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
| A / D | Tap to slide and buffer a turn for 2.5 seconds; hold to keep it queued; steer in Free Hover |
| E | Mag-Lock / Free Hover |
| Y | Toggle test flight; switches to Free Hover |
| Space / C | Climb / descend while test flight is on (touch: RISE / DESCEND) |
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

## GitHub Pages at slade.ninja

Merge this branch, then open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Keep the existing custom domain and DNS records. The `Deploy Hoverjuice to Pages` workflow builds the app and publishes `dist`; if needed, run it manually from the Actions tab after changing the setting.

Publishing `main` directly from its root serves uncompiled TypeScript and will show an unstyled, nonfunctional page. The default Vite base `/` is correct for `https://slade.ninja/`. A repository-subpath deployment would instead need `/hoverjuice/` as its Vite base. Browser smoke tests use the production build, so run `npm run build` before `npm run test:browser`.

Pages hosts the client only. Address search now defaults to Photon over HTTPS, so no Vercel migration is needed. Search runs only on explicit submission, caches results for the session, and limits repeat requests. Photon’s public endpoint permits reasonable project use but has no availability guarantee: https://github.com/komoot/photon#demo-server. Configure your own provider for larger audiences. Online multiplayer and global persistence still need their own hosting.

## Optional online services

- `server/rooms.ts`: PartyKit telemetry rooms. `npm run dev:rooms` starts development rooms. Configure `VITE_PARTYKIT_HOST` to enable them; unset means offline. `#toronto?crew=ironlungs` starts the matching preset and uses a shared crew room.
- `server/schema.sql`: sparse Cloudflare D1 tables for ownership, dead drops, verified speed records and flashpoints.
- `server/api.ts`: read-only ownership/record gateway. Set `VITE_API_BASE` after deploying it. **Global claims, transactions and leaderboard submissions are not enabled.** Never trust localStorage cash or client-supplied race times for global writes.
- Copy `wrangler.example.toml` to `wrangler.toml`, supply the real D1 ID, application origin and contact email, apply the schema, and deploy with your Cloudflare tooling. No account, database or hosting deployment is created by this branch.
- `server/geocoder.ts`: singleton Durable Object, query caching and an application-wide 1.1-second interval between Nominatim requests. To use this backend instead of Photon, set `public/config.json`'s `geocoder` URL to the deployed `/api/geocode` and `geocoderFormat` to `nominatim`; this runtime file allows provider changes without rebuilding the client.

Nominatim public service use must follow its [usage policy](https://operations.osmfoundation.org/policies/nominatim/): the maximum is one request/second **across the entire app**, results must be cached, requests must identify the app, and autocomplete/systematic POI extraction are forbidden. Search runs only on explicit form submission. Larger audiences need a suitable hosted or self-hosted Nominatim provider. Presets and browser geolocation work without place search.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Vector tiles supplied by [OpenFreeMap](https://openfreemap.org/).

Mag-Lock now assists sharp corners by reducing speed, recentres around lane/footprint overlaps and only releases for heavy traffic impacts, water or manual input. Test flight is a session-only debugging option capped at 250 m above local road height; turning it off returns you toward street height.

Gang leaders trade from parked vehicles: SHINOBI / SLADE, LIARS / WHITE LIE, HYENAS / FASA, JESTERS / FRECKLES (the female clown). Market panels and proximity prompts identify the leader and gang. Eligible commercial sites are still required.

New Game asks “Where’s your couch?”: select an address search result or a random preset district. The selected coordinates and label persist locally as the starter safehouse; its playable entrance is the nearest connected street node. Return to it from Turf & vaults. A new game confirms before replacing existing progress. City travel does not change the saved couch.
