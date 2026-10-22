import {challenge,cookie,hash,HttpError,sessionCookie,setCookie,stateCookie,token} from './security'
export interface AuthEnv {DB:D1Database;APP_ORIGIN:string;GITHUB_CLIENT_ID?:string;GITHUB_CLIENT_SECRET?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string}
const lifetime=60*60*24*30
/** A provider subject, never a login name or unverified email, owns a persistent UUID. */
export async function issueSession(db:D1Database,subject:string,provider:'github'|'google'='github'){
 const playerId=crypto.randomUUID(),secret=token(),now=Date.now()
 const result=await db.batch([
  db.prepare(`INSERT INTO players(id,created_at) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM identities WHERE provider=? AND subject=?)`).bind(playerId,now,provider,subject),
  db.prepare(`INSERT INTO identities(provider,subject,player_id) VALUES(?,?,?) ON CONFLICT(provider,subject) DO NOTHING`).bind(provider,subject,playerId),
  db.prepare(`INSERT INTO wallets(player_id) SELECT player_id FROM identities WHERE provider=? AND subject=? ON CONFLICT(player_id) DO NOTHING`).bind(provider,subject),
  db.prepare(`INSERT INTO sessions(token_hash,player_id,expires_at) SELECT ?,player_id,? FROM identities WHERE provider=? AND subject=?`).bind(await hash(secret),now+lifetime*1000,provider,subject),
  db.prepare(`SELECT player_id FROM identities WHERE provider=? AND subject=?`).bind(provider,subject)
 ])
 return {secret,playerId:(result[result.length-1].results[0] as {player_id:string}).player_id}
}
export async function authenticate(request:Request,db:D1Database){
 const secret=cookie(request,sessionCookie)
 if(!/^[a-f0-9]{64}$/.test(secret))throw new HttpError(401,'Sign in required')
 const session=await db.prepare('SELECT player_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(await hash(secret),Date.now()).first<{player_id:string}>()
 if(!session)throw new HttpError(401,'Session expired; sign in again')
 return session.player_id
}
export async function authRoute(request:Request,env:AuthEnv,upstream:typeof fetch=fetch){
 if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)throw new HttpError(503,'Sign-in is not configured')
 const url=new URL(request.url),callback=`${env.APP_ORIGIN}/api/auth/callback`
 if(url.pathname==='/api/auth/github/login'){
  const state=token(),verifier=token()
  await env.DB.prepare('INSERT INTO oauth_attempts VALUES(?,?,?)').bind(await hash(state),verifier,Date.now()+600000).run()
  const target=new URL('https://github.com/login/oauth/authorize')
  target.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:callback,state,code_challenge:await challenge(verifier),code_challenge_method:'S256',scope:''}).toString()
  return new Response(null,{status:302,headers:{Location:target.href,'Set-Cookie':setCookie(stateCookie,state,600)}})
 }
 const state=url.searchParams.get('state')??'',code=url.searchParams.get('code')??''
 if(!/^[a-f0-9]{64}$/.test(state)||state!==cookie(request,stateCookie)||!code||code.length>256)throw new HttpError(400,'Invalid sign-in callback; start sign-in again')
 // DELETE RETURNING makes each attempt single-use, including concurrent callbacks.
 const attempt=await env.DB.prepare('DELETE FROM oauth_attempts WHERE state_hash=? AND expires_at>? RETURNING verifier').bind(await hash(state),Date.now()).first<{verifier:string}>()
 if(!attempt)throw new HttpError(400,'Sign-in expired or already used; start again')
 const response=await upstream('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:callback,code_verifier:attempt.verifier}),signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw new HttpError(502,'Identity provider unavailable; start sign-in again')
 const credentials=await response.json() as {access_token?:string}
 if(!credentials.access_token)throw new HttpError(401,'Sign-in denied; start again')
 const profile=await upstream('https://api.github.com/user',{headers:{Authorization:`Bearer ${credentials.access_token}`,Accept:'application/vnd.github+json','User-Agent':'HOVERGHINI'},signal:AbortSignal.timeout(10000)})
 if(!profile.ok)throw new HttpError(502,'Identity verification failed; start again')
 const user=await profile.json() as {id?:number}
 if(!Number.isSafeInteger(user.id)||user.id!<=0)throw new HttpError(502,'Invalid provider identity')
 const session=await issueSession(env.DB,String(user.id))
 // OAuth access token is not stored or sent to the browser.
 const headers=new Headers({Location:env.APP_ORIGIN+'/?cloud=connected'})
 headers.append('Set-Cookie',setCookie(sessionCookie,session.secret,lifetime))
 headers.append('Set-Cookie',setCookie(stateCookie,'',0))
 return new Response(null,{status:302,headers})
}
