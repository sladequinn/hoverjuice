# Google sign-in and online-only admission

HOVERGHINI now requires an authenticated account and an available backend before entering a city. Google is the main sign-in. A real-time city connection is required to advance the simulation; losing that connection pauses the game. Map failures do not start a simulation grid. The local save key is no longer loaded or written by the game.

## Activate on staging

1. In [Google Auth Platform](https://console.cloud.google.com/auth/clients), configure the application audience/branding and create an OAuth client of type **Web application**. While the consent screen is in Testing, add the Google accounts that will test the game.
2. Add this exact authorized redirect URI:
   `https://hoverghini-staging.sladebquinn.workers.dev/api/auth/google/callback`
3. In the repository's **staging** environment, add variable `GOOGLE_CLIENT_ID` and secret `GOOGLE_CLIENT_SECRET`. Do not put the secret into a variable, source file, frontend build, or chat. Keep `MULTIPLAYER_ENABLED=true`.
4. Merge this change and run **Deploy HOVERGHINI to Cloudflare** for staging. Configuration checks now run before the long test suite. The workflow applies migration `0006_google_auth.sql`, deploys the app, and installs the Google Worker secret. Until the final secret step succeeds, the title screen reports that Google sign-in is being configured.
5. Verify Google sign-in, choose a driver name, enter a city, and check progress from a second device. Disconnect the network and confirm that controls pause. Reconnect and confirm recovery. Test a changed/expired session and a conflicting save.

For production, register `APP_ORIGIN + /api/auth/google/callback` with Google and configure the production environment separately. The HTTPS Worker must serve both the frontend and `/api/*`. Static GitHub Pages hosting cannot run the online game; the retired Pages workflow is manual-only so merging cannot publish an unusable replacement at the old domain. Move the public domain to the Worker before public rollout.

## Existing players

An existing GitHub player should use **Your account → Existing GitHub player? → Recover GitHub account**, then **Link Google to this account**. Keep the existing optional `OAUTH_CLIENT_ID` and deployed `GITHUB_CLIENT_SECRET` during this transition. The legacy callback remains `/api/auth/callback`.

Linking requires both a valid existing session and a fresh Google authorization. It preserves the player UUID, wallet, properties, crew and saves. An already-owned Google identity is rejected instead of merging accounts. Names and email addresses are never used for linking. A fresh Google sign-in without linking creates its own player. The OAuth scope is only `openid`; the player chooses a public name separately.

Existing account backups load automatically. Old device-only saves are left untouched but are not automatically imported into a new account. Sign-out flushes pending changes before leaving. Manual backup/restore and destructive reset controls are removed from the player UI.

## Persistence and concurrency

`OnlineSession` serializes automatic writes through the existing revision-checked save API and account-scoped durable outbox. Lost responses retry the same request ID. A later device revision stops play and offers an explicit reload of the current account save. Discarded conflicting outboxes are archived on the device before reload. Navigation warns while a save is pending. Offline play never resumes from a local snapshot.

**This change is online admission, authentication and account persistence, not the complete economy migration.** The original campaign's jobs, purchases, garage, cargo and money still run on the client and are saved as untrusted campaign snapshots. The global wallet, canonical property purchases and freight economy retain their existing server-side validation. No campaign cash, test funds or saved inventory is credited into the shared economy. Collapsing those balances without moving every reward and purchase to validated server commands would introduce an unlimited-money exploit. A follow-up must replace campaign mutations with authoritative commands before advertising one unified competitive economy.

## Verification

- `npm test`: existing unit/integration tests plus real RSA-signed Google OAuth fixtures and autosave/reconnect/conflict tests.
- `npm run check:server`, `npm run check:cloud`: server types and Worker bundling.
- `npm run test:browser`: current online admission/account flow, no offline fallback, autosaves, profile creation, connection/conflict handling and mobile/desktop menu coverage. API responses are explicit test fixtures; real Google authorization remains a staging acceptance check.
- `npm run test:browser:legacy`: retained historical browser scripts built around anonymous offline/simulation-grid entry. These are not the online release gate and require migration before reuse. Unit tests for driving, city geometry, properties, crews, freight and server transactions remain in the regular gate.

Security reference: https://developers.google.com/identity/openid-connect/openid-connect
