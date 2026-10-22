import {authenticate,issueSession,type AuthEnv} from './auth'
import {challenge,cookie,hash,HttpError,sessionCookie,setCookie,stateCookie,token} from './security'

const issuer='https://accounts.google.com'
const lifetime=30*24*60*60
function decode(value:string){
 try{return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))}
 catch{throw new HttpError(401,'Invalid Google identity')}
}
/** Verify Google's signature and every claim tying the token to this sign-in attempt. */
export async function verifyGoogleToken(jwt:string,clientId:string,nonce:string,upstream:typeof fetch=fetch){
 if(typeof jwt!=='string'||jwt.length>16000)throw new HttpError(401,'Invalid Google identity')
 const parts=jwt.split('.');if(parts.length!==3)throw new HttpError(401,'Invalid Google identity')
 let header:any,claims:any
 try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));claims=JSON.parse(new TextDecoder().decode(decode(parts[1])))}catch{throw new HttpError(401,'Invalid Google identity')}
 const now=Math.floor(Date.now()/1000)
 if(header.alg!=='RS256'||typeof header.kid!=='string'||![issuer,'accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||(claims.azp!==undefined&&claims.azp!==clientId)||claims.nonce!==nonce||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+60||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255)throw new HttpError(401,'Google identity verification failed')
 const response=await upstream('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw new HttpError(502,'Google verification unavailable; try again')
 const keys=await response.json() as {keys?:Array<JsonWebKey&{kid:string}>}
 const jwk=keys.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig')
 if(!jwk)throw new HttpError(401,'Unknown Google signing key')
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'])
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw new HttpError(401,'Invalid Google signature')
 return claims.sub as string
}

export async function googleAuth(request:Request,env:AuthEnv,upstream:typeof fetch=fetch){
 if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)throw new HttpError(503,'Google sign-in is not configured yet')
 const url=new URL(request.url),callback=env.APP_ORIGIN+'/api/auth/google/callback'
 if(url.pathname!=='/api/auth/google/callback'){
  const linking=url.pathname.endsWith('/link'),player=linking?await authenticate(request,env.DB):null
  const state=token(),verifier=token(),nonce=token()
  await env.DB.prepare('INSERT INTO google_oauth_attempts VALUES(?,?,?,?,?,?)').bind(await hash(state),verifier,nonce,player,linking?await hash(cookie(request,sessionCookie)):null,Date.now()+600000).run()
  const target=new URL(issuer+'/o/oauth2/v2/auth')
  target.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callback,response_type:'code',scope:'openid',state,nonce,code_challenge:await challenge(verifier),code_challenge_method:'S256',prompt:'select_account'}).toString()
  const headers={'Set-Cookie':setCookie(stateCookie,state,600),'Cache-Control':'no-store'}
  return linking?Response.json({url:target.href},{headers}):new Response(null,{status:302,headers:{...headers,Location:target.href}})
 }
 const state=url.searchParams.get('state')??'',code=url.searchParams.get('code')??''
 if(!/^[a-f0-9]{64}$/.test(state)||state!==cookie(request,stateCookie))throw new HttpError(400,'Invalid sign-in callback; start again')
 const attempt=await env.DB.prepare('DELETE FROM google_oauth_attempts WHERE state_hash=? AND expires_at>? RETURNING *').bind(await hash(state),Date.now()).first<{verifier:string;nonce:string;link_player:string|null;link_session_hash:string|null}>()
 if(!attempt)throw new HttpError(400,'Sign-in expired or already used; start again')
 if(url.searchParams.has('error'))return new Response(null,{status:302,headers:{Location:env.APP_ORIGIN+'/?auth=cancelled','Set-Cookie':setCookie(stateCookie,'',0)}})
 if(!code||code.length>4096)throw new HttpError(400,'Missing sign-in code; start again')
 if(attempt.link_player&&(await authenticate(request,env.DB)!==attempt.link_player||await hash(cookie(request,sessionCookie))!==attempt.link_session_hash))throw new HttpError(401,'Account changed during linking; start again')
 const response=await upstream('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,redirect_uri:callback,grant_type:'authorization_code',code_verifier:attempt.verifier}),signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw new HttpError(502,'Google sign-in failed; start again')
 const credentials=await response.json() as {id_token?:string}
 if(!credentials.id_token)throw new HttpError(401,'Google did not confirm your identity')
 const subject=await verifyGoogleToken(credentials.id_token,env.GOOGLE_CLIENT_ID,attempt.nonce,upstream)
 if(attempt.link_player){
  await env.DB.prepare("INSERT INTO identities(provider,subject,player_id) VALUES('google',?,?) ON CONFLICT(provider,subject) DO NOTHING").bind(subject,attempt.link_player).run()
  const identity=await env.DB.prepare("SELECT player_id FROM identities WHERE provider='google' AND subject=?").bind(subject).first<{player_id:string}>()
  if(identity?.player_id!==attempt.link_player)throw new HttpError(409,'This Google account already belongs to another player. Accounts were not merged.')
 }
 const session=await issueSession(env.DB,subject,'google')
 const headers=new Headers({Location:env.APP_ORIGIN+'/?cloud=connected'})
 headers.append('Set-Cookie',setCookie(sessionCookie,session.secret,lifetime));headers.append('Set-Cookie',setCookie(stateCookie,'',0))
 return new Response(null,{status:302,headers})
}
