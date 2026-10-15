import {cellFor,watchingCells,distance,type Geo} from '../shared/multiplayer'
import type {PropertyView,PropertyQuote,PurchaseReceipt} from '../shared/properties'
import {requestId} from '../shared/properties'
import {hash,HttpError} from './security'
import {contains,overlap,parseBuildings,sourceCell,valueBuilding,type SourceBuilding} from './property-geometry'
export interface RegistryEnv {DB:D1Database;PROPERTY_SOURCE:DurableObjectNamespace}
interface Row {id:string;geometry:string;fingerprint:string;status:string;revision:number;owner_id:string|null;source_version:number;verified_at:number;lat:number;lon:number}
const viewSQL=`SELECT p.id,p.name,p.lat,p.lon,p.price_minor AS priceMinor,p.owner_id AS ownerId,
 COALESCE(NULLIF(u.display_name,''),'Driver '||substr(u.id,1,4)) AS ownerName,p.status,p.revision,p.area,p.levels,p.source_version AS sourceVersion,p.acquired_at AS acquiredAt
 FROM global_properties p LEFT JOIN players u ON u.id=p.owner_id`
export async function propertyView(db:D1Database,id:string){const p=await db.prepare(viewSQL+' WHERE p.id=?').bind(id).first<PropertyView>();if(!p)throw new HttpError(404,'Property not registered');return p}
async function snapshot(env:RegistryEnv,p:Geo){const key=sourceCell(p),res=await env.PROPERTY_SOURCE.get(env.PROPERTY_SOURCE.idFromName(key)).fetch('https://source/?cell='+key);if(!res.ok)throw new HttpError(503,'Property map source unavailable; no purchase was made');const body=await res.json() as any;return {at:body.at,buildings:parseBuildings(body.data)}}
const footprint=(b:SourceBuilding)=>JSON.stringify({rings:b.rings,levels:b.levels,use:b.use,eligible:b.eligible})
/** Optimistic catalog clock makes geometry/alias conflict checks serializable across Workers. */
export async function registerBuilding(db:D1Database,b:SourceBuilding,price:number,verifiedAt:number){
 const fingerprint=await hash(footprint(b)),aliases=[b.id,...b.aliases],cells=watchingCells(b),now=Date.now()
 for(let attempt=0;attempt<4;attempt++){
  const read=await db.batch([
   db.prepare('SELECT revision FROM property_catalog_clock WHERE id=1'),
   db.prepare(`SELECT p.* FROM global_properties p WHERE cell IN (${cells.map(()=>'?').join(',')}) OR id IN (SELECT property_id FROM property_aliases WHERE source_id IN (${aliases.map(()=>'?').join(',')})) LIMIT 2001`).bind(...cells,...aliases)
  ])
  const epoch=(read[0].results[0] as any).revision,rows=read[1].results as unknown as Row[]
  if(rows.length>2000)throw new HttpError(503,'District catalog needs partitioning before further registration')
  const same=rows.find(p=>p.id===b.id),conflicts=rows.filter(p=>p.id!==b.id&&distance(p,b)<1000&&overlap(JSON.parse(p.geometry),b.rings)>1)
  // Any alias already reserved by another title is a source merge/split, never a second sale.
  const reserved=await db.prepare(`SELECT DISTINCT property_id FROM property_aliases WHERE source_id IN (${aliases.map(()=>'?').join(',')}) AND property_id!=?`).bind(...aliases,b.id).all<{property_id:string}>()
  const conflictIds=[...new Set([...conflicts.map(p=>p.id),...reserved.results.map(p=>p.property_id)])]
  const changed=Boolean(same&&same.fingerprint!==fingerprint),status=changed||conflictIds.length||!b.eligible?'review':same?.status??'active'
  const nonce=crypto.randomUUID(),statements=[db.prepare('INSERT INTO property_catalog_writes VALUES(?,?)').bind(nonce,epoch)]
  if(!same){statements.push(db.prepare(`INSERT INTO global_properties(id,name,lat,lon,cell,geometry,fingerprint,area,levels,source_version,verified_at,price_minor,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(b.id,b.name,b.lat,b.lon,cellFor(b),JSON.stringify(b.rings),fingerprint,b.area,b.levels,b.version,verifiedAt,price,status,now))}
  else statements.push(db.prepare(`UPDATE global_properties SET name=?,source_version=MAX(source_version,?),verified_at=MAX(verified_at,?),status=?,revision=revision+CASE WHEN status!=? THEN 1 ELSE 0 END WHERE id=?`).bind(b.name,b.version,verifiedAt,status,status,b.id))
  for(const alias of aliases)statements.push(db.prepare('INSERT INTO property_aliases(source_id,property_id) VALUES(?,?) ON CONFLICT(source_id) DO NOTHING').bind(alias,b.id))
  for(const id of conflictIds)statements.push(db.prepare("UPDATE global_properties SET status='review',revision=revision+CASE WHEN status!='review' THEN 1 ELSE 0 END WHERE id=?").bind(id))
  if(!same||changed||conflictIds.length)statements.push(db.prepare('INSERT OR IGNORE INTO property_audit(property_id,event,detail,created_at) VALUES(?,?,?,?)').bind(b.id,same?'source_review':'registered',JSON.stringify({sourceVersion:b.version,conflicts:conflictIds,changed,fingerprint}),now))
  statements.push(db.prepare('DELETE FROM property_catalog_writes WHERE id=?').bind(nonce))
  try{await db.batch(statements);return propertyView(db,b.id)}catch(error){if(String(error).includes('catalog_retry'))continue;throw error}
 }
 throw new HttpError(503,'Catalog changed concurrently; inspect again')
}
export async function resolveProperty(env:RegistryEnv,point:Geo){
 const initial=await snapshot(env,point),matches=initial.buildings.filter(b=>contains(b.rings,point))
 if(matches.length>1&&matches.length<=16)for(const b of matches)await registerBuilding(env.DB,b,valueBuilding(b,initial.buildings),initial.at)
 if(matches.length!==1)throw new HttpError(409,matches.length?'Overlapping OSM buildings require source review':'No complete supported OSM building at this point; try inside its footprint')
 const found=matches[0],canonical=sourceCell(found)===sourceCell(point)?initial:await snapshot(env,found)
 const building=canonical.buildings.find(b=>b.id===found.id)
 if(!building||!contains(building.rings,point))throw new HttpError(409,'Map snapshots disagree; inspect again after the source refreshes')
 return registerBuilding(env.DB,building,valueBuilding(building,canonical.buildings),canonical.at)
}
export async function refreshProperty(env:RegistryEnv,id:string){
 const p=await propertyView(env.DB,id),data=await snapshot(env,p),b=data.buildings.find(b=>b.id===id)
 if(b)return registerBuilding(env.DB,b,valueBuilding(b,data.buildings),data.at)
 await env.DB.batch([env.DB.prepare('UPDATE property_catalog_clock SET revision=revision+1 WHERE id=1'),env.DB.prepare("UPDATE global_properties SET status='retired',revision=revision+1 WHERE id=? AND status='active' AND verified_at<?").bind(id,data.at),env.DB.prepare("INSERT OR IGNORE INTO property_audit(property_id,event,detail,created_at) SELECT id,'source_absent','Title retained; source reconciliation required',? FROM global_properties WHERE id=? AND status='retired'").bind(Date.now(),id)])
 return propertyView(env.DB,id)
}
export async function quoteProperty(db:D1Database,playerId:string,p:PropertyView){
 if(p.ownerId||p.status!=='active')return null
 const quote:PropertyQuote={id:crypto.randomUUID(),playerId,propertyId:p.id,priceMinor:p.priceMinor,revision:p.revision,expiresAt:Date.now()+300000}
 await db.prepare('INSERT INTO property_quotes VALUES(?,?,?,?,?,?)').bind(quote.id,playerId,p.id,p.revision,p.priceMinor,quote.expiresAt).run();return quote
}
const receiptSQL='SELECT player_id AS playerId,request_id AS requestId,quote_id AS quoteId,property_id AS propertyId,price_minor AS priceMinor,balance_after AS balance,wallet_version AS walletVersion,created_at AS createdAt FROM property_purchases WHERE player_id=? AND request_id=?'
export async function purchaseProperty(db:D1Database,playerId:string,body:any):Promise<PurchaseReceipt>{
 if(!body||Object.keys(body).sort().join(',')!=='playerId,quoteId,requestId'||body.playerId!==playerId||!requestId(body.requestId)||!requestId(body.quoteId))throw new HttpError(400,'Invalid purchase request')
 const old=await db.prepare(receiptSQL).bind(playerId,body.requestId).first<PurchaseReceipt>()
 if(old){if(old.quoteId!==body.quoteId)throw new HttpError(409,'Request ID was used for another quote');return old}
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO property_purchases(player_id,request_id,quote_id,property_id,price_minor,balance_after,wallet_version,created_at)
    SELECT ?,?,q.id,q.property_id,q.price_minor,w.balance-q.price_minor,w.version+1,? FROM property_quotes q JOIN wallets w ON w.player_id=q.player_id
    WHERE q.id=? AND q.player_id=? AND NOT EXISTS(SELECT 1 FROM property_purchases WHERE player_id=? AND request_id=?)`).bind(playerId,body.requestId,Date.now(),body.quoteId,playerId,playerId,body.requestId),
   db.prepare(receiptSQL).bind(playerId,body.requestId)
  ])
  const receipt=result[1].results[0] as unknown as PurchaseReceipt|undefined
  if(!receipt)throw new HttpError(409,'Quote expired or unavailable; inspect again')
  if(receipt.quoteId!==body.quoteId)throw new HttpError(409,'Request ID was used for another quote')
  return receipt
 }catch(error){
  if(error instanceof HttpError)throw error
  const message=String(error)
  if(message.includes('insufficient_funds'))throw new HttpError(409,'Insufficient global wallet funds; local cash cannot buy global property')
  if(message.includes('purchase_quota'))throw new HttpError(429,'Purchase limit: one per minute, five per rolling day, 200 owned properties')
  if(/quote_unavailable|property_owned|UNIQUE constraint failed: property_purchases.property_id/.test(message))throw new HttpError(409,'Property or quote changed; refresh ownership. No money was taken')
  throw error
 }
}
export async function portfolio(db:D1Database,owner:string,cursor:string){const rows=await db.prepare(viewSQL+' WHERE p.owner_id=? AND p.id>? ORDER BY p.id LIMIT 51').bind(owner,cursor).all<PropertyView>();return {items:rows.results.slice(0,50),next:rows.results.length>50?rows.results[49].id:null}}
export async function areaProperties(db:D1Database,point:Geo,cursor:string){const cells=watchingCells(point),rows=await db.prepare(viewSQL+` WHERE p.cell IN (${cells.map(()=>'?').join(',')}) AND p.owner_id IS NOT NULL AND p.id>? ORDER BY p.id LIMIT 101`).bind(...cells,cursor).all<PropertyView>();return {items:rows.results.slice(0,100),next:rows.results.length>100?rows.results[99].id:null}}
