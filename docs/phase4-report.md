# Phase 4 implementation report

## Delivered

- Persistent account-bound crews, private revocable invitations, leader/officer/member permissions, leadership transfer, membership limits and rejoin cooldowns.
- Headquarters authorized against the existing global property registry. Only the owning leader/officer can appoint their title; departure removes HQ use without changing personal ownership.
- Canonical versioned worldwide districts, demand-loaded territory actors, persistent control/history, expiring leases, three-district limits and a rest period between contests.
- One team delivery time-trial format on server-selected OSM public roads: ordered gates, continuous validated movement, bounded speed/altitude, reconnect recovery, two-driver squads and a capped cooperation bonus. Clients cannot submit scores, winners, reputation or wallet changes.
- Atomic, idempotent result/control/reputation settlement; membership generation and HQ eligibility are rechecked at settlement. No-finisher rounds preserve the existing controller and do not renew its lease.
- Crew management UI, per-account command recovery, HQ and district rally travel, nearby car affiliations, district outlines, map markers, in-world delivery gates and non-intrusive progress status. Foreground polling provides geographically scoped cross-session convergence without a global broadcast.
- D1 migration 0004, the Territory DO binding/migration, an opt-in Cloudflare flag and deployment workflow/configuration support. No new package dependency.

Phase 3 is saved in PR #25. Runtime integration during Phase 4 exposed two source-adapter issues: an unbound Worker fetch and unsupported `redirect: 'error'`. Both fixes were also saved to the Phase 3 branch. Manual redirects now reject non-success responses without forwarding source credentials. The new compiled-runtime test exercises the real source adapter through contest admission.

## Verified

Final local verification:

| Check | Result |
| --- | --- |
| Complete Node suite (`npm test`) | 130 passed, 0 failed |
| Complete browser suite (`npm run test:browser`) | All 15 scripts passed |
| Client TypeScript + production build | Passed; existing large bundle warning remains |
| Server TypeScript | Passed |
| Cloudflare Worker build/dry run | Passed |
| Fresh local D1 migration sequence 0000–0004 | Passed |
| Whitespace/diff validation | Passed |

The two-crew settlement test purchases distinct real-registry fixture titles, establishes both HQs, admits both crews, drives ordered routes with virtual server time, and produces one authoritative winner. It injects a database failure to prove rollback, then a post-commit actor storage failure to prove recovery does not duplicate reputation. Actor re-instantiation preserves control and both personal titles.

Separate tests run the actual compiled Cloudflare Worker in Miniflare with authenticated WebSockets and a controlled upstream OSM response. They verify two HQ-backed crews enter the same road contest, reconnect does not duplicate a participant, crew tags come from authenticated membership, and different player sessions read identical control. Database tests cover concurrent last-seat admission, account-bound idempotency, permissions, HQ authorization, removed-member exclusion, global caps, expiration and immutable results. Movement tests cover replay, teleportation, flight and broken continuity. Browser tests cover desktop/mobile creation, invitation presentation, escaping, reload, wallet isolation and layout. Existing property concurrency, multiplayer, cloud-save, local save and gameplay tests remain passing.

Review fixes include canonical district ID enforcement, preservation of control after empty rounds, transactional final membership checks, epoch-safe player contest admission and non-blocking bounded contest forwarding, recovery after a result has committed, and the two Worker source compatibility fixes. No production credentials were used.

## Deployment blockers and limits

- Live Cloudflare deployment and a full ten-minute contest on two physical devices are **not verified**. They require provisioned OAuth/D1/DO/source services and credentials. Follow the staging acceptance procedure in `crews-territories.md` before enabling production.
- Production global-wallet funding is still an operator policy decision inherited from Phase 3. The staging procedure uses explicitly trusted fixture grants; this phase does not mint client rewards or import local cash.
- Movement validation is not authoritative physics. Plausible fabricated poses, bots, multi-account abuse and falsified terrain clearance remain possible. Reputation and rally convenience are deliberately the only benefits; do not attach valuable currency rewards without stronger anti-cheat.
- OSM single-way route selection is intentionally conservative. Sparse/incomplete road data can prevent a contest, and real terrain/bridge usability needs staging inspection. No global simulation or external real-estate API is introduced.
- District reads converge by five-second foreground polling; crew car tags refresh within 30 seconds. Active actors are bounded to 16 drivers, but hotspot load/cost and physical mobile network performance are not production-benchmarked.
- This is one coordinated driving/delivery contest mode. No separate passive influence economy, advanced warfare modes, diplomacy, commodity markets, trading or broader economic simulation is implemented. Phase 5 has not begun.

Configuration, required existing secrets, rollback behaviour, fairness rules, limits and operator checks are in `docs/crews-territories.md`.
