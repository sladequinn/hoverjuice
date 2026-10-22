import {COMMODITIES,baseline,price,HOUR,neighbours,freightReward,type MarketRow,course} from '../shared/economy'
import {districtBounds} from '../shared/crews'
import {distance,type Geo} from '../shared/multiplayer'
import {requestId} from '../shared/properties'
import {sourceCell} from './property-geometry'
import {freightRoute} from './economy-route'
import {HttpError} from './security'
export interface EconomyEnv {DB:D1Database;PROPERTY_SOURCE:DurableObjectNamespace;FREIGHT:DurableObjectNamespace;PLAYERS:DurableObjectNamespace;ECONOMY_ENABLED?:string}
export async function market(db:D1Database,district:string,commodity:string,now=Date.now()):Promise<MarketRow>{
 districtBounds(district);if(!COMMODITIES.some(c=>c.id===commodity))throw new HttpError(400,'Unknown commodity')
 const stock=baseline(district,commodity),initial=price(district,commodity,stock,0)
 await db.prepare('INSERT INTO markets(district,commodity,stock,pressure,revision,updated_at,price,previous_price) VALUES(?,?,?,0,0,?,?,?) ON CONFLICT(district,commodity) DO NOTHING').bind(district,commodity,stock,now,initial,initial).run()
 for(let tries=0;tries<6;tries++){
  const m=(await db.prepare('SELECT * FROM markets WHERE district=? AND commodity=?').bind(district,commodity).first<MarketRow>())!,hours=Math.max(0,Math.floor((now-m.updated_at)/HOUR)),delta=Math.sign(stock-m.stock)*Math.min(Math.abs(stock-m.stock),Math.min(hours,24)*2),nextStock=Math.min(500-m.incoming,m.stock+delta),pressure=Math.max(0,m.pressure-Math.min(hours,24)),p=price(district,commodity,nextStock,pressure)
  if(!hours&&p===m.price)return m
  const updated=await db.prepare('UPDATE markets SET stock=?,pressure=?,previous_price=price,price=?,updated_at=?,revision=revision+1 WHERE district=? AND commodity=? AND revision=? RETURNING *').bind(nextStock,pressure,p,m.updated_at+hours*HOUR,district,commodity,m.revision).first<MarketRow>();if(updated)return updated
 }
 throw new HttpError(409,'Market changed; refresh prices')
}
export async function marketBoard(db:D1Database,district:string){const ids=[district,...neighbours(district)];return Promise.all(ids.flatMap(id=>COMMODITIES.map(c=>market(db,id,c.id))))}
export async function freightQuote(env:EconomyEnv,player:string,b:any){
 if(!b||Object.keys(b).sort().join(',')!=='commodity,competitive,destination,origin'||!COMMODITIES.some(c=>c.id===b.commodity)||typeof b.competitive!=='boolean')throw new HttpError(400,'Invalid freight quote')
 let origin:Geo,destination:Geo;try{origin=districtBounds(b.origin);destination=districtBounds(b.destination)}catch{throw new HttpError(400,'Invalid district')}
 if(!neighbours(b.origin).includes(b.destination)||distance(origin,destination)>6000)throw new HttpError(400,'Choose an adjacent district')
 const membership=await env.DB.prepare('SELECT m.crew_id,m.membership,c.hq FROM crew_members m JOIN crews c ON c.id=m.crew_id WHERE m.player_id=? AND c.active=1').bind(player).first<any>()
 if(b.competitive&&!membership)throw new HttpError(409,'Join a crew before opting into interception')
 const warehouse=await env.DB.prepare("SELECT id FROM global_properties WHERE owner_id=? AND status='active' AND area>=150 AND cell=? LIMIT 1").bind(player,b.origin.slice(3)).first<any>()
 const business=await env.DB.prepare("SELECT id FROM global_properties WHERE owner_id=? AND status='active' AND cell=? LIMIT 1").bind(player,b.destination.slice(3)).first<any>()
 const control=membership?await env.DB.prepare('SELECT district FROM territory_control WHERE district IN(?,?) AND crew_id=? AND expires_at>? LIMIT 1').bind(b.origin,b.destination,membership.crew_id,Date.now()).first():null
 const hq=membership?.hq?await env.DB.prepare("SELECT p.id FROM global_properties p JOIN crew_members m ON m.player_id=p.owner_id WHERE p.id=? AND p.status='active' AND m.crew_id=? AND p.cell IN(?,?)").bind(membership.hq,membership.crew_id,b.origin.slice(3),b.destination.slice(3)).first<any>():null
 const key=sourceCell(origin),res=await env.PROPERTY_SOURCE.get(env.PROPERTY_SOURCE.idFromName('freight:'+key)).fetch(`https://source/?cell=${key}&freight=1`)
 if(!res.ok)throw new HttpError(503,'Freight road source unavailable')
 let route;try{route=course(freightRoute((await res.json() as any).data,b.origin,b.destination),crypto.randomUUID())}catch(e){throw new HttpError(409,(e as Error).message)}
 const a=await market(env.DB,b.origin,b.commodity),d=await market(env.DB,b.destination,b.commodity),quantity=warehouse?6:4,{gross,fee}=freightReward(route.total,a.price,d.price,quantity,!!business,!!control),id=crypto.randomUUID(),now=Date.now()
 await env.DB.prepare('INSERT INTO freight_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,player,b.origin,b.destination,b.commodity,quantity,gross,fee,a.revision,d.revision,JSON.stringify(route),membership?.crew_id??null,membership?.membership??null,warehouse?.id??null,hq?.id??null,b.competitive?1:0,now,now+60000).run()
 return {id,origin:b.origin,destination:b.destination,commodity:b.commodity,quantity,gross,fee,net:gross-fee,route,competitive:b.competitive,expiresAt:now+60000,benefits:{warehouse:!!warehouse,business:!!business,territory:!!control,headquarters:!!hq}}
}
export async function admitFreight(db:D1Database,player:string,b:any,position:Geo){
 if(!b||b.playerId!==player||Object.keys(b).sort().join(',')!=='playerId,quoteId,requestId'||!requestId(b.requestId)||!requestId(b.quoteId))throw new HttpError(400,'Invalid freight admission')
 const prior=await db.prepare('SELECT * FROM shipments WHERE player_id=? AND request_id=?').bind(player,b.requestId).first<any>();if(prior){if(prior.quote_id!==b.quoteId)throw new HttpError(409,'Request key reused');return prior}
 const q=await db.prepare('SELECT * FROM freight_quotes WHERE id=? AND player_id=?').bind(b.quoteId,player).first<any>();if(!q||q.expires_at<=Date.now())throw new HttpError(409,'Quote expired')
 if(distance(position,JSON.parse(q.route).points[0])>100)throw new HttpError(409,'Drive to the source depot before loading')
 const id=crypto.randomUUID(),now=Date.now(),courier=await db.prepare('SELECT duration FROM courier_quotes WHERE quote_id=?').bind(q.id).first<{duration:number}>()
 try{await db.prepare("INSERT INTO shipments SELECT ?,player_id,?,id,origin,destination,commodity,quantity,gross,fee,gross-fee,crew_id,membership,competitive,'active',?,? FROM freight_quotes WHERE id=?").bind(id,b.requestId,now,now+(courier?.duration??(900000+(q.hq?120000:0))),q.id).run()}catch(e){const retry=await db.prepare('SELECT * FROM shipments WHERE player_id=? AND request_id=?').bind(player,b.requestId).first<any>();if(retry&&retry.quote_id===b.quoteId)return retry;if(/constraint|freight_|already_running/i.test(String(e)))throw new HttpError(409,'Shipment unavailable: refresh quote, finish your active run, or wait for your six-per-day allowance');throw e}
 return (await db.prepare('SELECT * FROM shipments WHERE id=?').bind(id).first<any>())!
}
export async function settleFreight(db:D1Database,id:string,outcome:'delivered'|'lost'|'cancelled',actor:string){
 await db.prepare('INSERT INTO freight_events SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM freight_events WHERE shipment_id=?)').bind(id,outcome,actor,Date.now(),id).run()
 return db.prepare('SELECT * FROM shipments WHERE id=?').bind(id).first<any>()
}
