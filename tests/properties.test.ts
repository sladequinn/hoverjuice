import {PropertySource} from '../server/property-source'
import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {issueSession} from '../server/auth'
import {transactWallet} from '../server/wallet'
import {propertyView,purchaseProperty,quoteProperty,registerBuilding,resolveProperty,refreshProperty,portfolio} from '../server/property-registry'
import {parseBuildings,contains,overlap,valueBuilding} from '../server/property-geometry'
import api from '../server/api'
import {sessionCookie} from '../server/security'
const origin='https://game.test'
let mf:Miniflare,db:D1Database,serial=1000
const persistence=mkdtempSync(join(tmpdir(),'hoverghini-properties-'))
const options=()=>convertV4MiniflareOptions({resourcePersistencePath:persistence,workers:[{name:'property-test',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-01',d1Databases:['DB']}]})
const ring=(lat=43,lon=-80,size=.0002)=>[{lat,lon},{lat,lon:lon+size},{lat:lat+size,lon:lon+size},{lat:lat+size,lon},{lat,lon}]
const element=(id=++serial,lat=43,lon=-80,extra:any={})=>({type:'way',id,version:1,tags:{building:'house','building:levels':'2'},geometry:ring(lat,lon),...extra})
const source=(elements:any[],at=Date.now())=>({PROPERTY_SOURCE:{idFromName:(s:string)=>s,get:()=>({fetch:async()=>Response.json({at,data:{elements}})})},DB:db}) as any
const env=(elements:any[]=[])=>({...source(elements),APP_ORIGIN:origin,BACKEND_ENABLED:'true',PROPERTIES_ENABLED:'true',ALLOWED_ORIGIN:origin}) as any
const create=()=>issueSession(db,crypto.randomUUID())
const funded=async()=>{const a=await create();await transactWallet(db,a.playerId,'trusted-test-grant',1000000000,'test fixture');return a}
const request=(path:string,secret:string,body?:unknown,requestOrigin=origin)=>new Request(origin+'/api/properties/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:requestOrigin,Cookie:`${sessionCookie}=${secret}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
const pending=(playerId:string,quoteId:string)=>({playerId,quoteId,requestId:crypto.randomUUID()})
async function property(lat=43+serial*.002){const b=parseBuildings({elements:[element(undefined,lat)]})[0];return registerBuilding(db,b,valueBuilding(b,[b]),Date.now())}
before(async()=>{
 mf=new Miniflare(options());db=await mf.getD1Database('DB') as unknown as D1Database
 for(const name of ['0000_existing_scaffolding','0001_foundation','0002_multiplayer','0003_global_properties'])for(const statement of readFileSync(`server/migrations/${name}.sql`,'utf8').replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|INSERT INTO property_catalog_clock|$)/).map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run()
})
after(async()=>{await mf?.dispose();rmSync(persistence,{recursive:true,force:true})})
test('two concurrent buyers: one title, one debit, loser unchanged; portfolio and identity persist',async()=>{
 const [a,b]=await Promise.all([funded(),funded()]),p=await property(),qa=await quoteProperty(db,a.playerId,p),qb=await quoteProperty(db,b.playerId,p)
 const outcomes=await Promise.allSettled([purchaseProperty(db,a.playerId,pending(a.playerId,qa!.id)),purchaseProperty(db,b.playerId,pending(b.playerId,qb!.id))])
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
 const owner=(await propertyView(db,p.id)).ownerId!,loser=owner===a.playerId?b:a
 assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(loser.playerId).first<any>()).balance,1000000000)
 assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(owner).first<any>()).balance,1000000000-p.priceMinor)
 assert.equal((await portfolio(db,owner,'')).items[0].id,p.id)
 await db.prepare('DELETE FROM sessions WHERE player_id=?').bind(owner).run();assert.equal((await propertyView(db,p.id)).ownerId,owner)
 assert.equal((await db.prepare("SELECT count(*) AS n FROM wallet_ledger WHERE reason='property purchase' AND player_id IN (?,?)").bind(a.playerId,b.playerId).first<any>()).n,1)
})
test('lost-response and simultaneous same-key retries return one immutable receipt; key mismatch rejected',async()=>{
 const a=await funded(),p=await property(),q=await quoteProperty(db,a.playerId,p),body=pending(a.playerId,q!.id)
 const receipts=await Promise.all([purchaseProperty(db,a.playerId,body),purchaseProperty(db,a.playerId,body)])
 assert.deepEqual(receipts[0],receipts[1]);await db.prepare('DELETE FROM property_quotes WHERE id=?').bind(q!.id).run()
 assert.deepEqual(await purchaseProperty(db,a.playerId,body),receipts[0]);await assert.rejects(()=>purchaseProperty(db,a.playerId,{...body,quoteId:crypto.randomUUID()}),/another quote/)
 await assert.rejects(()=>db.prepare('DELETE FROM property_purchases WHERE property_id=?').bind(p.id).run(),/immutable_purchase/)
 await assert.rejects(()=>db.prepare('UPDATE global_properties SET owner_id=NULL,acquired_at=NULL WHERE id=?').bind(p.id).run(),/immutable_title/)
})
test('failure after wallet insert rolls back title, ledger and receipt; exact retry recovers',async()=>{
 const a=await funded(),p=await property(),q=await quoteProperty(db,a.playerId,p),body=pending(a.playerId,q!.id)
 await db.prepare("CREATE TRIGGER injected_property_failure BEFORE INSERT ON property_audit WHEN NEW.event='purchase' BEGIN SELECT RAISE(ABORT,'injected_failure'); END").run()
 await assert.rejects(()=>purchaseProperty(db,a.playerId,body),/injected_failure/)
 assert.equal((await propertyView(db,p.id)).ownerId,null);assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,1000000000)
 assert.equal(await db.prepare('SELECT * FROM property_purchases WHERE player_id=?').bind(a.playerId).first(),null)
 await db.prepare('DROP TRIGGER injected_property_failure').run();await purchaseProperty(db,a.playerId,body);assert.equal((await propertyView(db,p.id)).ownerId,a.playerId)
})
test('insufficient funds, forged fields, expired/stolen/stale quotes and origin/auth failures never debit',async()=>{
 const a=await create(),b=await funded(),p=await property(),q=await quoteProperty(db,a.playerId,p),body=pending(a.playerId,q!.id)
 await assert.rejects(()=>purchaseProperty(db,a.playerId,body),/Insufficient/)
 await assert.rejects(()=>purchaseProperty(db,b.playerId,{...body,playerId:b.playerId}),/Quote expired/)
 await assert.rejects(()=>purchaseProperty(db,a.playerId,{...body,priceMinor:1}),/Invalid purchase/)
 for(const [secret,originHeader,status]of [['bad',origin,401],[a.secret,'https://evil.test',403]])assert.equal((await api.fetch(request('purchase',secret,body,originHeader),env())).status,status)
 await db.prepare('UPDATE property_quotes SET expires_at=0 WHERE id=?').bind(q!.id).run();await assert.rejects(()=>purchaseProperty(db,a.playerId,body),/changed/)
 const qb=await quoteProperty(db,b.playerId,p);await db.prepare("UPDATE global_properties SET status='review',revision=revision+1 WHERE id=?").bind(p.id).run();await assert.rejects(()=>purchaseProperty(db,b.playerId,pending(b.playerId,qb!.id)),/changed/)
 assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(b.playerId).first<any>()).balance,1000000000)
})
test('purchase cooldown is atomic even when buying different properties concurrently',async()=>{
 const a=await funded(),[p,q]=await Promise.all([property(),property()]),quotes=await Promise.all([quoteProperty(db,a.playerId,p),quoteProperty(db,a.playerId,q)])
 const result=await Promise.allSettled(quotes.map(q=>purchaseProperty(db,a.playerId,pending(a.playerId,q!.id))))
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.match(String((result.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),/Purchase limit/)
})
test('canonical OSM identity ignores tile/city origin, ring start/winding, and unchanged source versions',async()=>{
 const e=element(undefined,40),data=source([e]),p=await resolveProperty(data,{lat:40.00005,lon:-79.99995}),other=await resolveProperty(data,{lat:40.00015,lon:-79.99985})
 assert.equal(p.id,other.id)
 const reversed=element(e.id,40,-80,{geometry:[...e.geometry].reverse(),version:2}),b=parseBuildings({elements:[reversed]})[0]
 const refreshed=await registerBuilding(db,b,valueBuilding(b,[b]),Date.now());assert.equal(refreshed.id,p.id);assert.equal(refreshed.status,'active');assert.equal(refreshed.priceMinor,p.priceMinor)
})
test('relation members map to one building; holes are excluded and valuation is deterministic',()=>{
 const outer=ring(10,10,.002),inner=ring(10.0005,10.0005,.0005),way=element(101,10,10)
 const relation={type:'relation',id:202,version:3,tags:{building:'apartments',type:'multipolygon','building:levels':'4'},members:[{type:'way',ref:101,role:'outer',geometry:outer},{type:'way',ref:102,role:'inner',geometry:inner}]}
 const parsed=parseBuildings({elements:[way,relation]});assert.equal(parsed.length,1);assert.equal(parsed[0].id,'osm:relation:202');assert.ok(parsed[0].aliases.includes('osm:way:101'))
 assert.ok(contains(parsed[0].rings,{lat:10.0001,lon:10.0001}));assert.ok(!contains(parsed[0].rings,{lat:10.0006,lon:10.0006}))
 assert.equal(valueBuilding(parsed[0],parsed),valueBuilding(parsed[0],[...parsed].reverse()));assert.ok(parsed[0].area>40000)
 assert.deepEqual(parseBuildings({elements:[element(1,0,0,{geometry:[{lat:0,lon:0}]})]}),[])
 assert.throws(()=>parseBuildings({elements:[],remark:'timeout'}),/Incomplete/)
 const dateline=parseBuildings({elements:[element(765,0,179,{geometry:[{lat:0,lon:179.9999},{lat:0,lon:-179.9999},{lat:.0002,lon:-179.9999},{lat:.0002,lon:179.9999},{lat:0,lon:179.9999}]})]})[0]
 assert.ok(dateline);assert.ok(contains(dateline.rings,{lat:.0001,lon:179.99995}));assert.ok(contains(dateline.rings,{lat:.0001,lon:-179.99995}))
})
test('source geometry changes and deleted objects freeze sales without erasing an owner',async()=>{
 const e=element(undefined,35),b=parseBuildings({elements:[e]})[0],p=await registerBuilding(db,b,valueBuilding(b,[b]),Date.now()-100),a=await funded(),q=await quoteProperty(db,a.playerId,p)
 await purchaseProperty(db,a.playerId,pending(a.playerId,q!.id))
 const changed=parseBuildings({elements:[{...e,version:2,geometry:ring(35,-80,.0003)}]})[0]
 const review=await registerBuilding(db,changed,valueBuilding(changed,[changed]),Date.now());assert.equal(review.status,'review');assert.equal(review.ownerId,a.playerId)
 assert.equal((await refreshProperty(source([],Date.now()+1),p.id)).ownerId,a.playerId)
 assert.equal((await portfolio(db,a.playerId,'')).items[0].id,p.id)
})
test('concurrent overlapping registrations cannot produce two purchasable titles; splits/merges reserve aliases',async()=>{
 const one=parseBuildings({elements:[element(undefined,30)]})[0],two=parseBuildings({elements:[element(undefined,30,-79.99995)]})[0]
 assert.ok(overlap(one.rings,two.rings)>1)
 await Promise.all([registerBuilding(db,one,valueBuilding(one,[one]),Date.now()),registerBuilding(db,two,valueBuilding(two,[two]),Date.now())])
 assert.equal((await propertyView(db,one.id)).status,'review');assert.equal((await propertyView(db,two.id)).status,'review')
 const relation={...one,id:'osm:relation:99999',aliases:[one.id]};await registerBuilding(db,relation,valueBuilding(relation,[relation]),Date.now());assert.equal((await propertyView(db,relation.id)).status,'review')
 assert.equal((await db.prepare('SELECT property_id FROM property_aliases WHERE source_id=?').bind(one.id).first<any>()).property_id,one.id)
})
test('HTTP inspect uses only server OSM data; source outages and disabled backend fail safely',async()=>{
 const a=await funded(),e=element(undefined,25),response=await api.fetch(request('inspect',a.secret,{lat:25.0001,lon:-79.9999}),env([e]))
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const data:any=await response.json();assert.equal(data.property.id,`osm:way:${e.id}`);assert.equal(data.quote.playerId,a.playerId)
 assert.equal((await api.fetch(request('inspect',a.secret,{lat:25,lon:-80,priceMinor:1}),env([e]))).status,400)
 assert.equal((await api.fetch(request('inspect',a.secret,{lat:25,lon:-80}),{...env(),PROPERTIES_ENABLED:'false'})).status,503)
 const down={...env(),PROPERTY_SOURCE:{idFromName:()=>'',get:()=>({fetch:async()=>new Response('Unavailable',{status:503})})}}
 assert.equal((await api.fetch(request('inspect',a.secret,{lat:25,lon:-80}),down)).status,503)
 const p=await property(),quote=await quoteProperty(db,a.playerId,p);await purchaseProperty(db,a.playerId,pending(a.playerId,quote!.id))
 assert.equal((await(await api.fetch(request('portfolio',a.secret),down)).json() as any).items[0].ownerId,a.playerId)
})

test('rolling daily quota rejects the sixth purchase without a debit',async()=>{
 const original=Date.now,start=original(),a=await funded();let now=start;Date.now=()=>now
 try{
  for(let i=0;i<5;i++){now=start+i*60001;const p=await property(),q=await quoteProperty(db,a.playerId,p);await purchaseProperty(db,a.playerId,pending(a.playerId,q!.id))}
  now=start+5*60001;const p=await property(),q=await quoteProperty(db,a.playerId,p),before=(await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance
  await assert.rejects(()=>purchaseProperty(db,a.playerId,pending(a.playerId,q!.id)),/Purchase limit/)
  assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,before)
 }finally{Date.now=original}
})
test('source adapter uses a fixed server endpoint, bounded chunk cache and fails closed on partial/oversized data',async()=>{
 const memory=new Map<string,any>(),ctx={blockConcurrencyWhile:(fn:any)=>fn(),storage:{get:async(key:any)=>Array.isArray(key)?new Map(key.map(k=>[k,memory.get(k)])):memory.get(key),put:async(entries:any)=>{for(const [k,v]of Object.entries(entries)){assert.ok(new TextEncoder().encode(JSON.stringify(v)).length<128000);memory.set(k,v)}},setAlarm:async()=>{}}}
 let fetches=0
 const source=new PropertySource(ctx as any,{DB:db,PROPERTY_SOURCE_URL:'https://osm.test/interpreter',PROPERTY_SOURCE_TOKEN:'server-only-token',APP_CONTACT:'mailto:test@example.test'},(async(url:any,options:any)=>{
  fetches++;assert.equal(url,'https://osm.test/interpreter');assert.equal(options.headers.Authorization,'Bearer server-only-token');assert.ok(options.body.toString().includes('out+meta+geom'))
  return Response.json({elements:[{...element(3333,43),note:'🛸'.repeat(40000)}]})
 }) as typeof fetch)
 const request=new Request('https://source/?cell=26600:20000'),a=await source.fetch(request),b=await source.fetch(request)
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(fetches,1);assert.ok(memory.size>2);assert.ok(!(await a.text()).includes('server-only-token'))
 for(const response of [Response.json({remark:'timeout',elements:[]}),new Response('x'.repeat(2097153))]){
  memory.clear();const failing=new PropertySource(ctx as any,{DB:db,PROPERTY_SOURCE_URL:'https://osm.test/interpreter',APP_CONTACT:'mailto:test@example.test'},async()=>response)
  assert.equal((await failing.fetch(request)).status,503);assert.equal(memory.size,0)
 }
})
test('title, portfolio, ledger and retry receipt survive a complete service restart',async()=>{
 const a=await funded(),p=await property(),q=await quoteProperty(db,a.playerId,p),body=pending(a.playerId,q!.id),receipt=await purchaseProperty(db,a.playerId,body)
 await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB') as unknown as D1Database
 assert.equal((await propertyView(db,p.id)).ownerId,a.playerId);assert.equal((await portfolio(db,a.playerId,'')).items[0].id,p.id);assert.deepEqual(await purchaseProperty(db,a.playerId,body),receipt)
})
