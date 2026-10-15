import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {issueSession} from '../server/auth'
import {crewCommand,myCrew} from '../server/crews'
import {Territory,advanceRun} from '../server/territory'
import {territoryCourse} from '../server/territory-course'
import {districtFor,districtBounds,type Contest,type Run} from '../shared/crews'
import {registerBuilding,purchaseProperty,quoteProperty,propertyView} from '../server/property-registry'
import {parseBuildings,valueBuilding} from '../server/property-geometry'
import {transactWallet} from '../server/wallet'
import api from '../server/api'
import {sessionCookie} from '../server/security'
let mf:Miniflare,db:D1Database,n=0
const make=()=>issueSession(db,crypto.randomUUID())
const command=(p:string,action:string,extra:any={})=>crewCommand(db,p,{playerId:p,action,requestId:crypto.randomUUID(),...extra})
async function crew(p:string){await command(p,'create',{name:'Crew '+(++n),tag:'C'+n,color:'#73ffcb'});return (await myCrew(db,p))!}
async function title(p:string,lat:number,lon:number){const b=parseBuildings({elements:[{type:'way',id:90000+(++n),version:1,tags:{building:'house'},geometry:[{lat,lon},{lat:lat+.0002,lon},{lat:lat+.0002,lon:lon+.0002},{lat,lon:lon+.0002},{lat,lon}]}]})[0];await transactWallet(db,p,'fixture-'+n,100000000,'test');const v=await registerBuilding(db,b,valueBuilding(b,[b]),Date.now()),q=await quoteProperty(db,p,v);await purchaseProperty(db,p,{playerId:p,quoteId:q!.id,requestId:crypto.randomUUID()});return v}
class Storage {data=new Map<string,any>();fail=false;async get(k:string){return structuredClone(this.data.get(k))}async put(k:any,v?:any){if(this.fail)throw Error('storage failed');if(typeof k==='string')this.data.set(k,structuredClone(v));else for(const [key,value]of Object.entries(k))this.data.set(key,structuredClone(value))}async setAlarm(_n:number){} }
const center=districtBounds(districtFor({lat:43.45,lon:-80.49})),district=districtFor(center)
const road={elements:[{type:'way',id:1,tags:{highway:'residential'},geometry:[{lat:center.lat,lon:center.lon-.003},{lat:center.lat,lon:center.lon},{lat:center.lat,lon:center.lon+.003}]}]}
function actor(storage=new Storage()){
 const env={DB:db,PROPERTY_SOURCE:{idFromName:(s:string)=>s,get:()=>({fetch:async()=>Response.json({data:road})})}} as any
 const a=new Territory({storage,blockConcurrencyWhile:(f:any)=>f()} as any,env)
 const call=async(path:string,b:any={})=>{const r=await a.fetch(new Request('https://territory/'+path,{method:'POST',body:JSON.stringify({district,...b})}));return {status:r.status,data:await r.json() as any}}
 return {a,storage,call}
}
before(async()=>{mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'crews',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-01',d1Databases:['DB']}]}));db=await mf.getD1Database('DB') as any
 for(const name of ['0000_existing_scaffolding','0001_foundation','0002_multiplayer','0003_global_properties','0004_crews_territories'])for(const q of readFileSync(`server/migrations/${name}.sql`,'utf8').replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|INSERT INTO property_catalog_clock|$)/).map(s=>s.trim()).filter(Boolean))await db.prepare(q).run()
})
after(async()=>{await mf?.dispose()})
test('global districts are deterministic, wrap the dateline and cover polar bands',()=>{
 for(const p of [{lat:0,lon:180},{lat:89.999,lon:-180},{lat:-90,lon:180},{lat:-33.86,lon:151.2}]){const id=districtFor(p),b=districtBounds(id);assert.equal(districtFor(b),id);assert.ok(b.north>b.south);assert.ok(b.east>b.west)}
 assert.equal(districtFor({lat:0,lon:180}),districtFor({lat:0,lon:-180}));assert.throws(()=>districtBounds('d1:9999:1'));assert.throws(()=>districtBounds('d1:0100:1'));assert.throws(()=>districtBounds('d1:100:01'))
})
test('crew commands are atomic, idempotent, account-bound and reject forged authority',async()=>{
 const a=await make(),b=await make(),body={playerId:a.playerId,action:'create',requestId:crypto.randomUUID(),name:'Idempotent crew',tag:'IDEM',color:'#73ffcb'}
 const r=await Promise.all([crewCommand(db,a.playerId,body),crewCommand(db,a.playerId,body)]);assert.deepEqual(r[0],r[1])
 await assert.rejects(()=>crewCommand(db,b.playerId,body),/Invalid/);await assert.rejects(()=>crewCommand(db,a.playerId,{...body,name:'Changed'}),/already used/)
 const c=(await myCrew(db,a.playerId))!;await command(b.playerId,'join',{code:c.invite});assert.equal((await myCrew(db,b.playerId))!.invite,undefined)
 await assert.rejects(()=>command(b.playerId,'role',{target:a.playerId,value:'officer'}),/rejected/)
 await assert.rejects(()=>command(a.playerId,'leave'),/rejected/)
 await command(a.playerId,'transfer',{target:b.playerId});assert.equal((await myCrew(db,b.playerId))!.role,'leader')
 await command(a.playerId,'leave');await assert.rejects(()=>command(a.playerId,'join',{code:c.invite}),/rejected/)
})
test('concurrent last-seat admissions allow exactly one member; one crew per account',async()=>{
 const a=await make(),c=await crew(a.playerId)
 for(let i=0;i<14;i++){const p=await make();await command(p.playerId,'join',{code:c.invite})}
 const [x,y]=await Promise.all([make(),make()]),result=await Promise.allSettled([command(x.playerId,'join',{code:c.invite}),command(y.playerId,'join',{code:c.invite})])
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await myCrew(db,a.playerId))!.members.length,16)
 await assert.rejects(()=>crew(a.playerId),/rejected/)
})
test('HQ requires own active title and officer authority; departure clears HQ without changing ownership',async()=>{
 const [a,b]=await Promise.all([make(),make()]),c=await crew(a.playerId),p=await title(b.playerId,40,-75)
 await command(b.playerId,'join',{code:c.invite});await assert.rejects(()=>command(a.playerId,'hq',{value:p.id}),/rejected/);await assert.rejects(()=>command(b.playerId,'hq',{value:p.id}),/rejected/)
 await command(a.playerId,'role',{target:b.playerId,value:'officer'});await command(b.playerId,'hq',{value:p.id});assert.equal((await myCrew(db,a.playerId))!.hq,p.id)
 await command(b.playerId,'leave');assert.equal((await myCrew(db,a.playerId))!.hq,null);assert.equal((await propertyView(db,p.id)).ownerId,b.playerId)
})
test('server road selection ignores client input, rejects private/incomplete roads and produces ordered return gates',()=>{
 const c=territoryCourse(road,center);assert.ok(c.length>10);assert.deepEqual(c[0],c.at(-1));assert.throws(()=>territoryCourse({...road,remark:'timeout'},center));assert.throws(()=>territoryCourse({elements:[{...road.elements[0],tags:{highway:'residential',access:'private'}}]},center))
})
function run(player='p',crew='c'):Run{return {player,crew,membership:'m',name:'Driver',attempts:0,next:0,started:0,best:null,last:null,invalid:''}}
function contest():Contest{return {id:'id',district,course:territoryCourse(road,center),startsAt:1000,closesAt:121000,endsAt:601000,runs:[],finished:false,winner:null}}
function drive(r:Run,c:Contest,step=2000){let now=c.startsAt;for(let i=0;i<c.course.length;i++){const p={...c.course[i],id:r.player,epoch:1,seq:i,at:now,y:100,clearance:1} as any;advanceRun(r,p,c,now);now+=step}return now}
test('ordered continuous road delivery scores from server time; replay, teleport, flight and reconnect cannot finish',()=>{
 const c=contest(),r=run();drive(r,c);assert.ok(r.best!>10000);const best=r.best;drive(r,c);assert.equal(r.best,best)
 for(const mode of ['teleport','flight','gap','epoch']){const r=run(),p={...c.course[0],id:'p',epoch:1,seq:1,at:1000,y:100,clearance:1} as any;advanceRun(r,p,c,1000);assert.equal(r.next,1);const next={...p,...c.course[4],seq:2,at:2000,...(mode==='flight'?{clearance:50}:mode==='epoch'?{epoch:2}:mode==='gap'?{at:6000}:{})};advanceRun(r,next,c,next.at);assert.equal(r.best,null);assert.equal(r.next,0)}
})
test('two crews establish HQ, compete, finalize once, recover a failed persistence write and keep personal titles',async()=>{
 const [a,b]=await Promise.all([make(),make()]),ca=await crew(a.playerId),cb=await crew(b.playerId),pa=await title(a.playerId,center.lat-.001,center.lon),pb=await title(b.playerId,center.lat+.001,center.lon)
 await command(a.playerId,'hq',{value:pa.id});await command(b.playerId,'hq',{value:pb.id})
 const x=actor();assert.equal((await x.call('open',{player:a.playerId,position:center})).status,200)
 for(const p of [a,b])assert.equal((await x.call('join',{player:p.playerId,position:center,name:'Driver'})).status,200)
 let c=await x.storage.get('contest') as Contest;assert.equal(c.runs.length,2)
 // Movement validator with virtual server times, no arbitrary client scores.
 drive(c.runs[0],c,1500);drive(c.runs[1],c,2000);assert.ok(c.runs.every(r=>r.best!==null));c.endsAt=Date.now()-1;await x.storage.put('contest',c)
 await db.prepare("CREATE TRIGGER injected_territory_failure AFTER INSERT ON territory_results BEGIN SELECT RAISE(ABORT,'injected_failure'); END").run()
 assert.equal((await x.call('view')).status,503);assert.equal(await db.prepare('SELECT * FROM territory_results WHERE contest_id=?').bind(c.id).first(),null);assert.equal((await myCrew(db,a.playerId))!.reputation,0)
 await db.prepare('DROP TRIGGER injected_territory_failure').run();x.storage.fail=true;assert.equal((await x.call('view')).status,503);x.storage.fail=false
 const recovered=actor(x.storage),view=(await recovered.call('view')).data
 assert.equal(view.controller,ca.id);assert.equal((await myCrew(db,a.playerId))!.reputation,10);assert.equal((await myCrew(db,b.playerId))!.reputation,0)
 await recovered.call('view');await recovered.a.alarm();assert.equal((await myCrew(db,a.playerId))!.reputation,10)
 assert.equal((await propertyView(db,pa.id)).ownerId,a.playerId);assert.equal((await propertyView(db,pb.id)).ownerId,b.playerId)
 assert.equal((await actor(x.storage).call('view')).data.controller,ca.id)
 assert.equal((await x.call('open',{player:b.playerId,position:center})).status,409)
 // Expiration is read-time, with no simulation or alarm for idle regions.
 await db.prepare('UPDATE territory_control SET expires_at=0 WHERE district=?').bind(district).run();assert.equal((await recovered.call('view')).data.controller,null)
 assert.notEqual(ca.id,cb.id)
})
test('no finisher cannot erase control; cross-district cap and immutable results prevent monopoly/reward replay',async()=>{
 const a=await make(),c=await crew(a.playerId),at=Date.now()
 for(let i=0;i<4;i++)await db.prepare('INSERT INTO territory_results VALUES(?,?,?,?,?)').bind('cap-'+c.id+i,'d1:100:'+i,c.id,'[]',at).run()
 assert.equal((await db.prepare('SELECT count(*) AS n FROM territory_control WHERE crew_id=? AND expires_at>?').bind(c.id,at).first<any>()).n,3);assert.equal((await myCrew(db,a.playerId))!.reputation,30)
 const id='d1:100:0';await db.prepare('INSERT INTO territory_results VALUES(?,?,NULL,?,?)').bind('no-finish-'+c.id,id,'[]',at).run();assert.equal((await db.prepare('SELECT crew_id FROM territory_control WHERE district=?').bind(id).first<any>()).crew_id,c.id);assert.equal((await myCrew(db,a.playerId))!.reputation,30)
 await assert.rejects(()=>db.prepare('DELETE FROM territory_results WHERE district=?').bind(id).run(),/immutable_result/)
})
test('crew HTTP rejects unsigned, cross-origin, identity injection and disabled requests',async()=>{
 const a=await make(),env={DB:db,APP_ORIGIN:'https://game.test',BACKEND_ENABLED:'true',MULTIPLAYER_ENABLED:'true',PROPERTIES_ENABLED:'true',CREWS_ENABLED:'true'} as any
 for(const [secret,origin,status]of [['bad','https://game.test',401],[a.secret,'https://evil.test',403]]){
  const r=await api.fetch(new Request('https://game.test/api/crews/command',{method:'POST',headers:{Cookie:`${sessionCookie}=${secret}`,Origin:origin,'Content-Type':'application/json'},body:'{}'}),env);assert.equal(r.status,status)
 }
 const status=await api.fetch(new Request('https://game.test/api/crews/status'),{...env,CREWS_ENABLED:'false'});assert.equal((await status.json() as any).enabled,false)
 const r=await api.fetch(new Request('https://game.test/api/crews/contest',{method:'POST',headers:{Cookie:`${sessionCookie}=${a.secret}`,Origin:'https://game.test','Content-Type':'application/json'},body:JSON.stringify({action:'join',district,score:999})}),env);assert.equal(r.status,400)
})

test('removed members cannot contribute to the final result and empty contests cannot renew control',async()=>{
 const a=await make(),b=await make(),c=await crew(a.playerId),p=await title(a.playerId,center.lat-.003,center.lon)
 await command(a.playerId,'hq',{value:p.id});await command(b.playerId,'join',{code:c.invite})
 await db.prepare('UPDATE territory_control SET protected_until=0 WHERE district=?').bind(district).run()
 const x=actor();assert.equal((await x.call('open',{player:a.playerId,position:center})).status,200);assert.equal((await x.call('join',{player:b.playerId,position:center,name:'Driver'})).status,200)
 const round=await x.storage.get('contest');drive(round.runs[0],round);assert.ok(round.runs[0].best);round.endsAt=Date.now()-1;await x.storage.put('contest',round)
 await command(a.playerId,'kick',{target:b.playerId});const previous=await db.prepare('SELECT crew_id,expires_at FROM territory_control WHERE district=?').bind(district).first<any>()
 await x.call('view');const result=await db.prepare('SELECT winner FROM territory_results WHERE contest_id=?').bind(round.id).first<any>();assert.equal(result.winner,null)
 const after=await db.prepare('SELECT crew_id,expires_at FROM territory_control WHERE district=?').bind(district).first<any>();assert.deepEqual(after,previous);assert.equal((await myCrew(db,a.playerId))!.reputation,0)
})
