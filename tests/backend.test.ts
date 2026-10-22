import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import api from '../server/api'
import {authRoute,issueSession} from '../server/auth'
import {hash,cookie,sessionCookie,stateCookie} from '../server/security'
import {transactWallet} from '../server/wallet'
import {cleanup} from '../server/foundation'
import {readSave,writeSave} from '../server/saves'

export const sample={current:'board',mask:'balaclava',paint:'factory',allegiance:'SHINOBI',city:{name:'Kitchener',lat:43.45,lon:-80.49},safehouse:null,cam:'chase'}
let mf:Miniflare,db:D1Database
const origin='https://game.test'
const env=()=>({DB:db,APP_ORIGIN:origin,ALLOWED_ORIGIN:origin,BACKEND_ENABLED:'true',GITHUB_CLIENT_ID:'test-id',GITHUB_CLIENT_SECRET:'test-secret'} as any)
const req=(path:string,secret?:string,method='GET',body?:unknown,requestOrigin=origin)=>new Request(origin+path,{method,headers:{Cookie:secret?`${sessionCookie}=${secret}`:'',Origin:requestOrigin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
const create=()=>issueSession(db,crypto.randomUUID())
const saveInput=(playerId:string,revision=0,payload:any=sample)=>({playerId,schemaVersion:1,expectedRevision:revision,requestId:crypto.randomUUID(),payload})
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-01',d1Databases:['DB']}]}))
 db=await mf.getD1Database('DB') as unknown as D1Database
 for(const name of ['0000_existing_scaffolding','0001_foundation','0002_multiplayer','0003_global_properties','0006_google_auth','0007_preferences']){
  const sql=readFileSync(new URL(`../server/migrations/${name}.sql`,import.meta.url),'utf8').replace(/^--.*$/gm,'')
  for(const statement of sql.split(/;\s*(?=CREATE|INSERT INTO property_catalog_clock|$)/).map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run()
 }
})
after(async()=>{await mf?.dispose()})

test('authentication rejects missing, forged and expired sessions; tokens are hashed',async()=>{
 const account=await create()
 assert.equal((await api.fetch(req('/api/me'),env())).status,401)
 assert.equal((await api.fetch(req('/api/me','a'.repeat(64)),env())).status,401)
 const row=await db.prepare('SELECT token_hash FROM sessions WHERE player_id=?').bind(account.playerId).first<any>()
 assert.notEqual(row.token_hash,account.secret);assert.equal(row.token_hash,await hash(account.secret))
 assert.equal((await (await api.fetch(req('/api/me',account.secret),env())).json() as any).playerId,account.playerId)
 await db.prepare('UPDATE sessions SET expires_at=0 WHERE player_id=?').bind(account.playerId).run()
 assert.equal((await api.fetch(req('/api/me',account.secret),env())).status,401)
})
test('repeat/concurrent provider login returns one stable player and preserves progress',async()=>{
 const subject=crypto.randomUUID(),accounts=await Promise.all([issueSession(db,subject),issueSession(db,subject)])
 assert.equal(accounts[0].playerId,accounts[1].playerId)
 await transactWallet(db,accounts[0].playerId,'fixture-credit',700,'trusted test fixture')
 const again=await issueSession(db,subject)
 assert.equal(again.playerId,accounts[0].playerId)
 assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(again.playerId).first<any>()).balance,700)
 assert.equal((await db.prepare('SELECT count(*) AS n FROM identities WHERE subject=?').bind(subject).first<any>()).n,1)
})
test('OAuth uses state, PKCE, verified provider subject, single-use callback and secure cookies',async()=>{
 const start=await authRoute(req('/api/auth/github/login'),env())
 const target=new URL(start.headers.get('Location')!),state=target.searchParams.get('state')!
 assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.ok(target.searchParams.get('code_challenge'))
 assert.match(start.headers.get('Set-Cookie')!,/HttpOnly; Secure; SameSite=Lax/)
 let exchanges=0
 const provider=(async(url:any,options:any)=>{
  if(String(url).endsWith('access_token')){exchanges++;assert.ok(JSON.parse(options.body).code_verifier);return Response.json({access_token:'provider-token'})}
  assert.equal(options.headers.Authorization,'Bearer provider-token');return Response.json({id:123456})
 }) as typeof fetch
 const callback=new Request(`${origin}/api/auth/callback?state=${state}&code=code`,{headers:{Cookie:`${stateCookie}=${state}`}})
 await assert.rejects(()=>authRoute(new Request(callback.url),env(),provider),/Invalid sign-in/)
 const response=await authRoute(callback,env(),provider)
 assert.equal(response.status,302);assert.match(response.headers.get('Set-Cookie')!,/__Host-hg_session=/)
 assert.ok(!response.headers.get('Set-Cookie')!.includes('provider-token'))
 await assert.rejects(()=>authRoute(callback,env(),provider),/already used/);assert.equal(exchanges,1)
})
test('provider outage consumes attempt safely and allows starting fresh without an account',async()=>{
 const start=await authRoute(req('/api/auth/github/login'),env()),state=new URL(start.headers.get('Location')!).searchParams.get('state')!
 const callback=new Request(`${origin}/api/auth/callback?state=${state}&code=code`,{headers:{Cookie:`${stateCookie}=${state}`}})
 await assert.rejects(()=>authRoute(callback,env(),(async()=>new Response('',{status:503})) as typeof fetch),/unavailable/)
 await assert.rejects(()=>authRoute(callback,env()),/already used/)
 assert.equal((await authRoute(req('/api/auth/github/login'),env())).status,302)
})
test('CSRF, wrong host, disabled backend and logout-all fail closed',async()=>{
 const subject=crypto.randomUUID(),a=await issueSession(db,subject),b=await issueSession(db,subject)
 assert.equal((await api.fetch(req('/api/auth/logout',a.secret,'POST',undefined,'https://evil.test'),env())).status,403)
 assert.equal((await api.fetch(req('/api/auth/logout',a.secret,'POST',undefined,''),env())).status,403)
 assert.equal((await api.fetch(req('/api/me',a.secret),{...env(),APP_ORIGIN:'https://other.test'})).status,503)
 assert.equal((await api.fetch(req('/api/me',a.secret),{...env(),BACKEND_ENABLED:'false'})).status,503)
 const res=await api.fetch(req('/api/auth/logout-all',a.secret,'POST'),env());assert.equal(res.status,200)
 assert.match(res.headers.get('Set-Cookie')!,/Max-Age=0/)
 for(const session of [a,b])assert.equal((await api.fetch(req('/api/me',session.secret),env())).status,401)
})
test('save persistence survives new session, isolates players and does not change wallet funds',async()=>{
 const subject=crypto.randomUUID(),a=await issueSession(db,subject),b=await create(),input=saveInput(a.playerId,0,{...sample,paint:'petrol'})
 assert.equal((await api.fetch(req('/api/preferences',a.secret,'PUT',input),env())).status,200)
 const again=await issueSession(db,subject)
 const saved=await (await api.fetch(req('/api/preferences',again.secret),env())).json() as any
 assert.equal(saved.payload.paint,'petrol');assert.equal(saved.revision,1)
 assert.equal((await readSave(db,b.playerId)).payload,null)
 assert.equal((await api.fetch(req('/api/preferences',b.secret,'PUT',input),env())).status,400)
 const wallet=await (await api.fetch(req('/api/wallet',a.secret),env())).json() as any
 assert.equal(wallet.balance,0)
 for(const path of ['/api/wallet','/api/wallet/reward','/api/ownership'])assert.ok((await api.fetch(req(path,a.secret,'POST',{balance:999,delta:999,reward:999}),env())).status>=400)
})
test('save optimistic concurrency, exact retries, key mismatch and lost-response recovery',async()=>{
 const a=await create(),one=saveInput(a.playerId),two=saveInput(a.playerId,0,{...sample,paint:'bone'})
 const responses=await Promise.all([api.fetch(req('/api/preferences',a.secret,'PUT',one),env()),api.fetch(req('/api/preferences',a.secret,'PUT',two),env())])
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409])
 const winner=responses[0].status===200?one:two
 // Discard successful response and retry, including after another save.
 assert.equal((await writeSave(db,a.playerId,winner)).revision,1)
 await writeSave(db,a.playerId,saveInput(a.playerId,1,{...sample,paint:'olive'}))
 assert.equal((await writeSave(db,a.playerId,winner)).revision,1)
 assert.equal((await readSave(db,a.playerId)).revision,2)
 await assert.rejects(()=>writeSave(db,a.playerId,{...winner,payload:{...sample,paint:'amber'}}),/different data/)
})
test('failed save batch rolls back receipt and payload, then exact request recovers',async()=>{
 const a=await create(),input=saveInput(a.playerId)
 await db.prepare(`CREATE TRIGGER fail_save BEFORE UPDATE ON driver_preferences BEGIN SELECT RAISE(ABORT,'injected failure'); END`).run()
 try{
  assert.equal((await api.fetch(req('/api/preferences',a.secret,'PUT',input),env())).status,503)
  assert.equal((await readSave(db,a.playerId)).revision,0)
  assert.equal((await db.prepare('SELECT count(*) AS n FROM preference_receipts WHERE player_id=?').bind(a.playerId).first<any>()).n,0)
 }finally{await db.prepare('DROP TRIGGER fail_save').run()}
 assert.equal((await writeSave(db,a.playerId,input)).revision,1)
})
test('save validation rejects malformed, excessive, unsafe, foreign and future schemas',async()=>{
 const a=await create(),valid=saveInput(a.playerId)
 for(const body of [{...valid,schemaVersion:2},{...valid,payload:{...sample,owned:null}},{...valid,payload:{...sample,current:'" onclick="bad'}},{...valid,payload:{...sample,city:{name:'X',lat:999,lon:1}}},{...valid,balance:1}])assert.equal((await api.fetch(req('/api/preferences',a.secret,'PUT',body),env())).status,400)
 const malformed=new Request(origin+'/api/preferences',{method:'PUT',headers:{Cookie:`${sessionCookie}=${a.secret}`,Origin:origin,'Content-Type':'application/json'},body:'{'})
 assert.equal((await api.fetch(malformed,env())).status,400)
 const oversized=new Request(origin+'/api/preferences',{method:'PUT',headers:{Cookie:`${sessionCookie}=${a.secret}`,Origin:origin,'Content-Type':'application/json'},body:' '.repeat(131073)})
 assert.equal((await api.fetch(oversized,env())).status,413)
 const wrongType=req('/api/preferences',a.secret,'PUT',valid);wrongType.headers.set('Content-Type','text/plain')
 assert.equal((await api.fetch(wrongType,env())).status,415)
 assert.equal((await readSave(db,a.playerId)).revision,0)
})
test('wallet credits/debits are atomic, idempotent, immutable and bounded',async()=>{
 const a=await create()
 const first=await transactWallet(db,a.playerId,'credit',100,'trusted fixture')
 assert.deepEqual(first,{balance:100,version:1})
 const duplicates=await Promise.all(Array.from({length:6},()=>transactWallet(db,a.playerId,'credit',100,'trusted fixture')))
 assert.ok(duplicates.every(r=>r.balance===100&&r.version===1))
 await assert.rejects(()=>transactWallet(db,a.playerId,'credit',200,'trusted fixture'),/reused/)
 const debits=await Promise.allSettled(['debit-a','debit-b'].map(id=>transactWallet(db,a.playerId,id,-80,'trusted purchase')))
 assert.equal(debits.filter(r=>r.status==='fulfilled').length,1)
 assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,20)
 assert.equal((await db.prepare('SELECT count(*) AS n FROM wallet_ledger WHERE player_id=?').bind(a.playerId).first<any>()).n,2)
 await assert.rejects(()=>db.prepare('UPDATE wallet_ledger SET delta=3 WHERE player_id=?').bind(a.playerId).run(),/immutable/)
 await assert.rejects(()=>db.prepare('DELETE FROM wallet_ledger WHERE player_id=?').bind(a.playerId).run(),/immutable/)
 for(const n of [0,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])await assert.rejects(()=>transactWallet(db,a.playerId,'bad',n,'fixture'))
 await assert.rejects(()=>transactWallet(db,a.playerId,'overflow',9e12,'fixture'))
 assert.equal((await db.prepare('SELECT SUM(delta) AS n FROM wallet_ledger WHERE player_id=?').bind(a.playerId).first<any>()).n,20)
})
test('wallet failure between ledger insert and balance update rolls back, then retry works',async()=>{
 const a=await create()
 await db.prepare(`CREATE TRIGGER fail_wallet BEFORE UPDATE ON wallets BEGIN SELECT RAISE(ABORT,'injected failure'); END`).run()
 try{
  await assert.rejects(()=>transactWallet(db,a.playerId,'recover',150,'trusted fixture'))
  assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,0)
  assert.equal((await db.prepare('SELECT count(*) AS n FROM wallet_ledger WHERE player_id=?').bind(a.playerId).first<any>()).n,0)
 }finally{await db.prepare('DROP TRIGGER fail_wallet').run()}
 assert.deepEqual(await transactWallet(db,a.playerId,'recover',150,'trusted fixture'),{balance:150,version:1})
})
test('cleanup removes expired credentials and rate buckets; responses prevent caching',async()=>{
 const a=await create()
 await db.prepare('INSERT INTO oauth_attempts VALUES(?,?,0)').bind('expired','verifier').run()
 await db.prepare('INSERT INTO request_limits VALUES(?,1,0)').bind('expired').run()
 await cleanup(db)
 assert.equal(await db.prepare("SELECT * FROM oauth_attempts WHERE state_hash='expired'").first(),null)
 assert.equal(await db.prepare("SELECT * FROM request_limits WHERE bucket='expired'").first(),null)
 const response=await api.fetch(req('/api/me',a.secret),env())
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),null)
 assert.equal(cookie(req('/api/me',a.secret),sessionCookie),a.secret)
})
test('rate limits return 429 without changing the save and include retry guidance',async()=>{
 const a=await create(),bucket=`player:${a.playerId}:${Math.floor(Date.now()/60000)}`
 await db.prepare('INSERT INTO request_limits VALUES(?,120,?)').bind(bucket,Date.now()+120000).run()
 const response=await api.fetch(req('/api/preferences',a.secret,'PUT',saveInput(a.playerId)),env())
 assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60')
 assert.equal((await readSave(db,a.playerId)).revision,0)
})

test('retired campaign endpoint rejects old clients and preferences cannot import economic state',async()=>{
 const a=await create()
 await db.prepare("INSERT OR REPLACE INTO legacy_saves(player_id,payload,updated_at) VALUES(?,?,?)").bind(a.playerId,JSON.stringify({money:999999999,owned:['hoverghini'],holdings:[{id:'osm:way:123'}]}),Date.now()).run()
 assert.equal((await readSave(db,a.playerId)).payload,null)
 for(const method of ['GET','PUT'])assert.equal((await api.fetch(req('/api/save',a.secret,method,method==='PUT'?saveInput(a.playerId):undefined),env())).status,410)
 for(const [key,value] of Object.entries({money:999999999,balance:999999999,owned:['hoverghini'],holdings:[{id:'osm:way:123'}],homes:[],builds:{board:{drive:3}},contraband:{cyanade:100},vaultCash:10000,earned:1000,deliveries:100,won:true})){
  assert.equal((await api.fetch(req('/api/preferences',a.secret,'PUT',saveInput(a.playerId,0,{...sample,[key]:value})),env())).status,400,key)
 }
 assert.equal((await readSave(db,a.playerId)).revision,0)
 assert.equal((await db.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(a.playerId).first<any>()).balance,0)
 assert.equal((await db.prepare('SELECT count(*) AS n FROM wallet_ledger WHERE player_id=?').bind(a.playerId).first<any>()).n,0)
 assert.ok((await db.prepare('SELECT payload FROM legacy_saves WHERE player_id=?').bind(a.playerId).first<any>()).payload.includes('999999999'))
})
