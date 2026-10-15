-- Membership and property titles are independent. No wallet or title mutations here.
CREATE TABLE crews (
 id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, tag TEXT NOT NULL COLLATE NOCASE UNIQUE,
 color TEXT NOT NULL, leader_id TEXT NOT NULL REFERENCES players(id), invite TEXT NOT NULL UNIQUE,
 hq TEXT REFERENCES global_properties(id), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 reputation INTEGER NOT NULL DEFAULT 0 CHECK(reputation>=0), created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE crew_members (
 player_id TEXT PRIMARY KEY REFERENCES players(id), crew_id TEXT NOT NULL REFERENCES crews(id),
 role TEXT NOT NULL CHECK(role IN('leader','officer','member')), membership TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL
) STRICT;
CREATE INDEX crew_members_crew ON crew_members(crew_id);
CREATE TABLE crew_cooldowns (player_id TEXT PRIMARY KEY REFERENCES players(id), until_at INTEGER NOT NULL) STRICT;
CREATE TABLE crew_requests (
 player_id TEXT NOT NULL REFERENCES players(id), request_id TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(player_id,request_id)
) STRICT;
CREATE TABLE crew_commands (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, crew TEXT NOT NULL, target TEXT, action TEXT NOT NULL, value TEXT, at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER crew_member_guard BEFORE INSERT ON crew_members BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM crews WHERE id=NEW.crew_id AND active=1) THEN RAISE(ABORT,'crew_inactive') END;
 SELECT CASE WHEN (SELECT count(*) FROM crew_members WHERE crew_id=NEW.crew_id)>=16 THEN RAISE(ABORT,'crew_full') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM crew_cooldowns WHERE player_id=NEW.player_id AND until_at>NEW.joined_at) THEN RAISE(ABORT,'crew_cooldown') END;
END;
CREATE TRIGGER crew_member_leave AFTER DELETE ON crew_members BEGIN
 UPDATE crews SET hq=NULL WHERE id=OLD.crew_id AND hq IN(SELECT id FROM global_properties WHERE owner_id=OLD.player_id);
 INSERT INTO crew_cooldowns(player_id,until_at) VALUES(OLD.player_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+3600000) ON CONFLICT(player_id) DO UPDATE SET until_at=excluded.until_at;
END;
-- Authorization is evaluated inside the mutation transaction, never from a stale HTTP read.
CREATE TRIGGER crew_command_guard BEFORE INSERT ON crew_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM crew_members WHERE player_id=NEW.actor AND crew_id=NEW.crew) THEN RAISE(ABORT,'crew_permission') END;
 SELECT CASE WHEN NEW.action IN('role','transfer','kick','invite') AND NOT EXISTS(SELECT 1 FROM crews WHERE id=NEW.crew AND leader_id=NEW.actor AND active=1) THEN RAISE(ABORT,'crew_permission') END;
 SELECT CASE WHEN NEW.action IN('role','transfer','kick') AND (NEW.target=NEW.actor OR NOT EXISTS(SELECT 1 FROM crew_members WHERE player_id=NEW.target AND crew_id=NEW.crew)) THEN RAISE(ABORT,'crew_target') END;
 SELECT CASE WHEN NEW.action='hq' AND NOT EXISTS(SELECT 1 FROM crew_members m JOIN global_properties p ON p.id=NEW.value WHERE m.player_id=NEW.actor AND m.crew_id=NEW.crew AND m.role IN('leader','officer') AND p.owner_id=NEW.actor AND p.status='active') THEN RAISE(ABORT,'hq_permission') END;
 SELECT CASE WHEN NEW.action='leave' AND EXISTS(SELECT 1 FROM crews WHERE id=NEW.crew AND leader_id=NEW.actor) AND (SELECT count(*) FROM crew_members WHERE crew_id=NEW.crew)>1 THEN RAISE(ABORT,'transfer_leadership_first') END;
END;
CREATE TRIGGER crew_command_apply AFTER INSERT ON crew_commands BEGIN
 UPDATE crew_members SET role=NEW.value WHERE NEW.action='role' AND player_id=NEW.target;
 UPDATE crew_members SET role=CASE WHEN player_id=NEW.target THEN 'leader' ELSE 'officer' END WHERE NEW.action='transfer' AND player_id IN(NEW.actor,NEW.target);
 UPDATE crews SET leader_id=NEW.target WHERE NEW.action='transfer' AND id=NEW.crew;
 UPDATE crews SET invite=NEW.value WHERE NEW.action='invite' AND id=NEW.crew;
 UPDATE crews SET hq=NEW.value WHERE NEW.action='hq' AND id=NEW.crew;
 UPDATE crews SET active=0,hq=NULL WHERE NEW.action='leave' AND id=NEW.crew AND leader_id=NEW.actor;
 DELETE FROM crew_members WHERE (NEW.action='kick' AND player_id=NEW.target) OR (NEW.action='leave' AND player_id=NEW.actor);
END;
CREATE TABLE territory_control (
 district TEXT PRIMARY KEY, crew_id TEXT REFERENCES crews(id), expires_at INTEGER NOT NULL DEFAULT 0,
 protected_until INTEGER NOT NULL DEFAULT 0, contest_id TEXT NOT NULL
) STRICT;
CREATE INDEX territory_control_crew ON territory_control(crew_id,expires_at);
CREATE TABLE territory_results (
 contest_id TEXT PRIMARY KEY, district TEXT NOT NULL, winner TEXT REFERENCES crews(id), scores TEXT NOT NULL CHECK(json_valid(scores)),
 completed_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER territory_result_apply AFTER INSERT ON territory_results BEGIN
 -- At most three live districts, checked atomically across different district actors.
 INSERT INTO territory_control(district,crew_id,expires_at,protected_until,contest_id)
 VALUES(NEW.district,CASE WHEN NEW.winner IS NOT NULL AND (SELECT count(*) FROM territory_control WHERE crew_id=NEW.winner AND expires_at>NEW.completed_at AND district<>NEW.district)<3 THEN NEW.winner ELSE NULL END,
 NEW.completed_at+604800000,NEW.completed_at+1800000,NEW.contest_id)
 ON CONFLICT(district) DO UPDATE SET crew_id=CASE WHEN NEW.winner IS NULL THEN territory_control.crew_id ELSE excluded.crew_id END,expires_at=CASE WHEN NEW.winner IS NULL THEN territory_control.expires_at ELSE excluded.expires_at END,protected_until=excluded.protected_until,contest_id=excluded.contest_id;
 UPDATE crews SET reputation=reputation+10 WHERE id=NEW.winner AND id=(SELECT crew_id FROM territory_control WHERE district=NEW.district) AND active=1;
END;
CREATE TRIGGER territory_result_immutable_update BEFORE UPDATE ON territory_results BEGIN SELECT RAISE(ABORT,'immutable_result'); END;
CREATE TRIGGER territory_result_immutable_delete BEFORE DELETE ON territory_results BEGIN SELECT RAISE(ABORT,'immutable_result'); END;
CREATE INDEX global_properties_geographic ON global_properties(lat,lon);
CREATE INDEX crews_headquarters ON crews(hq) WHERE hq IS NOT NULL;
CREATE TRIGGER crew_receipt_immutable_update BEFORE UPDATE ON crew_requests BEGIN SELECT RAISE(ABORT,'immutable_crew_receipt'); END;
CREATE TRIGGER crew_receipt_immutable_delete BEFORE DELETE ON crew_requests BEGIN SELECT RAISE(ABORT,'immutable_crew_receipt'); END;
