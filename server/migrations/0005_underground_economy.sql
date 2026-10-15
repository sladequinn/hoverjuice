-- Finite one-time freight fund. No recurring currency faucet or client balance imports.
CREATE TABLE freight_fund (id INTEGER PRIMARY KEY CHECK(id=1),available INTEGER NOT NULL CHECK(available>=0),reserved INTEGER NOT NULL CHECK(reserved>=0),paid INTEGER NOT NULL CHECK(paid>=0),burned INTEGER NOT NULL CHECK(burned>=0),CHECK(available+reserved+paid+burned=100000000)) STRICT;
INSERT INTO freight_fund VALUES(1,100000000,0,0,0);
CREATE TABLE markets (district TEXT NOT NULL,commodity TEXT NOT NULL CHECK(commodity IN('glimmer','ghostware','nightbloom')),stock INTEGER NOT NULL CHECK(stock BETWEEN 0 AND 500),pressure INTEGER NOT NULL CHECK(pressure BETWEEN 0 AND 100),revision INTEGER NOT NULL,updated_at INTEGER NOT NULL,price INTEGER NOT NULL CHECK(price>0),previous_price INTEGER NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,lost INTEGER NOT NULL DEFAULT 0,incoming INTEGER NOT NULL DEFAULT 0 CHECK(incoming>=0 AND stock+incoming<=500),PRIMARY KEY(district,commodity)) STRICT;
CREATE TABLE freight_quotes (id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES players(id),origin TEXT NOT NULL,destination TEXT NOT NULL,commodity TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity BETWEEN 4 AND 6),gross INTEGER NOT NULL CHECK(gross BETWEEN 2000 AND 20000),fee INTEGER NOT NULL CHECK(fee BETWEEN 1 AND 20000),source_revision INTEGER NOT NULL,dest_revision INTEGER NOT NULL,route TEXT NOT NULL CHECK(json_valid(route)),crew_id TEXT,membership TEXT,warehouse TEXT,hq TEXT,competitive INTEGER NOT NULL CHECK(competitive IN(0,1)),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL) STRICT;
CREATE INDEX freight_quotes_expiry ON freight_quotes(expires_at);
CREATE TABLE shipments (id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES players(id),request_id TEXT NOT NULL,quote_id TEXT NOT NULL UNIQUE REFERENCES freight_quotes(id),origin TEXT NOT NULL,destination TEXT NOT NULL,commodity TEXT NOT NULL,quantity INTEGER NOT NULL,gross INTEGER NOT NULL,fee INTEGER NOT NULL,net INTEGER NOT NULL CHECK(net>0),crew_id TEXT,membership TEXT,competitive INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('active','delivered','lost','cancelled')),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,UNIQUE(player_id,request_id)) STRICT;
CREATE UNIQUE INDEX shipment_one_active ON shipments(player_id) WHERE status='active';
CREATE INDEX shipment_player_time ON shipments(player_id,created_at);
CREATE INDEX shipment_district ON shipments(origin,status);
CREATE TABLE freight_events (shipment_id TEXT PRIMARY KEY REFERENCES shipments(id),outcome TEXT NOT NULL CHECK(outcome IN('delivered','lost','cancelled')),actor TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
CREATE TABLE freight_intercepts (shipment_id TEXT PRIMARY KEY REFERENCES shipments(id),player_id TEXT NOT NULL REFERENCES players(id),crew_id TEXT NOT NULL,membership TEXT NOT NULL,created_at INTEGER NOT NULL,start_s REAL NOT NULL CHECK(start_s BETWEEN 0 AND 6000)) STRICT;
CREATE INDEX freight_intercepts_player ON freight_intercepts(player_id,created_at);
CREATE TRIGGER shipment_admit BEFORE INSERT ON shipments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM freight_quotes q JOIN markets m ON m.district=q.origin AND m.commodity=q.commodity JOIN markets d ON d.district=q.destination AND d.commodity=q.commodity WHERE q.id=NEW.quote_id AND q.player_id=NEW.player_id AND q.expires_at>NEW.created_at AND q.source_revision=m.revision AND q.dest_revision=d.revision AND m.stock>=q.quantity AND d.stock+d.incoming+q.quantity<=500 AND q.quantity=NEW.quantity AND q.gross=NEW.gross AND q.fee=NEW.fee AND NEW.net=q.gross-q.fee AND q.origin=NEW.origin AND q.destination=NEW.destination AND q.commodity=NEW.commodity AND q.competitive=NEW.competitive) THEN RAISE(ABORT,'stale_freight_quote') END;
 SELECT CASE WHEN (SELECT count(*) FROM shipments WHERE player_id=NEW.player_id AND created_at>NEW.created_at-86400000)>=6 THEN RAISE(ABORT,'freight_daily_limit') END;
 SELECT CASE WHEN (SELECT available FROM freight_fund WHERE id=1)<NEW.gross THEN RAISE(ABORT,'freight_fund_empty') END;
END;
CREATE TRIGGER shipment_reserve AFTER INSERT ON shipments BEGIN
 UPDATE markets SET stock=stock-NEW.quantity,revision=revision+1 WHERE district=NEW.origin AND commodity=NEW.commodity;
 UPDATE markets SET incoming=incoming+NEW.quantity,revision=revision+1 WHERE district=NEW.destination AND commodity=NEW.commodity;
 UPDATE freight_fund SET available=available-NEW.gross,reserved=reserved+NEW.gross WHERE id=1;
END;
CREATE TRIGGER freight_settle BEFORE INSERT ON freight_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM shipments WHERE id=NEW.shipment_id AND status='active') THEN RAISE(ABORT,'shipment_closed') END;
END;
CREATE TRIGGER freight_apply AFTER INSERT ON freight_events BEGIN
 INSERT INTO wallet_ledger(player_id,operation_id,delta,reason,balance_after,version,created_at)
 SELECT s.player_id,'freight:'||s.id,s.net,'freight delivery',w.balance+s.net,w.version+1,NEW.created_at FROM shipments s JOIN wallets w ON w.player_id=s.player_id WHERE s.id=NEW.shipment_id AND NEW.outcome='delivered';
 UPDATE freight_fund SET available=available+CASE WHEN NEW.outcome!='delivered' THEN (SELECT gross FROM shipments WHERE id=NEW.shipment_id) ELSE 0 END,reserved=reserved-(SELECT gross FROM shipments WHERE id=NEW.shipment_id),paid=paid+CASE WHEN NEW.outcome='delivered' THEN (SELECT net FROM shipments WHERE id=NEW.shipment_id) ELSE 0 END,burned=burned+CASE WHEN NEW.outcome='delivered' THEN (SELECT fee FROM shipments WHERE id=NEW.shipment_id) ELSE 0 END WHERE id=1;
 UPDATE markets SET incoming=incoming-(SELECT quantity FROM shipments WHERE id=NEW.shipment_id),revision=revision+1 WHERE district=(SELECT destination FROM shipments WHERE id=NEW.shipment_id) AND commodity=(SELECT commodity FROM shipments WHERE id=NEW.shipment_id);
 UPDATE markets SET stock=min(500-incoming,stock+(SELECT quantity FROM shipments WHERE id=NEW.shipment_id)),revision=revision+1,delivered=delivered+(SELECT quantity FROM shipments WHERE id=NEW.shipment_id) WHERE NEW.outcome='delivered' AND district=(SELECT destination FROM shipments WHERE id=NEW.shipment_id) AND commodity=(SELECT commodity FROM shipments WHERE id=NEW.shipment_id);
 UPDATE markets SET pressure=min(100,pressure+(SELECT quantity FROM shipments WHERE id=NEW.shipment_id)),revision=revision+1,lost=lost+(SELECT quantity FROM shipments WHERE id=NEW.shipment_id) WHERE NEW.outcome='lost' AND district=(SELECT destination FROM shipments WHERE id=NEW.shipment_id) AND commodity=(SELECT commodity FROM shipments WHERE id=NEW.shipment_id);
 UPDATE markets SET stock=min(500-incoming,stock+(SELECT quantity FROM shipments WHERE id=NEW.shipment_id)),revision=revision+1 WHERE NEW.outcome='cancelled' AND district=(SELECT origin FROM shipments WHERE id=NEW.shipment_id) AND commodity=(SELECT commodity FROM shipments WHERE id=NEW.shipment_id);
 UPDATE shipments SET status=NEW.outcome WHERE id=NEW.shipment_id;
END;
CREATE TRIGGER freight_event_no_update BEFORE UPDATE ON freight_events BEGIN SELECT RAISE(ABORT,'immutable_freight_event'); END;
CREATE TRIGGER freight_event_no_delete BEFORE DELETE ON freight_events BEGIN SELECT RAISE(ABORT,'immutable_freight_event'); END;
CREATE TRIGGER intercept_admit BEFORE INSERT ON freight_intercepts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM shipments s JOIN crew_members m ON m.player_id=NEW.player_id JOIN crew_members driver ON driver.player_id=s.player_id WHERE s.id=NEW.shipment_id AND s.status='active' AND s.competitive=1 AND s.crew_id IS NOT NULL AND m.crew_id=NEW.crew_id AND m.membership=NEW.membership AND m.crew_id!=s.crew_id AND driver.crew_id=s.crew_id AND driver.membership=s.membership AND s.player_id!=NEW.player_id) THEN RAISE(ABORT,'interception_forbidden') END;
 SELECT CASE WHEN (SELECT count(*) FROM freight_intercepts WHERE player_id=NEW.player_id AND created_at>NEW.created_at-86400000)>=2 THEN RAISE(ABORT,'interception_limit') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM freight_intercepts i JOIN shipments s ON s.id=i.shipment_id WHERE i.player_id=NEW.player_id AND s.status='active') OR EXISTS(SELECT 1 FROM shipments WHERE player_id=NEW.player_id AND status='active') THEN RAISE(ABORT,'already_running_freight') END;
END;
CREATE TRIGGER intercept_charge AFTER INSERT ON freight_intercepts BEGIN
 INSERT INTO wallet_ledger(player_id,operation_id,delta,reason,balance_after,version,created_at) SELECT player_id,'intercept:'||NEW.shipment_id,-2500,'freight interception fee',balance-2500,version+1,NEW.created_at FROM wallets WHERE player_id=NEW.player_id;
END;
CREATE TRIGGER shipment_membership BEFORE INSERT ON shipments BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM freight_quotes q WHERE q.id=NEW.quote_id AND q.crew_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crew_members m WHERE m.player_id=NEW.player_id AND m.crew_id=q.crew_id AND m.membership=q.membership)) THEN RAISE(ABORT,'freight_membership_changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM freight_quotes q WHERE q.id=NEW.quote_id AND q.warehouse IS NOT NULL AND NOT EXISTS(SELECT 1 FROM global_properties p WHERE p.id=q.warehouse AND p.owner_id=NEW.player_id AND p.status='active' AND p.area>=150)) THEN RAISE(ABORT,'freight_warehouse_changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM freight_intercepts i JOIN shipments s ON s.id=i.shipment_id WHERE i.player_id=NEW.player_id AND s.status='active') THEN RAISE(ABORT,'already_running_freight') END;
END;
CREATE TRIGGER freight_intercept_settle BEFORE INSERT ON freight_events WHEN NEW.actor!=(SELECT player_id FROM shipments WHERE id=NEW.shipment_id) BEGIN
 SELECT CASE WHEN NEW.outcome!='lost' OR NOT EXISTS(SELECT 1 FROM freight_intercepts i JOIN shipments s ON s.id=i.shipment_id JOIN crew_members a ON a.player_id=i.player_id JOIN crew_members d ON d.player_id=s.player_id WHERE s.id=NEW.shipment_id AND i.player_id=NEW.actor AND a.membership=i.membership AND d.membership=s.membership AND a.crew_id=i.crew_id AND d.crew_id=s.crew_id AND a.crew_id!=d.crew_id) THEN RAISE(ABORT,'invalid_interception_result') END;
END;
CREATE TRIGGER market_conflict BEFORE INSERT ON territory_results WHEN NEW.winner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM territory_results WHERE contest_id=NEW.contest_id) AND EXISTS(SELECT 1 FROM territory_control WHERE district=NEW.district AND crew_id!=NEW.winner AND expires_at>NEW.completed_at) BEGIN
 UPDATE markets SET pressure=min(100,pressure+2),revision=revision+1 WHERE district=NEW.district;
END;
CREATE TRIGGER shipment_immutable BEFORE UPDATE ON shipments WHEN NEW.id!=OLD.id OR NEW.player_id!=OLD.player_id OR NEW.quote_id!=OLD.quote_id OR NEW.quantity!=OLD.quantity OR NEW.gross!=OLD.gross OR NEW.net!=OLD.net OR NEW.fee!=OLD.fee OR NOT EXISTS(SELECT 1 FROM freight_events WHERE shipment_id=OLD.id AND outcome=NEW.status) BEGIN SELECT RAISE(ABORT,'immutable_shipment'); END;
CREATE TRIGGER shipment_no_delete BEFORE DELETE ON shipments BEGIN SELECT RAISE(ABORT,'immutable_shipment'); END;

CREATE INDEX shipment_expiry ON shipments(status,expires_at);

CREATE INDEX shipment_destination ON shipments(destination,status);
