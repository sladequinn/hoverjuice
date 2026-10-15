import {CREW_COLORS,districtBounds,type CrewView} from '../shared/crews'
import {HttpError,token} from './security'
import {propertyId,requestId} from '../shared/properties'
export async function myCrew(db:D1Database,player:string):Promise<CrewView|null>{
 const c=await db.prepare('SELECT c.id,c.name,c.tag,c.color,c.reputation,c.hq,c.invite,m.role,m.membership FROM crews c JOIN crew_members m ON m.crew_id=c.id WHERE m.player_id=? AND c.active=1').bind(player).first<any>();if(!c)return null
 c.members=(await db.prepare("SELECT m.player_id AS id,coalesce(nullif(p.display_name,''),'Driver') AS name,m.role FROM crew_members m JOIN players p ON p.id=m.player_id WHERE m.crew_id=? ORDER BY m.joined_at,m.player_id").bind(c.id).all()).results
 if(c.role!=='leader')delete c.invite
 c.headquarters=c.hq?await db.prepare("SELECT lat,lon,name FROM global_properties WHERE id=? AND status='active' AND owner_id IN(SELECT player_id FROM crew_members WHERE crew_id=?)").bind(c.hq,c.id).first():null
 c.territories=(await db.prepare('SELECT district AS id,expires_at AS expiresAt FROM territory_control WHERE crew_id=? AND expires_at>? ORDER BY district LIMIT 3').bind(c.id,Date.now()).all()).results.map((t:any)=>({...t,...districtBounds(t.id)}))
 return c
}
export async function crewCommand(db:D1Database,player:string,b:any){
 if(!b||b.playerId!==player||!requestId(b.requestId)||typeof b.action!=='string'||Object.keys(b).some(k=>!['playerId','requestId','action','name','tag','color','code','target','value'].includes(k)))throw new HttpError(400,'Invalid crew command')
 const payload=JSON.stringify(Object.fromEntries(Object.entries(b).sort(([a],[b])=>a.localeCompare(b))))
 const old=await db.prepare('SELECT payload,result FROM crew_requests WHERE player_id=? AND request_id=?').bind(player,b.requestId).first<any>()
 if(old){if(old.payload!==payload)throw new HttpError(409,'Request key already used');return JSON.parse(old.result)}
 const now=Date.now(),statements:D1PreparedStatement[]=[],id=crypto.randomUUID()
 if(b.action==='create'){
  if(typeof b.name!=='string'||!/^[\p{L}\p{N} ._-]{3,24}$/u.test(b.name.trim())||typeof b.tag!=='string'||! /^[A-Z0-9]{2,5}$/.test(b.tag)||!CREW_COLORS.includes(b.color))throw new HttpError(400,'Use a 3–24 character name, 2–5 uppercase tag and listed color')
  statements.push(db.prepare('INSERT INTO crews(id,name,tag,color,leader_id,invite,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,b.name.trim(),b.tag,b.color,player,token(),now),db.prepare("INSERT INTO crew_members VALUES(?,?,'leader',?,?)").bind(player,id,crypto.randomUUID(),now))
 }else if(b.action==='join'){
  if(typeof b.code!=='string'||!/^[a-f0-9]{64}$/.test(b.code))throw new HttpError(400,'Invalid invite code')
  statements.push(db.prepare("INSERT INTO crew_members(player_id,crew_id,role,membership,joined_at) VALUES(?,(SELECT id FROM crews WHERE invite=? AND active=1),'member',?,?)").bind(player,b.code,crypto.randomUUID(),now))
 }else{
  if(!['leave','role','transfer','kick','invite','hq'].includes(b.action)||(['role','transfer','kick'].includes(b.action)&&!requestId(b.target))||(b.action==='role'&&!['member','officer'].includes(b.value))||(b.action==='hq'&&!propertyId(b.value)))throw new HttpError(400,'Invalid crew action')
  statements.push(db.prepare('INSERT INTO crew_commands VALUES(?,?,(SELECT crew_id FROM crew_members WHERE player_id=?),?,?,?,?)').bind(id,player,player,b.target??null,b.action,b.action==='invite'?token():b.value??null,now),db.prepare('DELETE FROM crew_commands WHERE id=?').bind(id))
 }
 const result={ok:true,requestId:b.requestId}
 statements.push(db.prepare('INSERT INTO crew_requests VALUES(?,?,?,?,?)').bind(player,b.requestId,payload,JSON.stringify(result),now))
 try{await db.batch(statements)}catch(error){
  const retry=await db.prepare('SELECT payload,result FROM crew_requests WHERE player_id=? AND request_id=?').bind(player,b.requestId).first<any>();if(retry){if(retry.payload!==payload)throw new HttpError(409,'Request key already used');return JSON.parse(retry.result)}
  if(/constraint|crew_|hq_permission|transfer_leadership_first/i.test(String(error)))throw new HttpError(409,'Crew action rejected: check membership, permissions, capacity, invite, unique name/tag, or the one-hour rejoin cooldown. Leaders must transfer leadership before leaving.')
  throw error
 }
 return result
}
