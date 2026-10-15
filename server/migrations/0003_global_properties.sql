-- The existing ownership/local-save tables are deliberately not imported.
CREATE TABLE global_properties (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 lat REAL NOT NULL,
 lon REAL NOT NULL,
 cell TEXT NOT NULL,
 geometry TEXT NOT NULL CHECK(json_valid(geometry)),
 fingerprint TEXT NOT NULL,
 area INTEGER NOT NULL CHECK(area>=12),
 levels INTEGER NOT NULL CHECK(levels BETWEEN 1 AND 80),
 source_version INTEGER NOT NULL,
 verified_at INTEGER NOT NULL,
 price_minor INTEGER NOT NULL CHECK(price_minor BETWEEN 1 AND 10000000000),
 valuation_version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('active','review','retired')),
 revision INTEGER NOT NULL DEFAULT 1,
 owner_id TEXT REFERENCES players(id),
 acquired_at INTEGER,
 created_at INTEGER NOT NULL,
 CHECK((owner_id IS NULL AND acquired_at IS NULL) OR (owner_id IS NOT NULL AND acquired_at IS NOT NULL))
) STRICT;
CREATE INDEX property_cell ON global_properties(cell,id);
CREATE INDEX property_portfolio ON global_properties(owner_id,id);
CREATE TABLE property_aliases (
 source_id TEXT PRIMARY KEY,
 property_id TEXT NOT NULL REFERENCES global_properties(id)
) STRICT;
CREATE TABLE property_catalog_clock (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL) STRICT;
INSERT INTO property_catalog_clock VALUES(1,0);
CREATE TABLE property_catalog_writes (id TEXT PRIMARY KEY, expected_revision INTEGER NOT NULL) STRICT;
CREATE TRIGGER property_catalog_cas BEFORE INSERT ON property_catalog_writes BEGIN
 SELECT CASE WHEN NEW.expected_revision!=(SELECT revision FROM property_catalog_clock WHERE id=1) THEN RAISE(ABORT,'catalog_retry') END;
 UPDATE property_catalog_clock SET revision=revision+1 WHERE id=1;
END;
CREATE TABLE property_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 property_id TEXT NOT NULL REFERENCES global_properties(id),
 event TEXT NOT NULL,
 detail TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX property_audit_property ON property_audit(property_id,id);
CREATE UNIQUE INDEX property_audit_dedup ON property_audit(property_id,event,detail);
CREATE TABLE property_quotes (
 id TEXT PRIMARY KEY,
 player_id TEXT NOT NULL REFERENCES players(id),
 property_id TEXT NOT NULL REFERENCES global_properties(id),
 revision INTEGER NOT NULL,
 price_minor INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX property_quote_expiry ON property_quotes(expires_at);
CREATE TABLE property_purchases (
 player_id TEXT NOT NULL REFERENCES players(id),
 request_id TEXT NOT NULL,
 quote_id TEXT NOT NULL,
 property_id TEXT NOT NULL UNIQUE REFERENCES global_properties(id),
 price_minor INTEGER NOT NULL CHECK(price_minor>0),
 balance_after INTEGER NOT NULL CHECK(balance_after>=0),
 wallet_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,request_id)
) STRICT;
CREATE INDEX property_purchase_quota ON property_purchases(player_id,created_at);
CREATE TRIGGER property_purchase_validate BEFORE INSERT ON property_purchases BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM property_quotes q JOIN global_properties p ON p.id=q.property_id
  WHERE q.id=NEW.quote_id AND q.player_id=NEW.player_id AND q.property_id=NEW.property_id
  AND q.price_minor=NEW.price_minor AND q.expires_at>NEW.created_at AND q.revision=p.revision
  AND p.price_minor=NEW.price_minor AND p.status='active' AND p.verified_at>NEW.created_at-900000)
  THEN RAISE(ABORT,'quote_unavailable') END;
 SELECT CASE WHEN (SELECT owner_id FROM global_properties WHERE id=NEW.property_id) IS NOT NULL THEN RAISE(ABORT,'property_owned') END;
 SELECT CASE WHEN (SELECT balance FROM wallets WHERE player_id=NEW.player_id)<NEW.price_minor THEN RAISE(ABORT,'insufficient_funds') END;
 SELECT CASE WHEN (SELECT count(*) FROM property_purchases WHERE player_id=NEW.player_id AND created_at>NEW.created_at-86400000)>=5
  OR EXISTS(SELECT 1 FROM property_purchases WHERE player_id=NEW.player_id AND created_at>NEW.created_at-60000)
  OR (SELECT count(*) FROM global_properties WHERE owner_id=NEW.player_id)>=200 THEN RAISE(ABORT,'purchase_quota') END;
END;
CREATE TRIGGER property_purchase_apply AFTER INSERT ON property_purchases BEGIN
 INSERT INTO wallet_ledger(player_id,operation_id,delta,reason,balance_after,version,created_at)
 VALUES(NEW.player_id,'property:'||NEW.request_id,-NEW.price_minor,'property purchase',NEW.balance_after,NEW.wallet_version,NEW.created_at);
 UPDATE global_properties SET owner_id=NEW.player_id,acquired_at=NEW.created_at,revision=revision+1 WHERE id=NEW.property_id AND owner_id IS NULL;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'property_owned') END;
 INSERT INTO property_audit(property_id,event,detail,created_at) VALUES(NEW.property_id,'purchase',NEW.player_id,NEW.created_at);
END;
CREATE TRIGGER property_title_guard BEFORE UPDATE OF owner_id ON global_properties BEGIN
 SELECT CASE WHEN OLD.owner_id IS NOT NULL AND NEW.owner_id IS NOT OLD.owner_id THEN RAISE(ABORT,'immutable_title') END;
 SELECT CASE WHEN OLD.owner_id IS NULL AND NEW.owner_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM property_purchases p JOIN wallet_ledger l ON l.player_id=p.player_id AND l.operation_id='property:'||p.request_id
  WHERE p.property_id=OLD.id AND p.player_id=NEW.owner_id AND l.delta=-p.price_minor) THEN RAISE(ABORT,'purchase_required') END;
END;
CREATE TRIGGER property_no_delete BEFORE DELETE ON global_properties BEGIN
 SELECT RAISE(ABORT,'retain_property_history');
END;
CREATE TRIGGER purchase_no_update BEFORE UPDATE ON property_purchases BEGIN
 SELECT RAISE(ABORT,'immutable_purchase');
END;
CREATE TRIGGER purchase_no_delete BEFORE DELETE ON property_purchases BEGIN
 SELECT RAISE(ABORT,'immutable_purchase');
END;

CREATE TRIGGER property_initial_title BEFORE INSERT ON global_properties WHEN NEW.owner_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'purchase_required');
END;
