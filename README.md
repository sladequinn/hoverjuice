# HOVERGHINI

Online hover driving on real streets, built with Three.js, Vite, TypeScript and Cloudflare. Sign in with Google, choose a driver name and enter a city. Existing GitHub players can recover their account and link Google.

The game requires an account and live server connection. Disconnections pause play. There is no offline single-player mode or client-controlled campaign economy.

## Progression

- Earn HG through courier missions and server-simulated freight. Parcel, express and precursor jobs require no starting cash: fees come out of the payout.
- Buy and sell the six Night Market goods across districts. Compare prices, watch supply shocks and haul inventory for profit.
- Spend that server wallet on canonical global property titles. Create crews, establish headquarters and compete for districts.
- Buy vehicles, performance upgrades and masks with HG. Bigger cargo holds unlock bigger trades. Owned properties provide cargo stashes. Refueling and recovery remain free. Casual races have no currency rewards.
- Account autosaves contain only navigation and appearance preferences. Cash, ownership, inventory and rewards cannot be uploaded. Old campaign snapshots remain archived and are not imported.

## Run and verify

Node 24 recommended. A configured Cloudflare host is required for authenticated play; Vite alone provides the frontend.

```sh
npm ci
npm test
npm run check:server
npm run check:cloud
npx playwright install chromium
npm run test:browser
```

## Controls

| Input | Action |
| --- | --- |
| W / S, A / D | Thrust / brake, steer |
| E, Shift, Space | Mag-Lock, boost, rail hop |
| V | Chase / overhead camera |
| J / N | Courier dispatch / Night Market |
| G / K / P / M / H | Garage / masks / properties / city / help |
| F / T | Free refuel at a pump / free tow |
| R | Night Market |

Touch controls offer a steering stick, GO / BRAKE, MAG-LOCK and BOOST. The map supports dragging, zooming and building inspection.

## Deployment

Follow [Google sign-in and online migration](docs/google-online.md), including OAuth credentials and migration `0008_street_progression.sql`. Use the same HTTPS Cloudflare origin for the client and API. GitHub Pages cannot host the account, multiplayer or economy APIs.

See [shared progression and trading](docs/street-progression.md), [global freight](docs/global-economy.md), [property registry](docs/global-properties.md), [crews](docs/crews-territories.md) and [multiplayer](docs/multiplayer.md) for server configuration. These features need their deployment flags enabled. Configure an appropriate HTTPS property/map source for the intended audience.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Vector tiles supplied by [OpenFreeMap](https://openfreemap.org/).

Earlier prototype designs and radio setup notes are preserved in [historical notes](docs/historical-readme.md); their campaign, offline and manual-backup instructions are retired.
