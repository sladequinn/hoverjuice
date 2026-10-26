import {GOODS,MASK_CATALOG,starterState,cargoCount,capacity,vehiclePrice,performancePrice,exchange,streetPrice,streetOrderPrice,type StreetState} from '../shared/street'
import {VEHICLES} from '../src/data'
import {PAINTS,buildFor,UPGRADES} from '../src/customization'
import {distance,type Geo} from '../shared/multiplayer'
import {districtBounds} from '../shared/crews'
import {requestId} from '../shared/properties'
import {hash,HttpError} from './security'
export async function streetAccount(db:D1Database,player:string){
 await db.prepare('INSERT OR IGNORE INTO street_accounts(player_id,state) VALUES(?,?)').bind(player,JSON.stringify(starterState())).run()
 const a=(await db.prepare('SELECT revision,state FROM street_accounts WHERE player_id=?').bind(player).first<any>())!
 return {revision:a.revision,state:JSON.parse(a.state) as StreetState}
}
export async function streetMe(db:D1Database,player:string){const a=await streetAccount(db,player),wallet=await db.prepare('SELECT balance,version FROM wallets WHERE player_id=?').bind(player).first();return {player,...a,wallet}}
export async function streetBoard(db:D1Database,district:string,now=Date.now()){
 try{districtBounds(district)}catch{throw new HttpError(400,'Invalid district')}
 return Promise.all(GOODS.map(async g=>{
  await db.prepare('INSERT OR IGNORE INTO street_markets(district,good,stock,updated_at) VALUES(?,?,80,?)').bind(district,g.id,now).run()
  // Slow production towards baseline; incoming player sales are never silently destroyed.
  await db.prepare('UPDATE street_markets SET stock=min(80,stock+min(24,cast((?-updated_at)/3600000 AS INTEGER))*2),revision=revision+1,updated_at=? WHERE district=? AND good=? AND stock<80 AND updated_at<=?').bind(now,now,district,g.id,now-3600000).run()
  const m=await db.prepare('SELECT * FROM street_markets WHERE district=? AND good=?').bind(district,g.id).first<any>()
  return {...m,at:now,...streetPrice(district,g.id,m.stock,now)}
 }))
}
const exact=(b:any,keys:string)=>b&&typeof b==='object'&&!Array.isArray(b)&&Object.keys(b).sort().join(',')===keys
function nearExchange(district:string,position:Geo){if(distance(exchange(district),position)>2200)throw new HttpError(409,'Drive to the district exchange to trade')}
function travelled(s:StreetState,position:Geo,now:number){
 // Persistent travel budget survives city jumps, reconnects, tabs and devices.
 if(s.travel&&distance(s.travel,position)>200+(now-s.travel.at)*.045)throw new HttpError(409,'Cargo is still in transit. Drive to the exchange before trading')
}
export async function streetQuote(db:D1Database,player:string,b:any,position:Geo,now=Date.now()){
 if(!exact(b,'district,good,quantity,side')||!GOODS.some(g=>g.id===b.good)||!['buy','sell'].includes(b.side)||!Number.isSafeInteger(b.quantity)||b.quantity<1||b.quantity>70)throw new HttpError(400,'Invalid trade quote')
 try{districtBounds(b.district)}catch{throw new HttpError(400,'Invalid district')}
 nearExchange(b.district,position)
 const {state:s}=await streetAccount(db,player);travelled(s,position,now)
 const rows=await streetBoard(db,b.district,now),m=rows.find(m=>m.good===b.good)!,price=streetOrderPrice(b.district,b.good,m.stock,b.side,b.quantity,now),id=crypto.randomUUID()
 await db.prepare('INSERT INTO street_quotes VALUES(?,?,?,?,?,?,?,?,?)').bind(id,player,b.district,b.good,b.side,b.quantity,price,m.revision,now+30000).run()
 return {id,...b,unitPrice:price,total:price*b.quantity,expiresAt:now+30000}
}
interface Receipt {delta:number;reason:string;district?:string;good?:string;stockDelta?:number;marketRevision?:number;quoteId?:string}
async function commit(db:D1Database,player:string,b:any,fingerprint:string,state:StreetState,r:Receipt){
 try{await db.prepare(`INSERT INTO street_receipts SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM street_receipts WHERE player_id=? AND request_id=?)`).bind(player,b.requestId,fingerprint,b.expectedRevision,JSON.stringify(state),r.delta,r.reason,r.district??null,r.good??null,r.stockDelta??0,r.marketRevision??null,r.quoteId??null,Date.now(),player,b.requestId).run()}catch(e){
  const prior=await db.prepare('SELECT fingerprint FROM street_receipts WHERE player_id=? AND request_id=?').bind(player,b.requestId).first<any>()
  if(prior?.fingerprint===fingerprint)return streetMe(db,player)
  if(/constraint|street_|dealer_|wallet_/i.test(String(e)))throw new HttpError(409,'Balance, stock or account changed. Refresh and try again')
  throw e
 }
 const receipt=await db.prepare('SELECT fingerprint FROM street_receipts WHERE player_id=? AND request_id=?').bind(player,b.requestId).first<any>()
 if(receipt?.fingerprint!==fingerprint)throw new HttpError(409,'Request key reused for a different command')
 return streetMe(db,player)
}
async function commandStart(db:D1Database,player:string,b:any,keys:string){
 if(!exact(b,keys)||b.playerId!==player||!requestId(b.requestId)||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0)throw new HttpError(400,'Invalid account command')
 const fingerprint=await hash(JSON.stringify(Object.keys(b).sort().map(k=>[k,b[k]]))),prior=await db.prepare('SELECT fingerprint FROM street_receipts WHERE player_id=? AND request_id=?').bind(player,b.requestId).first<any>()
 if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError(409,'Request key reused for a different command');return {fingerprint,prior:true,state:starterState()}}
 const a=await streetAccount(db,player);if(a.revision!==b.expectedRevision)throw new HttpError(409,'Account changed; refresh before trying again')
 return {fingerprint,prior:false,state:a.state}
}
export async function streetTrade(db:D1Database,player:string,b:any,position:Geo){
 const c=await commandStart(db,player,b,'expectedRevision,playerId,quoteId,requestId');if(c.prior)return streetMe(db,player)
 if(!requestId(b.quoteId))throw new HttpError(400,'Invalid quote')
 const q=await db.prepare('SELECT * FROM street_quotes WHERE id=? AND player_id=?').bind(b.quoteId,player).first<any>(),now=Date.now()
 if(!q||q.expires_at<=now)throw new HttpError(409,'Trade quote expired')
 nearExchange(q.district,position);travelled(c.state,position,now)
 const change=q.side==='buy'?q.quantity:-q.quantity,s=c.state
 if(change>0&&cargoCount(s)+change>capacity(s))throw new HttpError(409,'Cargo hold is full')
 if(change<0&&(s.cargo[q.good]??0)<-change)throw new HttpError(409,'Not enough cargo to sell')
 s.cargo[q.good]=(s.cargo[q.good]??0)+change;s.travel={lat:position.lat,lon:position.lon,at:now}
 return commit(db,player,b,c.fingerprint,s,{delta:-change*q.unit_price,reason:`${q.side} ${q.good}`,district:q.district,good:q.good,stockDelta:-change,marketRevision:q.market_revision,quoteId:q.id})
}
export async function streetCommand(db:D1Database,player:string,b:any,position:Geo){
 const c=await commandStart(db,player,b,'action,expectedRevision,item,playerId,requestId');if(c.prior)return streetMe(db,player)
 if(typeof b.item!=='string'||typeof b.action!=='string')throw new HttpError(400,'Invalid command')
 const s=c.state;let cost=0
 switch(b.action){
  case 'buy-vehicle':{const v=VEHICLES.find(v=>v.id===b.item);if(!v||s.vehicles.includes(v.id))throw new HttpError(409,'Vehicle unavailable');cost=vehiclePrice(v.id);s.vehicles.push(v.id);break}
  case 'equip-vehicle':if(!s.vehicles.includes(b.item))throw new HttpError(403,'Purchase this vehicle first');s.current=b.item;if(cargoCount(s)>capacity(s))throw new HttpError(409,'Unload cargo before switching to a smaller vehicle');break
  case 'buy-mask':{const m=MASK_CATALOG.find(m=>m.id===b.item);if(!m||s.masks.includes(m.id))throw new HttpError(409,'Mask unavailable');cost=m.price;s.masks.push(m.id);break}
  case 'equip-mask':if(!s.masks.includes(b.item))throw new HttpError(403,'Purchase this mask first');s.mask=b.item;break
  case 'upgrade':{const u=UPGRADES.find(u=>u.id===b.item);if(!u)throw new HttpError(400,'Unknown upgrade');const build={...buildFor(s.builds,s.current)};if(build[u.id]>=3)throw new HttpError(409,'Upgrade is already maxed');cost=performancePrice(s,u.id);build[u.id]++;s.builds[s.current]=build;break}
  case 'paint':{if(b.item!=='factory'&&!PAINTS.some(p=>p.id===b.item))throw new HttpError(400,'Unknown paint');s.builds[s.current]={...buildFor(s.builds,s.current),paint:b.item==='factory'?undefined:b.item};break}
  case 'stash':case 'withdraw':{
   travelled(s,position,Date.now())
   const titles=(await db.prepare("SELECT lat,lon FROM global_properties WHERE owner_id=? AND status='active'").bind(player).all<Geo>()).results
   if(!titles.some(p=>distance(p,position)<120))throw new HttpError(409,'Park near one of your properties to use its stash')
   if(b.action==='stash'){for(const [id,n]of Object.entries(s.cargo))s.vault[id]=(s.vault[id]??0)+n;s.cargo={}}
   else{let room=capacity(s)-cargoCount(s);for(const [id,n]of Object.entries(s.vault)){const take=Math.min(room,n);s.cargo[id]=(s.cargo[id]??0)+take;s.vault[id]-=take;room-=take}}
   s.travel={lat:position.lat,lon:position.lon,at:Date.now()};break
  }
  default:throw new HttpError(400,'Unknown command')
 }
 return commit(db,player,b,c.fingerprint,s,{delta:-cost,reason:b.action+' '+b.item})
}
