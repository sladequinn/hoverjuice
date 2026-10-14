-- Global identity is independent of provider names, devices and geographic rooms.
CREATE TABLE players (
 id TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE identities (
 provider TEXT NOT NULL,
 subject TEXT NOT NULL,
 player_id TEXT NOT NULL REFERENCES players(id),
 PRIMARY KEY(provider, subject)
) STRICT;
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 player_id TEXT NOT NULL REFERENCES players(id),
 expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_player ON sessions(player_id);
CREATE TABLE oauth_attempts (
 state_hash TEXT PRIMARY KEY,
 verifier TEXT NOT NULL,
 expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX oauth_expiry ON oauth_attempts(expires_at);
CREATE TABLE request_limits (
 bucket TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX limits_expiry ON request_limits(expires_at);
-- Explicitly untrusted legacy single-player snapshots. Never join these to world state.
CREATE TABLE legacy_saves (
 player_id TEXT PRIMARY KEY REFERENCES players(id),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
 payload TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(payload)),
 updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE save_receipts (
 player_id TEXT NOT NULL REFERENCES players(id),
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,request_id)
) STRICT;
-- Integer minor units, one global currency. Zero balance until a trusted producer exists.
CREATE TABLE wallets (
 player_id TEXT PRIMARY KEY REFERENCES players(id),
 balance INTEGER NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 9000000000000),
 version INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE wallet_ledger (
 player_id TEXT NOT NULL REFERENCES wallets(player_id),
 operation_id TEXT NOT NULL,
 delta INTEGER NOT NULL CHECK(delta != 0 AND delta BETWEEN -9000000000000 AND 9000000000000),
 reason TEXT NOT NULL,
 balance_after INTEGER NOT NULL CHECK(balance_after BETWEEN 0 AND 9000000000000),
 version INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,operation_id),
 UNIQUE(player_id,version)
) STRICT;
-- Ledger insertion and balance update form one SQLite statement/transaction.
CREATE TRIGGER wallet_apply AFTER INSERT ON wallet_ledger BEGIN
 UPDATE wallets SET balance=NEW.balance_after,version=NEW.version
 WHERE player_id=NEW.player_id AND version=NEW.version-1 AND balance+NEW.delta=NEW.balance_after;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'wallet_conflict') END;
END;
CREATE TRIGGER wallet_no_update BEFORE UPDATE ON wallet_ledger BEGIN
 SELECT RAISE(ABORT,'immutable_ledger');
END;
CREATE TRIGGER wallet_no_delete BEFORE DELETE ON wallet_ledger BEGIN
 SELECT RAISE(ABORT,'immutable_ledger');
END;
