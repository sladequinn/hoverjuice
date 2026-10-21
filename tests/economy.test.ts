import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {issueSession} from '../server/auth'
import {transactWallet} from '../server/wallet'
import {market,freightQuote,admitFreight,settleFreight} from '../server/economy'
import {Freight} from '../server/freight'
import {freightRoute} from '../server/economy-route'
import {COMMODITIES,BUDGET,course,car,advanceCar,freightPosition,gateLane,neighbours} from '../shared/economy'
import {districtBounds,districtFor} from '../shared/crews'
import {crewCommand,myCrew} from '../server/crews'
import {registerBuilding,quoteProperty,purchaseProperty} from '../server/property-registry'
import {parseBuildings,valueBuilding} from '../server/property-geometry'
import {sessionCookie} from '../server/security'
import api from '../server/api'
let mf:Miniflare,db:D1Database,n=0
const path=mkdtempSync(join(tmpdir(),'hg-economy-')),options=()=>convertV4MiniflareOptions({resourcePersistencePath:path,workers:[{name:'economy-test',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-01',d1Databases:['DB']}]})
const origin=districtFor({lat:43.45,lon:-80.49}),destination=neighbours(origin)[0],bounds=districtBounds(origin),start={lat:bounds.north-.0016,lon:bounds.lon},end={lat:bounds.north+.0016,lon:bounds.lon}
const road={elements:[{type:'way',id:100,nodes:[100,101,102],tags:{highway:'residential'},geometry:[start,{lat:bounds.north,lon:bounds.lon},end]}]}
const env=()=>({DB:db,PROPERTY_SOURCE:{idFromName:(id:string)=>id,get:()=>({fetch:async()=>Response.json({data:road})})}} as any)
const make=()=>issueSession(db,crypto.randomUUID())
async function quote(p:string,competitive=false){return freightQuote(env(),p,{origin,destination,commodity:'glimmer',competitive})}
async function admit(p:string,competitive=false){const q=await quote(p,competitive);return admitFreight(db,p,{playerId:p,quoteId:q.id,requestId:crypto.randomUUID()},q.route.points[0])}
class Store {data=new Map<string,any>();fail=false;async get(k:string){return structuredClone(this.data.get(k))}async put(k:string,v:any){if(this.fail)throw Error('write failed');this.data.set(k,structuredClone(v))}async setAlarm(_n:number){}}
function actor(id:string,store=new Store()){const f=new Freight({storage:store,blockConcurrencyWhile:(fn:any)=>fn()} as any,{DB:db} as any);return {store,f,call:async(action:string,body:any={})=>{const r=await f.fetch(new Request('https://freight/'+action,{method:'POST',body:JSON.stringify({id,...body})}));return {status:r.status,data:await r.json() as any}}}}
async function createCrew(p:string){await crewCommand(db,p,{playerId:p,requestId:crypto.randomUUID(),action:'create',name:'Freighters '+(++n),tag:'F'+n,color:'#73ffcb'});return (await myCrew(db,p))!}
before(async()=>{mf=new Miniflare(options());db=await mf.getD1Database('DB') as any;for(const name of ['0000_existing_scaffolding','0001_foundation','0002_multiplayer','0003_global_properties','0004_crews_territories','0005_underground_economy'])for(const q of readFileSync(`server/migrations/${name}.sql`,'utf8').replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|INSERT INTO (?:property_catalog_clock|freight_fund)|$)/).map(s=>s.trim()).filter(Boolean))await db.prepare(q).run()})
after(async()=>{await mf?.dispose();rmSync(path,{recursive:true,force:true})})
test('district prices differ; lazy production and shortages stay bounded without currency creation',async()=>{
 const a=await market(db,origin,'glimmer'),b=await market(db,destination,'glimmer');assert.notEqual(a.price,b.price)
 await db.prepare('UPDATE markets SET stock=0,pressure=100 WHERE district=? AND commodity=?').bind(origin,'glimmer').run()
 const stressed=await market(db,origin,'glimmer');assert.ok(stressed.price>a.price)
 const later=await market(db,origin,'glimmer',Date.now()+30*86400000);assert.ok(later.stock<=48);assert.equal(later.pressure,76);assert.equal((await db.prepare('SELECT available FROM freight_fund').first<any>()).available,BUDGET)
 // Restore clock after virtual-time lazy calculation, only in fixture.
 await db.prepare('UPDATE markets SET updated_at=?,stock=100,pressure=0 WHERE district=?').bind(Date.now(),origin).run()
})
test('road graph joins OSM identities, not geometric crossings; rejects private and disconnected routes',()=>{
 assert.ok(freightRoute(road,origin,destination).length>=2)
 assert.throws(()=>freightRoute({elements:[{...road.elements[0],tags:{highway:'residential',access:'private'}}]},origin,destination))
 assert.throws(()=>freightRoute({elements:[{...road.elements[0],nodes:[1,2],geometry:[start,{lat:bounds.north,lon:bounds.lon}]},{...road.elements[0],nodes:[3,4],geometry:[{lat:bounds.north,lon:bounds.lon},end]}]},origin,destination))
})
test('concurrent cargo reservation admits one buyer at the last stock; lost response reuses one reservation',async()=>{
 const [a,b]=await Promise.all([make(),make()]);await db.prepare('UPDATE markets SET stock=4,revision=revision+1 WHERE district=? AND commodity=?').bind(origin,'glimmer').run();const qa=await quote(a.playerId),qb=await quote(b.playerId),requests=[{playerId:a.playerId,quoteId:qa.id,requestId:crypto.randomUUID()},{playerId:b.playerId,quoteId:qb.id,requestId:crypto.randomUUID()}]
 const results=await Promise.allSettled(requests.map(r=>admitFreight(db,r.playerId,r,start)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 const i=results.findIndex(r=>r.status==='fulfilled'),s=(results[i] as PromiseFulfilledResult<any>).value;assert.equal((await admitFreight(db,requests[i].playerId,requests[i],start)).id,s.id)
 assert.equal((await market(db,origin,'glimmer')).stock,0);await settleFreight(db,s.id,'cancelled',s.player_id)
 await db.prepare('UPDATE markets SET stock=100,revision=revision+1 WHERE district=? AND commodity=?').bind(origin,'glimmer').run()
})
test('delivery changes destination stock/price and one wallet; simultaneous settlement and crash recovery cannot duplicate',async()=>{
 const a=await make(),s=await admit(a.playerId),before=await market(db,destination,'glimmer')
 await db.prepare("CREATE TRIGGER inject_freight_failure AFTER INSERT ON wallet_ledger WHEN NEW.reason='freight delivery' BEGIN SELECT RAISE(ABORT,'injected'); END").run();await assert.rejects(()=>settleFreight(db,s.id,'delivered',a.playerId),/injected/)
 assert.equal((await db.prepare('SELECT status FROM shipments WHERE id=?').bind(s.id).first<any>()).status,'active');assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,0)
 await db.prepare('DROP TRIGGER inject_freight_failure').run();await Promise.all([settleFreight(db,s.id,'delivered',a.playerId),settleFreight(db,s.id,'delivered',a.playerId)])
 const after=await market(db,destination,'glimmer');assert.equal(after.stock,before.stock+s.quantity);assert.ok(after.price<before.price);assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,s.net)
 await assert.rejects(()=>db.prepare('DELETE FROM freight_events WHERE shipment_id=?').bind(s.id).run(),/immutable/)
 const fund=await db.prepare('SELECT * FROM freight_fund').first<any>();assert.equal(fund.available+fund.reserved+fund.paid+fund.burned,BUDGET)
})
test('authoritative car cannot advance from client elapsed time, position, score, duplicate inputs or request floods',async()=>{
 const c=course([start,end],'fixture'),v=car(1000);v.throttle=1;advanceCar(c,v,100000);assert.ok(v.s<1,'offline time must not become travel');const pos=v.s;for(let i=0;i<100;i++)advanceCar(c,v,100000);assert.equal(v.s,pos)
 const a=await make(),s=await admit(a.playerId),x=actor(s.id);await x.call('view');const invalid=await x.call('input',{player:a.playerId,input:{seq:1,throttle:1,steer:0,position:end,elapsed:900000}});assert.equal(invalid.status,400)
 assert.equal((await x.call('finish',{player:a.playerId,score:999})).status,400)
 const b=await make();assert.equal((await x.call('input',{player:b.playerId,input:{seq:1,throttle:1,steer:0}})).status,403)
 const original=Date.now;let now=original();try{Date.now=()=>now;await x.call('input',{player:a.playerId,input:{seq:1,throttle:1,steer:0}});for(let i=0;i<20;i++)await x.call('input',{player:a.playerId,input:{seq:1,throttle:1,steer:0}});assert.equal((await x.call('view')).data.driver.s,0)
  for(let seq=2;seq<200&&((await x.call('view')).data.status==='active');seq++){now+=250;const state=(await x.call('view')).data,vehicle=state.driver,target=gateLane(state.course,vehicle.gate),steer=Math.abs(target-vehicle.lane)<.5?0:Math.sign(target-vehicle.lane);const result=await x.call('input',{player:a.playerId,input:{seq,throttle:1,steer}});assert.equal(result.status,200)}
  const result=(await x.call('view')).data;assert.equal(result.status,'delivered');assert.ok(result.driver.s>=result.course.total)
 }finally{Date.now=original}
})
test('rival crew interception is paid once, takes actual simulated pursuit and persists a destination shortage',async()=>{
 const [a,b]=await Promise.all([make(),make()]);await createCrew(a.playerId);await createCrew(b.playerId);await transactWallet(db,b.playerId,'fixture-funding',10000,'test');const s=await admit(a.playerId,true),x=actor(s.id);await x.call('view')
 const original=Date.now;let now=original();try{Date.now=()=>now;let seq=0;for(let i=0;i<90;i++){now+=250;const v=(await x.call('view')).data;if(v.driver.s>v.course.total*.4)break;await x.call('input',{player:a.playerId,input:{seq:++seq,throttle:1,steer:0}})}
  let v=(await x.call('view')).data;assert.ok(v.driver.s>v.course.total*.25);const before=await market(db,destination,'glimmer')
  x.store.fail=true;assert.equal((await x.call('intercept',{player:b.playerId,position:freightPosition(v.course,v.driver)})).status,503);x.store.fail=false
  assert.equal((await x.call('intercept',{player:b.playerId,position:freightPosition(v.course,v.driver)})).status,200);assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(b.playerId).first<any>()).balance,7500)
  let attackSeq=0;for(let i=0;i<220;i++){now+=250;v=(await x.call('view')).data;if(v.status!=='active')break;await x.call('input',{player:a.playerId,input:{seq:++seq,throttle:-1,steer:0}});const aCar=v.attacker.car,delta=v.driver.s-aCar.s;await x.call('input',{player:b.playerId,input:{seq:++attackSeq,throttle:delta>8?1:-1,steer:0}})}
  v=(await x.call('view')).data;assert.equal(v.status,'lost');const after=await market(db,destination,'glimmer');assert.ok(after.pressure>before.pressure);assert.ok(after.price>before.price);assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,0)
 }finally{Date.now=original}
})
test('quota, empty treasury, wrong account and forged quote contents cannot reserve or pay',async()=>{
 const a=await make();const q=await quote(a.playerId);await assert.rejects(()=>admitFreight(db,a.playerId,{playerId:crypto.randomUUID(),quoteId:q.id,requestId:crypto.randomUUID()},start),/Invalid/);await assert.rejects(()=>admitFreight(db,a.playerId,{playerId:a.playerId,quoteId:q.id,requestId:crypto.randomUUID(),gross:999999},start),/Invalid/)
 const fund=await db.prepare('SELECT available,reserved FROM freight_fund').first<any>();await db.prepare('UPDATE freight_fund SET reserved=reserved+available,available=0').run();await assert.rejects(()=>admit(a.playerId),/unavailable/);await db.prepare('UPDATE freight_fund SET available=?,reserved=?').bind(fund.available,fund.reserved).run()
 for(let i=0;i<6;i++){const s=await admit(a.playerId);await settleFreight(db,s.id,'cancelled',a.playerId)}await assert.rejects(()=>admit(a.playerId),/allowance/)
})
test('HTTP authentication and disabled fallback reject unauthorized economy changes',async()=>{
 const a=await make(),config={...env(),APP_ORIGIN:'https://game.test',BACKEND_ENABLED:'true',MULTIPLAYER_ENABLED:'true',CREWS_ENABLED:'true',PROPERTIES_ENABLED:'true',ECONOMY_ENABLED:'true'}
 for(const [secret,originHeader,status]of [['bad','https://game.test',401],[a.secret,'https://evil.test',403]]){const r=await api.fetch(new Request('https://game.test/api/economy/quote',{method:'POST',headers:{Cookie:`${sessionCookie}=${secret}`,Origin:originHeader,'Content-Type':'application/json'},body:'{}'}),config);assert.equal(r.status,status)}
 const disabled=await api.fetch(new Request('https://game.test/api/economy/status'),{...config,ECONOMY_ENABLED:'false'});assert.equal((await disabled.json() as any).enabled,false)
})
test('owned warehouse capacity, HQ grace and territory fees use authoritative property and membership records',async()=>{
 const a=await make(),crew=await createCrew(a.playerId);await transactWallet(db,a.playerId,'fixture-property',100000000,'test');const lat=bounds.lat,lon=bounds.lon
 const building=parseBuildings({elements:[{type:'way',id:556677,version:1,tags:{building:'warehouse'},geometry:[{lat,lon},{lat:lat+.0003,lon},{lat:lat+.0003,lon:lon+.0003},{lat,lon:lon+.0003},{lat,lon}]}]})[0],property=await registerBuilding(db,building,valueBuilding(building,[building]),Date.now()),pq=await quoteProperty(db,a.playerId,property)
 await purchaseProperty(db,a.playerId,{playerId:a.playerId,quoteId:pq!.id,requestId:crypto.randomUUID()});await crewCommand(db,a.playerId,{playerId:a.playerId,requestId:crypto.randomUUID(),action:'hq',value:property.id})
 await db.prepare('INSERT INTO territory_results VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),origin,crew.id,'[]',Date.now()).run()
 const q=await quote(a.playerId,true);assert.equal(q.quantity,6);assert.ok(q.benefits.warehouse);assert.ok(q.benefits.headquarters);assert.ok(q.benefits.territory);assert.equal(q.fee,Math.ceil(q.gross*.10))
 const admitted=await admitFreight(db,a.playerId,{playerId:a.playerId,quoteId:q.id,requestId:crypto.randomUUID()},start);assert.equal(admitted.expires_at-admitted.created_at,1020000);await settleFreight(db,admitted.id,'cancelled',a.playerId)
 const changed=await quote(a.playerId,true);await db.prepare("UPDATE global_properties SET status='review' WHERE id=?").bind(property.id).run();await assert.rejects(()=>admitFreight(db,a.playerId,{playerId:a.playerId,quoteId:changed.id,requestId:crypto.randomUUID()},start),/unavailable/)
})
test('undeparted timeout refunds stock and escrow; departed failure affects demand once',async()=>{
 const a=await make(),s=await admit(a.playerId),x=actor(s.id),before=await market(db,origin,'glimmer');await x.call('view');const original=Date.now
 try{Date.now=()=>s.expires_at+1;const v=(await x.call('view')).data;assert.equal(v.status,'cancelled');await x.call('view')}finally{Date.now=original}
 assert.equal((await market(db,origin,'glimmer')).stock,before.stock+s.quantity);assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,0)
})
test('market stock, receipts, fund and wallet survive full database service restart',async()=>{
 const a=await make(),s=await admit(a.playerId);await settleFreight(db,s.id,'delivered',a.playerId);const before=await market(db,destination,'glimmer'),fund=await db.prepare('SELECT * FROM freight_fund').first();await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB') as any
 assert.equal((await market(db,destination,'glimmer')).stock,before.stock);assert.deepEqual(await db.prepare('SELECT * FROM freight_fund').first(),fund);await settleFreight(db,s.id,'delivered',a.playerId);assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,s.net)
})

test('destination capacity is reserved atomically and released exactly once on settlement',async()=>{
 const [a,b]=await Promise.all([make(),make()]);const before=await market(db,destination,'glimmer');
 await db.prepare('UPDATE markets SET stock=496-incoming,revision=revision+1 WHERE district=? AND commodity=?').bind(destination,'glimmer').run();
 const qa=await quote(a.playerId),qb=await quote(b.playerId);
 const results=await Promise.allSettled([qa,qb].map((q,i)=>admitFreight(db,[a,b][i].playerId,{playerId:[a,b][i].playerId,quoteId:q.id,requestId:crypto.randomUUID()},start)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const s=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;
 const reserved=await market(db,destination,'glimmer');assert.equal(reserved.stock+reserved.incoming,500);
 await settleFreight(db,s.id,'delivered',s.player_id);await settleFreight(db,s.id,'delivered',s.player_id);
 const settled=await market(db,destination,'glimmer');assert.equal(settled.incoming,reserved.incoming-s.quantity);assert.equal(settled.stock,reserved.stock+s.quantity);
 await db.prepare('UPDATE markets SET stock=?,revision=revision+1 WHERE district=? AND commodity=?').bind(before.stock,destination,'glimmer').run();
})
