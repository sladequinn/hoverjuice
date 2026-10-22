import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {transactWallet} from '../server/wallet'
import {exchange} from '../shared/street'
import {issueSession} from '../server/auth'
import {sessionCookie} from '../server/security'
import {districtBounds,districtFor} from '../shared/crews'
import {neighbours} from '../shared/economy'
let mf:Miniflare,db:D1Database
const origin='https://game.test',district=districtFor({lat:43.45,lon:-80.49}),bounds=districtBounds(district),destination=neighbours(district)[0],start={lat:bounds.north-.0016,lon:bounds.lon},end={lat:bounds.north+.0016,lon:bounds.lon},sockets:any[]=[]
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms))
before(async()=>{
 mkdirSync('.test-artifacts/economy-worker',{recursive:true});writeFileSync('.test-artifacts/economy-worker/wrangler.toml',readFileSync('wrangler.example.toml','utf8').replace('main = "server/api.ts"',`main = ${JSON.stringify(resolve('server/api.ts'))}`).replace(/\[assets\][\s\S]*?(?=\[triggers\])/,'').replace('name = "hoverjuice-api"','name = "economy-test"'))
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--config','.test-artifacts/economy-worker/wrangler.toml','--outdir',resolve('.test-artifacts/economy-worker/worker')],{stdio:'pipe',env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'economy',modules:true,scriptPath:resolve('.test-artifacts/economy-worker/worker/api.js'),compatibilityDate:'2026-10-01',d1Databases:['DB'],bindings:{APP_ORIGIN:origin,BACKEND_ENABLED:'true',MULTIPLAYER_ENABLED:'true',PROPERTIES_ENABLED:'true',CREWS_ENABLED:'true',ECONOMY_ENABLED:'true',PROPERTY_SOURCE_URL:'https://source.test',APP_CONTACT:'test@example.test'},durableObjects:Object.fromEntries(['PlayerSession','GeoCell','CruiseRace','PropertySource','Territory','Freight','Geocoder'].map((className,i)=>[['PLAYERS','CELLS','RACES','PROPERTY_SOURCE','TERRITORIES','FREIGHT','GEOCODER'][i],{className,useSQLite:true}])),outboundService:async()=>Response.json({elements:[{type:'way',id:1,nodes:[1,2,3],tags:{highway:'residential'},geometry:[start,{lat:bounds.north,lon:bounds.lon},end]}]})}]}))
 db=await mf.getD1Database('DB') as any;for(const name of ['0000_existing_scaffolding','0001_foundation','0002_multiplayer','0003_global_properties','0004_crews_territories','0005_underground_economy','0008_street_progression'])for(const q of readFileSync(`server/migrations/${name}.sql`,'utf8').replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|INSERT INTO (?:property_catalog_clock|freight_fund|street_fund)|$)/).map(s=>s.trim()).filter(Boolean))await db.prepare(q).run()
})
after(async()=>{for(const ws of sockets)try{ws.close()}catch{}await mf?.dispose()})
async function connect(a:any,point=start){const res=await mf.dispatchFetch(`${origin}/api/multiplayer/socket?lat=${point.lat}&lon=${point.lon}`,{headers:{Origin:origin,Upgrade:'websocket',Cookie:`${sessionCookie}=${a.secret}`}});assert.equal(res.status,101);const ws=res.webSocket!,messages:any[]=[];ws.addEventListener('message',(e:any)=>messages.push(JSON.parse(e.data)));ws.accept();sockets.push(ws);await delay(80);return {ws,messages}}
const move=(seq:number)=>({type:'move',v:1,seq,...start,y:100,clearance:1,yaw:0,vx:0,vz:0,chassis:'hoverghini',mask:'oni',paint:'violet',boost:false})
test('actual Worker reserves a contract, accepts only input authority, reconnects and settles one observed delivery',async()=>{
 const a=await issueSession(db,crypto.randomUUID()),b=await issueSession(db,crypto.randomUUID());let connection=await connect(a)
 const api=async(path:string,body?:any,who=a)=>{const r=await mf.dispatchFetch(origin+'/api/economy/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:`${sessionCookie}=${who.secret}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json() as any}}
 connection.ws.send(JSON.stringify(move(0)));await delay(100);const quote=await api('quote',{origin:district,destination,commodity:'ghostware',competitive:false});assert.equal(quote.status,200,JSON.stringify(quote.data))
 const request={playerId:a.playerId,quoteId:quote.data.id,requestId:crypto.randomUUID()},loaded=await api('start',request);assert.equal(loaded.status,200,JSON.stringify(loaded.data));assert.equal((await api('start',request)).data.id,loaded.data.id)
 assert.equal((await api('resume',{id:loaded.data.id},b)).status,409)
 connection.ws.close();connection=await connect(a);connection.ws.send(JSON.stringify(move(0)));await delay(100);assert.equal((await api('resume',{id:loaded.data.id})).status,200)
 let inputSeq=0;for(let i=0;i<125;i++){
  const last=connection.messages.filter(m=>m.type==='freight').at(-1)?.freight;if(last?.status==='delivered')break
  connection.ws.send(JSON.stringify({type:'freight-input',input:{seq:++inputSeq,throttle:1,steer:0}}));if(i%4===0)connection.ws.send(JSON.stringify(move(i+1)))
  await delay(250)
 }
 const last=connection.messages.filter(m=>m.type==='freight').at(-1)?.freight;assert.equal(last?.status,'delivered',JSON.stringify(last));assert.equal(Object.hasOwn(last,'course'),false,'Snapshots must not resend route geometry')
 const wallet=await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>();assert.equal(wallet.balance,loaded.data.net)
 const board=await api('board?district='+encodeURIComponent(destination),undefined,b);assert.equal(board.status,200);assert.ok(board.data.markets.find((m:any)=>m.district===destination&&m.commodity==='ghostware').delivered>=4)
 assert.equal((await api('finish',{id:loaded.data.id,payout:999999})).status,404)
 assert.equal((await db.prepare("SELECT count(*) AS n FROM wallet_ledger WHERE player_id=? AND reason='freight delivery'").bind(a.playerId).first<any>()).n,1)
})

test('street HTTP uses live parked presence, rejects forged purchases, and publishes only owned equipment',async()=>{
 const a=await issueSession(db,crypto.randomUUID()),b=await issueSession(db,crypto.randomUUID()),spot=exchange(district)
 await transactWallet(db,a.playerId,'street-runtime-fixture',1000000,'test fixture')
 const request=async(path:string,body?:any,who=a,requestOrigin=origin)=>{const r=await mf.dispatchFetch(origin+'/api/economy/street/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:requestOrigin,Cookie:`${sessionCookie}=${who.secret}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json() as any}}
 const qbody={district,good:'cyanade',side:'buy',quantity:2}
 assert.equal((await request('quote',qbody)).status,409,'offline player cannot trade')
 const observer=await connect(b,spot),driver=await connect(a,spot)
 observer.ws.send(JSON.stringify({...move(0),...spot}));await delay(100)
 driver.ws.send(JSON.stringify({...move(0),...spot}));await delay(200)
 const q=await request('quote',qbody);assert.equal(q.status,200,JSON.stringify(q.data))
 const me=await request('me'),trade={playerId:a.playerId,expectedRevision:me.data.revision,requestId:crypto.randomUUID(),quoteId:q.data.id}
 assert.equal((await request('trade',{...trade,price:1})).status,400)
 assert.equal((await request('trade',trade,a,'https://evil.test')).status,403)
 const bought=await request('trade',trade);assert.equal(bought.status,200,JSON.stringify(bought.data));assert.equal(bought.data.state.cargo.cyanade,2)
 assert.equal((await request('trade',trade)).data.state.cargo.cyanade,2)
 const cmd={playerId:a.playerId,expectedRevision:bought.data.revision,requestId:crypto.randomUUID(),action:'equip-vehicle',item:'hoverghini'}
 assert.equal((await request('command',cmd)).status,403)
 let gear=await request('command',{...cmd,requestId:crypto.randomUUID(),action:'buy-vehicle',item:'neonic'});assert.equal(gear.status,200,JSON.stringify(gear.data))
 gear=await request('command',{...cmd,expectedRevision:gear.data.revision,requestId:crypto.randomUUID(),item:'neonic'});assert.equal(gear.status,200)
 driver.ws.send(JSON.stringify({...move(1),...spot}));await delay(200)
 const peer=observer.messages.filter(m=>m.type==='peer'&&m.peer.id===a.playerId).at(-1)?.peer
 assert.equal(peer?.chassis,'neonic');assert.equal(peer?.mask,'balaclava');assert.equal(peer?.paint,'factory')
 driver.ws.send(JSON.stringify({...move(2),...spot,vx:10}));await delay(100)
 assert.equal((await request('quote',qbody)).status,409,'trade requires parking')
})
