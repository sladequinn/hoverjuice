-- Campaign snapshots remain archived. They are never imported into online accounts.
CREATE TABLE driver_preferences (
 player_id TEXT PRIMARY KEY REFERENCES players(id),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
 payload TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(payload)),
 updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE preference_receipts (
 player_id TEXT NOT NULL REFERENCES players(id),
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,request_id)
) STRICT;
