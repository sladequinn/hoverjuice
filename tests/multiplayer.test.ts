import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {issueSession} from '../server/auth'
import {sessionCookie} from '../server/security'
import {cellFor,watchingCells,validMove,distance,type Move} from '../shared/multiplayer'
import {samplePeer} from '../src/peer-motion'
let mf:Miniflare,db:D1Database
const origin='https://game.test',sockets:any[]=[]
const base:Move={type:'move',v:1,seq:0,lat:43.4599,lon:-80.49,y:300,clearance:1,yaw:0,vx:0,vz:0,chassis:'hoverghini',mask:'oni',paint:'violet',boost:false}
const delay=(ms=80)=>new Promise(r=>setTimeout(r,ms))
async function until(check:()=>boolean){for(let i=0;i<60;i++){if(check())return;await delay(50)}assert.ok(check(),'Timed out waiting for multiplayer event')}
async function connect(account:any,position=base,extra:Record<string,string>={}){
 const response=await mf.dispatchFetch(`${origin}/api/multiplayer/socket?lat=${position.lat}&lon=${position.lon}`,{headers:{Upgrade:'websocket',Origin:origin,Cookie:`${sessionCookie}=${account.secret}`,...extra}})
 assert.equal(response.status,101,await response.text())
 const ws=response.webSocket!,messages:any[]=[];let closed=0
 ws.addEventListener('message',(event:any)=>messages.push(JSON.parse(event.data)))
 ws.addEventListener('close',(event:any)=>{closed=event.code})
 ws.accept();sockets.push(ws);await until(()=>messages.some(m=>m.type==='welcome'))
 return {ws,messages,get closed(){return closed},send:(move:any)=>ws.send(JSON.stringify(move))}
}
before(async()=>{
 mkdirSync('.test-artifacts/mp',{recursive:true})
 // Wrangler is already a direct dev dependency; compile exactly the Worker shipped to Cloudflare.
 const config=readFileSync('wrangler.example.toml','utf8').replace('main = "server/api.ts"',`main = ${JSON.stringify(resolve('server/api.ts'))}`).replace(/\[assets\][\s\S]*?(?=\[triggers\])/,'')
 writeFileSync('.test-artifacts/mp/wrangler.toml',config)
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--config','.test-artifacts/mp/wrangler.toml','--outdir',resolve('.test-artifacts/mp/worker')],{stdio:'pipe',env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'mp',modules:true,scriptPath:resolve('.test-artifacts/mp/worker/api.js'),compatibilityDate:'2026-10-01',d1Databases:['DB'],bindings:{APP_ORIGIN:origin,ALLOWED_ORIGIN:origin,BACKEND_ENABLED:'true',MULTIPLAYER_ENABLED:'true'},durableObjects:{PLAYERS:{className:'PlayerSession',useSQLite:true},CELLS:{className:'GeoCell',useSQLite:true},RACES:{className:'CruiseRace',useSQLite:true},GEOCODER:{className:'Geocoder',useSQLite:true}}}]}))
 db=await mf.getD1Database('DB') as unknown as D1Database
 for(const name of ['0000_existing_scaffolding','0001_foundation','0002_multiplayer'])for(const sql of readFileSync(`server/migrations/${name}.sql`,'utf8').replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|$)/).map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()
})
after(async()=>{for(const ws of sockets)try{ws.close()}catch{}await mf?.dispose()})
const account=()=>issueSession(db,crypto.randomUUID())
test('admission requires an authenticated session and exact Origin; rejects forged identity and coordinates',async()=>{
 const a=await account()
 for(const [secret,requestOrigin,status]of [['bad',origin,401],[a.secret,'https://evil.test',403]]){
  const res=await mf.dispatchFetch(origin+'/api/multiplayer/socket?lat=43&lon=-80',{headers:{Upgrade:'websocket',Origin:String(requestOrigin),Cookie:`${sessionCookie}=${secret}`}});assert.equal(res.status,status)
 }
 const c=await connect(a,base,{'X-Player':crypto.randomUUID()});assert.equal(c.messages[0].id,a.playerId);c.ws.close()
 const res=await mf.dispatchFetch(origin+'/api/multiplayer/socket?lat=NaN&lon=0',{headers:{Upgrade:'websocket',Origin:origin,Cookie:`${sessionCookie}=${a.secret}`}});assert.equal(res.status,400)
})
test('two authenticated players exchange customized poses, cross cell boundaries, and exclude distant players',async()=>{
 const a=await account(),b=await account(),c=await account(),p=await connect(a),q=await connect(b),far=await connect(c,{...base,lat:44})
 p.send(base);q.send({...base,lon:base.lon+.0001});far.send({...base,lat:44});await delay()
 p.send({...base,seq:1});await until(()=>q.messages.some(m=>m.peer?.id===a.playerId))
 q.send({...base,seq:1,lon:base.lon+.0001});await until(()=>p.messages.some(m=>m.peer?.id===b.playerId))
 const pose=q.messages.find(m=>m.peer?.id===a.playerId).peer
 assert.equal(pose.chassis,'hoverghini');assert.equal(pose.paint,'violet');assert.equal(pose.mask,'oni');assert.ok(!far.messages.some(m=>m.type==='peer'))
 const crossing={...base,seq:2,lat:43.4601};assert.notEqual(cellFor(base),cellFor(crossing));p.send(crossing)
 await until(()=>q.messages.some(m=>m.peer?.id===a.playerId&&m.peer.seq===2))
 assert.equal(new Set(q.messages.filter(m=>m.peer?.id===a.playerId).map(m=>m.peer.id)).size,1)
 p.ws.close();q.ws.close();far.ws.close()
})
test('replacement closes the old socket, preserves identity, and reconnects with a newer epoch',async()=>{
 const a=await account(),p=await connect(a);p.send(base);await delay()
 const q=await connect(a);await until(()=>p.closed===4009);assert.equal(q.messages[0].id,a.playerId);assert.ok(q.messages[0].epoch>p.messages[0].epoch)
 q.send(base);await delay();q.ws.close();await delay()
 const r=await connect(a);r.send(base);assert.ok(r.messages[0].epoch>q.messages[0].epoch);r.ws.close()
})
test('malicious identity/economy messages, teleportation and malformed payloads cannot publish',async()=>{
 const a=await account(),p=await connect(a)
 p.send({...base,id:crypto.randomUUID(),balance:1000000});p.send('{invalid');p.send({...base,lat:50})
 await until(()=>p.closed===1008)
 assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,0)
 const q=await connect(await account());q.ws.send('x'.repeat(4097));await until(()=>q.closed===1008)
})
test('revocation blocks an established connection at its next session check; message floods close',async()=>{
 const a=await account(),p=await connect(a)
 await db.prepare('DELETE FROM sessions WHERE player_id=?').bind(a.playerId).run();p.send(base);await until(()=>p.closed===4001)
 const q=await connect(await account());for(let i=0;i<30;i++)q.send({...base,seq:i})
 await until(()=>q.closed===1008||q.closed===1013)
})
test('authenticated invites derive coordinates from validated live state and expire',async()=>{
 const a=await account(),p=await connect(a);p.send(base);await delay(150)
 const headers={Origin:origin,Cookie:`${sessionCookie}=${a.secret}`}
 const response=await mf.dispatchFetch(origin+'/api/multiplayer/invite',{method:'POST',headers,body:JSON.stringify({lat:0,lon:0})});assert.equal(response.status,200)
 const invitation:any=await response.json(),code=new URL(invitation.url).searchParams.get('join')!
 const resolved:any=await(await mf.dispatchFetch(origin+'/api/multiplayer/invite?code='+code,{headers})).json();assert.equal(resolved.lat,base.lat);assert.equal(resolved.lon,base.lon)
 await db.prepare('UPDATE multiplayer_invites SET expires_at=0 WHERE code=?').bind(code).run()
 assert.equal((await mf.dispatchFetch(origin+'/api/multiplayer/invite?code='+code,{headers})).status,404);p.ws.close()
})
test('race lobby authenticates entrants, host starts countdown, reconnect restores membership',async()=>{
 const a=await account(),b=await account(),p=await connect(a),q=await connect(b)
 p.send(base);q.send(base);await delay(150)
 const course=[{lat:base.lat,lon:base.lon},{lat:base.lat+.001,lon:base.lon}]
 p.send({type:'race-create',course});await until(()=>p.messages.some(m=>m.race))
 const id=p.messages.find(m=>m.race).race.id;q.send({type:'race-join',id});await until(()=>p.messages.some(m=>m.race?.racers.length===2))
 await delay(1050);q.send({type:'race-start'});await until(()=>q.messages.some(m=>m.message?.includes('host')))
 p.send({type:'race-start'});await until(()=>q.messages.some(m=>m.race?.status==='racing'))
 assert.ok(q.messages.find(m=>m.race?.status==='racing').race.startsAt>Date.now())
 const r=await connect(b);r.send(base);await delay(150);r.send({type:'race-join',id});await until(()=>r.messages.some(m=>m.race?.id===id))
 const starts=q.messages.find(m=>m.race?.status==='racing').race.startsAt
 await delay(Math.max(0,starts-Date.now()+60));p.send({...base,seq:1});r.send({...base,seq:1})
 await until(()=>p.messages.some(m=>m.race?.racers.every((v:any)=>v.checkpoint>=1)))
 await delay(300);p.send({...base,seq:2,lat:base.lat+.0005});r.send({...base,seq:2,lat:base.lat+.0005})
 await delay(300);p.send({...base,seq:3,lat:base.lat+.001});r.send({...base,seq:3,lat:base.lat+.001})
 await until(()=>p.messages.some(m=>m.race?.status==='finished'))
 assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,0)
 p.ws.close();r.ws.close()
})
test('geographic halo covers neighbours at boundaries, dateline and poles with bounded fanout',()=>{
 for(const lat of [-90,-89.999,-70,0,43.46,89.999,90])for(const lon of [-180,-.001,0,179.999,180]){
  const p={lat,lon},cells=watchingCells(p);assert.ok(cells.includes(cellFor(p)));assert.ok(cells.length<=12)
  for(const delta of [-.001,0,.001]){const q={lat:Math.max(-90,Math.min(90,lat+delta)),lon:lon>179? -179.999:lon};if(distance(p,q)<900)assert.ok(cells.includes(cellFor(q)),JSON.stringify({p,q,cells}))}
 }
})
test('strict movement schema and bounded interpolation prevent malicious fields and endless prediction',()=>{
 assert.ok(validMove(base));for(const patch of [{vx:NaN},{vx:221},{chassis:'unknown'},{seq:-1},{currency:1}])assert.ok(!validMove({...base,...patch}))
 const state={...base,id:crypto.randomUUID(),name:'Driver',epoch:1,at:0},history=[{state,received:1000},{state:{...state,lon:base.lon+.0001,yaw:1,seq:1,vx:10},received:1100}]
 const mid=samplePeer(history,1200)!;assert.ok(mid.lon>base.lon&&mid.lon<base.lon+.0001)
 assert.deepEqual(samplePeer(history,3000),samplePeer(history,9000))
})
