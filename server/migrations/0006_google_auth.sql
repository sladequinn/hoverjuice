-- Bind OAuth attempts to their provider and optional existing session. Never link by email.
CREATE TABLE google_oauth_attempts (
 state_hash TEXT PRIMARY KEY,
 verifier TEXT NOT NULL,
 nonce TEXT NOT NULL,
 link_player TEXT REFERENCES players(id),
 link_session_hash TEXT,
 expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX google_oauth_expiry ON google_oauth_attempts(expires_at);
