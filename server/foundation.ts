import {authenticate,authRoute,type AuthEnv} from './auth'
import {cookie,hash,HttpError,limit,readJson,sameOrigin,sessionCookie,setCookie} from './security'
import {readSave,writeSave} from './saves'
export interface FoundationEnv extends AuthEnv {BACKEND_ENABLED?:string}
const paths=new Set(['/api/auth/login','/api/auth/callback','/api/auth/logout','/api/auth/logout-all','/api/me','/api/save','/api/wallet'])
export function foundationPath(path:string){return paths.has(path)}
export async function foundation(request:Request,env:FoundationEnv){
 if(env.BACKEND_ENABLED!=='true')throw new HttpError(503,'Cloud accounts are not enabled on this host')
 const origin=env.APP_ORIGIN
 if(!origin||new URL(origin).origin!==origin||!origin.startsWith('https://')||new URL(request.url).origin!==origin)throw new HttpError(503,'Cloud accounts require the configured HTTPS game origin')
 const url=new URL(request.url),path=url.pathname
 const method=path==='/api/save'?['GET','PUT']:path==='/api/auth/logout'||path==='/api/auth/logout-all'?['POST']:['GET']
 if(!method.includes(request.method))throw new HttpError(405,'Method not allowed')
 if(request.method!=='GET')sameOrigin(request,origin)
 if(path==='/api/auth/login'||path==='/api/auth/callback'){
  // Cloudflare supplies this header. Local tests share a bounded fallback bucket.
  await limit(env.DB,`auth:${await hash(request.headers.get('CF-Connecting-IP')??'local')}`,20)
  return authRoute(request,env)
 }
 const player=await authenticate(request,env.DB)
 await limit(env.DB,`player:${player}`,120)
 if(path==='/api/auth/logout'||path==='/api/auth/logout-all'){
  if(path.endsWith('logout-all'))await env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(player).run()
  else await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(cookie(request,sessionCookie))).run()
  return Response.json({ok:true},{headers:{'Set-Cookie':setCookie(sessionCookie,'',0)}})
 }
 if(path==='/api/me')return Response.json({playerId:player,saveMode:'legacy-local',walletMode:'server-authoritative'})
 if(path==='/api/wallet'){
  const wallet=await env.DB.prepare('SELECT balance,version FROM wallets WHERE player_id=?').bind(player).first()
  if(!wallet)throw new HttpError(503,'Wallet unavailable')
  return Response.json({playerId:player,currency:'HG',unit:'minor',...wallet})
 }
 if(request.method==='GET')return Response.json(await readSave(env.DB,player))
 return Response.json(await writeSave(env.DB,player,await readJson(request)))
}
export async function cleanup(db:D1Database){
 const now=Date.now()
 // Bounded deletes avoid long-running scheduled transactions. Receipts/ledger retained.
 await db.batch(['sessions','oauth_attempts','request_limits'].map(table=>db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE expires_at<=? LIMIT 5000)`).bind(now)))
}
