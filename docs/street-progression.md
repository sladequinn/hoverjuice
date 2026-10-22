# Shared progression: courier work, Night Market, garage

Players start with a board, a balaclava, an empty hold and their existing server HG wallet. No campaign cash, old inventory, test funds or saved unlocks are imported.

## Player loop

1. Open Jobs. Choose a sealed parcel, organ express or HJ-77 precursor run and request a route quote. Follow the pickup waypoint, park at the depot, collect the package, and complete the server-driven route before its deadline. No starting cash is required.
2. Open Night Market. Compare nearby districts' sell prices against your local buy quote. Drive to an exchange, park within 180 m at street level, request a quantity quote and confirm it. Haul purchased cargo to another district and sell it. Regional prices, stock and hourly shortages/gluts create opportunities. Quotes include the full order's stock impact, so immediate bulk buy/sell cycles cannot pump prices for profit.
3. Spend the same HG wallet on vehicles, three stages each of drive/handling/efficiency upgrades, masks and existing canonical property titles. Only purchased vehicles and masks can be equipped. Different vehicles have different cargo capacities; an overloaded hold prevents switching to a smaller vehicle.
4. Park within 120 m of an owned active property to stash cargo or withdraw up to your carry capacity. Banked cargo and carried cargo are server inventory. Currency stays in the wallet.

The six original fictional goods return: Cyan-ade, Neon Dust, Ghost Chips, Synth Glands, Black ICE and Sunblood. Their catalogs are separate from sealed freight consignments: the courier package never becomes sellable personal cargo. Gang leaders remain visual points of interest; actual trades use marked district exchanges, not client-generated dealer positions.

## Authority and transactions

`street_accounts` owns inventory, garage entitlements, equipped gear, upgrades and stash contents. `driver_preferences` remains a non-economic save; its appearance hints cannot grant or equip anything. The client loads gear from the authoritative account. Multiplayer publishes that equipped chassis, mask and paint, overriding client-supplied appearance.

All mutating street operations require authentication, same-origin POST, rate limits and a fresh live player connection with parked street-level presence. The API accepts action/item or server quote ID, expected account revision and request ID. It accepts no balance, payout, price, owned-item list or inventory snapshot.

A single `street_receipts` insertion atomically updates the wallet ledger, account state, market stock and dealer reserve through SQLite triggers. A failure rolls everything back. The immutable receipt binds the original request fingerprint and revision. Retrying the identical request returns current authoritative state without repeating the mutation; changed request data is rejected. The client journals requests in an account-scoped durable outbox before sending, and exposes recovery after a lost response.

Trading uses server-priced, account-bound quotes valid for 30 seconds. Market revisions prevent stale concurrent orders from overselling stock. Cash, capacity, stock, inventory and dealer liquidity must all suffice. Player purchases replenish the dealer reserve; player sales draw from it. Migration 0008 initializes finite dealer liquidity of 1,000,000 HG, independent of the existing freight fund. It does not grant player money or introduce a recurring mint.

Cargo trades and stash operations retain a persistent geographic/time budget (45 m/s plus 200 m tolerance), checked across city jumps and reconnects. Normal city travel is disabled while carrying cargo. Free driving still uses existing server movement plausibility checks rather than fully authoritative vehicle physics; this budget prevents instant distant-market sales, not every possible movement cheat. Courier rewards continue to use the server's freight simulation, never client position, elapsed time or completion reports.

## Courier missions

`courier/quote` accepts only origin, destination and mission ID. The server chooses cargo, route, reward and duration. Express jobs receive a premium and tighter timing; precursor jobs use the existing three-impact cargo-loss rule. The timer starts at pickup. Expiry, damage loss, cancellation, reconnect and exactly-once payout reuse the Freight actor and ledger. Courier and freight jobs share the existing six-admissions-per-day limit and finite freight fund; no second reward faucet is added.

## Deployment and limits

Apply migrations through `0008_street_progression.sql` before releasing the new Worker/client together. Enable BACKEND_ENABLED, MULTIPLAYER_ENABLED, PROPERTIES_ENABLED, CREWS_ENABLED and ECONOMY_ENABLED. Inventory must load before the player enters a city. Configure Google OAuth as described in [google-online.md](google-online.md).

Refueling and roadside recovery remain free. Property titles provide stash access and existing freight/HQ benefits, not passive cash minting. There is no client-paid tutorial, pink-slip reward or test-money grant. Player-confiscation and consumable-overclock commands are not part of this transaction release. Legacy modules/tests retained in the repository do not grant online economy state.

Validation includes atomic rollback, double spends, last-stock contention, forged input, quote expiry, cross-account replay, capacity, remote trading, stash access and bulk price-pumping. Runtime tests exercise the actual Worker and WebSocket session with parked presence and server-equipped vehicle publication. Browser coverage verifies online admission, account persistence, restored market/garage/job screens and mobile menus. Real Google authorization and map-source availability still require staging acceptance.
