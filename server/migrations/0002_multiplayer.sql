ALTER TABLE players ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
CREATE TABLE multiplayer_invites (
 code TEXT PRIMARY KEY,
 lat REAL NOT NULL,
 lon REAL NOT NULL,
 race_id TEXT,
 expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX multiplayer_invite_expiry ON multiplayer_invites(expires_at);
