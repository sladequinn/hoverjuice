import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {googleAuth,verifyGoogleToken} from '../server/google-auth'
import {issueSession} from '../server/auth'
import {hash,sessionCookie,stateCookie} from '../server/security'
import api from '../server/api'
let mf:Miniflare,db:D1Database,pair:CryptoKeyPair,jwk:JsonWebKey
const origin='https://game.test'
const env=()=>({DB:db,APP_ORIGIN:origin,BACKEND_ENABLED:'true',GOOGLE_CLIENT_ID:'google-client',GOOGLE_CLIENT_SECRET:'secret'} as any)
const base64=(v:Uint8Array|string)=>Buffer.from(v).toString('base64url')
async function signed(nonce:string,overrides:Record<string,unknown>={}){
 const head=base64(JSON.stringify({alg:'RS256',kid:'test-key'})),body=base64(JSON.stringify({iss:'https://accounts.google.com',aud:'google-client',sub:'google-subject',nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...overrides})),data=head+'.'+body
 return data+'.'+base64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data))))
}
const certs=()=>Response.json({keys:[{...jwk,kid:'test-key',alg:'RS256',use:'sig'}]})
async function begin(secret?:string){
 const response=await googleAuth(new Request(origin+(secret?'/api/auth/google/link':'/api/auth/google/login'),{method:secret?'POST':'GET',headers:secret?{Cookie:`${sessionCookie}=${secret}`}:{}}),env())
 const url=new URL(secret?(await response.json() as any).url:response.headers.get('Location')!)
 const state=url.searchParams.get('state')!,nonce=url.searchParams.get('nonce')!
 return {url,state,nonce,request:new Request(`${origin}/api/auth/google/callback?state=${state}&code=test-code`,{headers:{Cookie:`${stateCookie}=${state}${secret?`; ${sessionCookie}=${secret}`:''}`}})}
}
const provider=(nonce:string,subject='google-subject')=>(async(url:any,options:any)=>{
 if(String(url).endsWith('/token')){const params=new URLSearchParams(options.body);assert.ok(params.get('code_verifier'));assert.equal(params.get('redirect_uri'),origin+'/api/auth/google/callback');return Response.json({id_token:await signed(nonce,{sub:subject})})}
 assert.equal(String(url),'https://www.googleapis.com/oauth2/v3/certs');return certs()
}) as typeof fetch
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-01',d1Databases:['DB']}]}))
 db=await mf.getD1Database('DB') as unknown as D1Database
 for(const name of ['0001_foundation','0002_multiplayer','0006_google_auth']){
  const sql=readFileSync(new URL(`../server/migrations/${name}.sql`,import.meta.url),'utf8').replace(/^--.*$/gm,'')
  for(const statement of sql.split(/;\s*(?=CREATE|ALTER|$)/).map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run()
 }
 pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify'])
 jwk=await crypto.subtle.exportKey('jwk',pair.publicKey)
})
after(async()=>{await mf?.dispose()})
test('Google code flow uses PKCE, nonce, secure cookies and replay protection',async()=>{
 const start=await begin();assert.equal(start.url.origin,'https://accounts.google.com');assert.equal(start.url.searchParams.get('code_challenge_method'),'S256');assert.equal(start.url.searchParams.get('scope'),'openid')
 await assert.rejects(()=>googleAuth(new Request(start.request.url),env(),provider(start.nonce)),/Invalid sign-in/)
 const response=await googleAuth(start.request,env(),provider(start.nonce));assert.equal(response.status,302)
 assert.match(response.headers.get('Set-Cookie')!,/HttpOnly; Secure; SameSite=Lax/)
 await assert.rejects(()=>googleAuth(start.request,env(),provider(start.nonce)),/already used/)
 const identity=await db.prepare("SELECT player_id FROM identities WHERE provider='google' AND subject='google-subject'").first<any>();assert.ok(identity.player_id)
 assert.equal((await issueSession(db,'google-subject','google')).playerId,identity.player_id)
 assert.notEqual((await issueSession(db,'google-subject','github')).playerId,identity.player_id)
})
test('Google rejects wrong audience, issuer, nonce, expiry and tampered signatures',async()=>{
 const transport=(async()=>certs()) as typeof fetch
 for(const overrides of [{aud:'other-client'},{iss:'https://evil.test'},{nonce:'wrong'},{exp:0},{iat:Math.floor(Date.now()/1000)+999},{azp:'other-client'},{sub:''}])await assert.rejects(()=>signed('nonce',overrides).then(jwt=>verifyGoogleToken(jwt,'google-client','nonce',transport)))
 const valid=await signed('nonce');assert.equal(await verifyGoogleToken(valid,'google-client','nonce',transport),'google-subject')
 const parts=valid.split('.');parts[1]=base64(JSON.stringify({iss:'https://accounts.google.com',aud:'google-client',sub:'attacker',nonce:'nonce',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300}))
 await assert.rejects(()=>verifyGoogleToken(parts.join('.'),'google-client','nonce',transport),/signature/)
})
test('explicit linking keeps player identity and rejects another-account or changed-session links',async()=>{
 const old=await issueSession(db,'existing-github-user')
 const start=await begin(old.secret)
 await googleAuth(start.request,env(),provider(start.nonce,'linked-google'))
 assert.equal((await issueSession(db,'linked-google','google')).playerId,old.playerId)
 const other=await issueSession(db,'other-github-user'),conflict=await begin(other.secret)
 await assert.rejects(()=>googleAuth(conflict.request,env(),provider(conflict.nonce,'linked-google')),/already belongs/)
 const changed=await begin(old.secret)
 await assert.rejects(()=>googleAuth(new Request(changed.request.url,{headers:{Cookie:`${stateCookie}=${changed.state}; ${sessionCookie}=${other.secret}`}}),env(),provider(changed.nonce)),/Account changed/)
 const revoked=await begin(old.secret)
 await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(old.secret)).run()
 await assert.rejects(()=>googleAuth(revoked.request,env(),provider(revoked.nonce)),/Session expired/)
})
test('link endpoint requires POST, same-origin and authentication; missing configuration fails closed',async()=>{
 const request=(method:string,originHeader=origin)=>new Request(origin+'/api/auth/google/link',{method,headers:{Origin:originHeader}})
 assert.equal((await api.fetch(request('GET'),env())).status,405)
 assert.equal((await api.fetch(request('POST','https://evil.test'),env())).status,403)
 assert.equal((await api.fetch(request('POST'),env())).status,401)
 assert.equal((await api.fetch(new Request(origin+'/api/auth/login'),{...env(),GOOGLE_CLIENT_SECRET:''})).status,503)
 const cancelled=await begin();const response=await googleAuth(new Request(`${origin}/api/auth/google/callback?state=${cancelled.state}&error=access_denied`,{headers:{Cookie:`${stateCookie}=${cancelled.state}`}}),env())
 assert.equal(response.headers.get('Location'),origin+'/?auth=cancelled')
})
