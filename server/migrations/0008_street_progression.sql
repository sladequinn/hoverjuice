-- Authoritative inventory/garage plus immutable commands. No legacy save imports.
CREATE TABLE street_accounts (
 player_id TEXT PRIMARY KEY REFERENCES players(id),revision INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(json_valid(state))
) STRICT;
CREATE TABLE street_fund (id INTEGER PRIMARY KEY CHECK(id=1),available INTEGER NOT NULL CHECK(available>=0)) STRICT;
-- Finite dealer liquidity. Player purchases replenish this reserve; sales draw from it.
INSERT INTO street_fund VALUES(1,100000000);
CREATE TABLE street_markets (
 district TEXT NOT NULL,good TEXT NOT NULL,stock INTEGER NOT NULL CHECK(stock BETWEEN 0 AND 500),revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,
 PRIMARY KEY(district,good)
) STRICT;
CREATE TABLE street_quotes (
 id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES players(id),district TEXT NOT NULL,good TEXT NOT NULL,side TEXT NOT NULL CHECK(side IN('buy','sell')),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 70),unit_price INTEGER NOT NULL CHECK(unit_price>0),market_revision INTEGER NOT NULL,expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE street_receipts (
 player_id TEXT NOT NULL REFERENCES players(id),request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,expected_revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(json_valid(state)),delta INTEGER NOT NULL,reason TEXT NOT NULL,
 district TEXT,good TEXT,stock_delta INTEGER NOT NULL DEFAULT 0,market_revision INTEGER,quote_id TEXT UNIQUE REFERENCES street_quotes(id),created_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,request_id)
) STRICT;
CREATE TRIGGER street_check BEFORE INSERT ON street_receipts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM street_accounts WHERE player_id=NEW.player_id AND revision=NEW.expected_revision) THEN RAISE(ABORT,'street_revision') END;
 SELECT CASE WHEN NEW.quote_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM street_quotes q JOIN street_markets m ON m.district=q.district AND m.good=q.good WHERE q.id=NEW.quote_id AND q.player_id=NEW.player_id AND q.expires_at>NEW.created_at AND m.revision=NEW.market_revision AND q.market_revision=m.revision AND q.district=NEW.district AND q.good=NEW.good AND NEW.stock_delta=CASE WHEN q.side='buy' THEN -q.quantity ELSE q.quantity END AND NEW.delta=NEW.stock_delta*q.unit_price) THEN RAISE(ABORT,'street_quote_expired') END;
 SELECT CASE WHEN NEW.quote_id IS NOT NULL AND (SELECT available FROM street_fund WHERE id=1)<NEW.delta THEN RAISE(ABORT,'dealer_liquidity') END;
END;
CREATE TRIGGER street_apply AFTER INSERT ON street_receipts BEGIN
 INSERT INTO wallet_ledger(player_id,operation_id,delta,reason,balance_after,version,created_at)
 SELECT player_id,'street:'||NEW.request_id,NEW.delta,NEW.reason,balance+NEW.delta,version+1,NEW.created_at FROM wallets WHERE player_id=NEW.player_id AND NEW.delta!=0;
 UPDATE street_accounts SET state=NEW.state,revision=revision+1 WHERE player_id=NEW.player_id;
 UPDATE street_markets SET stock=stock+NEW.stock_delta,revision=revision+1 WHERE district=NEW.district AND good=NEW.good AND NEW.quote_id IS NOT NULL;
 UPDATE street_fund SET available=available-NEW.delta WHERE id=1 AND NEW.quote_id IS NOT NULL;
END;
CREATE TRIGGER street_receipt_no_update BEFORE UPDATE ON street_receipts BEGIN SELECT RAISE(ABORT,'immutable_street_receipt'); END;
CREATE TRIGGER street_receipt_no_delete BEFORE DELETE ON street_receipts BEGIN SELECT RAISE(ABORT,'immutable_street_receipt'); END;
CREATE TABLE courier_quotes (quote_id TEXT PRIMARY KEY REFERENCES freight_quotes(id) ON DELETE CASCADE,mission TEXT NOT NULL,duration INTEGER NOT NULL CHECK(duration BETWEEN 60000 AND 900000)) STRICT;

CREATE INDEX street_quote_expiry ON street_quotes(expires_at);
