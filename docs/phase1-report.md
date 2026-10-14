# Phase 1 implementation report

## Implemented

- Audited existing gameplay, local saves/economy, Cloudflare scaffolding and PartyKit relay.
- Added stable player UUIDs with GitHub OAuth, PKCE, browser-bound single-use state, hashed/revocable sessions and same-origin write protection.
- Added manual account-scoped legacy cloud saves, optimistic revision checks, durable retry outbox, idempotent receipts, cross-account protection and pre-restore local recovery.
- Added a separate zero-start global wallet, integer balances and an immutable ledger with atomic/idempotent trusted server transactions. Public clients cannot submit balances or rewards.
- Preserved offline/local gameplay, save key, existing world read routes, geocoder and GitHub Pages workflow.
- Added Cloudflare assets configuration, versioned D1 migrations, cleanup schedule, deployment scripts/manual workflow, static security headers and sanitized request correlation.
- Documented required secrets, deployment/rollback, trust boundaries, safe migration and proposed future registry/crew/territory/market schemas.

## Verification

- 83 Node tests, including 21 new backend/client tests (real Miniflare D1 SQL/trigger coverage).
- All 12 browser scripts passed, covering existing gameplay and the new title/account/upload/restore/recovery flow. The account test was rerun after the final login-preflight fix.
- Frontend production build and server TypeScript check passed.
- Wrangler deployment dry-run bundled the Worker and assets successfully.
- Both D1 migrations applied successfully with Wrangler to a local database.
- The compiled Worker ran in Miniflare: authenticated-route rejection, refusal of wallet writes, asset delegation and public radio reads passed.
- `git diff --check` passed.

Wrangler's interactive `dev` launcher failed in this container with `uv_interface_addresses`; compiled Worker execution and local D1 tests were verified independently. Real GitHub responses are mocked in automated auth tests. No production Cloudflare resources or live OAuth sign-in were used.

## Critical review fixes

- Bound save writes to the active player ID to close an account-switch race.
- Preserved pending uploads across failures/reloads and rejected changed-data idempotency keys.
- Verified rollback after failures injected between save receipt/data writes and ledger/balance writes.
- Rechecked account and cloud revision immediately before restore; abort on local-backup storage failure.
- Fixed the pre-city menu guard so cloud recovery is reachable from the title screen.
- Fixed native browser fetch binding, which Node mocks did not expose.
- Added sign-in preflight so disabled/static-only hosts keep players in the game instead of navigating to a dead auth page.
- Kept local recovery copies intact so a second storage failure cannot interrupt a completed recovery write.

## Deferred and blocked

Deployment requires the operator's Cloudflare account/database/domain, GitHub OAuth app/secret and live staging acceptance. Existing databases need schema inspection before reuse. Production rate protection, monitoring and data-retention policy remain operator launch gates.

Existing gameplay money and progression remain legacy/local, even when backed up in the cloud. Authoritative gameplay reward/spending integration is not enabled. Authenticated geographic sessions, global ownership, persistent crews, territories, markets, payments and monetisation are deferred. Phase 2 has not begun.
