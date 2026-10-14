-- Sparse global state: no unclaimed OSM building catalog and no client coordinates at rest.
CREATE TABLE IF NOT EXISTS ownership (
 building_id TEXT PRIMARY KEY, tile TEXT NOT NULL, owner_id TEXT NOT NULL,
 gang TEXT NOT NULL CHECK(gang IN ('SHINOBI','LIARS','HYENAS','JESTERS')),
 claimed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS ownership_tile ON ownership(tile);
CREATE TABLE IF NOT EXISTS dead_drops (
 id TEXT PRIMARY KEY, tile TEXT NOT NULL, owner_id TEXT NOT NULL, cargo_json TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dead_drops_tile ON dead_drops(tile);
CREATE TABLE IF NOT EXISTS speed_records (
 segment_id TEXT PRIMARY KEY, tile TEXT NOT NULL, player_id TEXT NOT NULL,
 elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms>0), ghost_json TEXT NOT NULL,
 verified_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS records_tile ON speed_records(tile);
CREATE TABLE IF NOT EXISTS flashpoints (
 id TEXT PRIMARY KEY, region TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('shortage','lockout')),
 commodity TEXT, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
 CHECK(ends_at-starts_at=172800)
);
