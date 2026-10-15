import {authenticate,type AuthEnv} from './auth'
import {cookie,hash,HttpError,limit,readJson,sameOrigin,sessionCookie} from './security'
import {validGeo,validName,validId} from '../shared/multiplayer'
export interface MultiplayerEnv extends AuthEnv {BACKEND_ENABLED?:string;MULTIPLAYER_ENABLED?:string;PLAYERS:DurableObjectNamespace;CELLS:DurableObjectNamespace;RACES:DurableObjectNamespace}
export async function multiplayerHttp(request:Request,env:MultiplayerEnv){
 const url=new URL(request.url),path=url.pathname
 const enabled=env.BACKEND_ENABLED==='true'&&env.MULTIPLAYER_ENABLED==='true'
 if(path==='/api/multiplayer/status'&&request.method==='GET')return Response.json({enabled,version:1},{headers:{'Cache-Control':'no-store'}})
 if(!enabled)throw new HttpError(503,'Multiplayer is not enabled on this host')
 if(url.origin!==env.APP_ORIGIN||!env.APP_ORIGIN.startsWith('https://'))throw new HttpError(403,'Wrong game origin')
 if(request.method!=='GET'||path.endsWith('/socket'))sameOrigin(request,env.APP_ORIGIN)
 const id=await authenticate(request,env.DB)
 await limit(env.DB,`mp:${id}`,60)
 const player=await env.DB.prepare('SELECT display_name FROM players WHERE id=?').bind(id).first<{display_name:string}>()
 const name=player?.display_name||`Driver ${id.slice(0,4)}`
 if(path==='/api/multiplayer/socket'){
  if(request.method!=='GET'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')throw new HttpError(426,'WebSocket required')
  await limit(env.DB,`mp-connect:${id}`,12)
  const anchor={lat:Number(url.searchParams.get('lat')),lon:Number(url.searchParams.get('lon'))}
  if(!url.searchParams.has('lat')||!url.searchParams.has('lon')||!validGeo(anchor))throw new HttpError(400,'Invalid location')
  const headers=new Headers({Upgrade:'websocket','X-Peers':url.searchParams.get('peers')==='12'?'12':'24','X-Player':id,'X-Name':encodeURIComponent(name),'X-Session':await hash(cookie(request,sessionCookie))})
  return env.PLAYERS.get(env.PLAYERS.idFromName(id)).fetch(new Request(`https://player/connect?lat=${anchor.lat}&lon=${anchor.lon}`,{headers}))
 }
 if(path==='/api/multiplayer/profile'&&request.method==='POST'){
  const body=await readJson(request)
  if(!validName(body?.name))throw new HttpError(400,'Use 2–20 letters, numbers, spaces, dots, underscores or hyphens')
  await env.DB.prepare('UPDATE players SET display_name=? WHERE id=?').bind(body.name,id).run()
  return Response.json({name:body.name})
 }
 if(path==='/api/multiplayer/invite'&&request.method==='POST'){
  // Invite location/race come from this player's live, validated session, never the HTTP body.
  const live=await env.PLAYERS.get(env.PLAYERS.idFromName(id)).fetch('https://player/location')
  if(!live.ok)throw new HttpError(409,'Connect in a city before creating an invite')
  const location=await live.json() as {lat:number;lon:number;raceId?:string}
  const code=crypto.randomUUID(),expires=Date.now()+3*3600000
  await env.DB.prepare('INSERT INTO multiplayer_invites(code,lat,lon,race_id,expires_at) VALUES(?,?,?,?,?)').bind(code,location.lat,location.lon,location.raceId??null,expires).run()
  return Response.json({url:`${env.APP_ORIGIN}/?join=${code}`,expiresAt:expires})
 }
 if(path==='/api/multiplayer/invite'&&request.method==='GET'){
  const code=url.searchParams.get('code');if(!validId(code))throw new HttpError(400,'Invalid invite')
  const invite=await env.DB.prepare('SELECT lat,lon,race_id AS raceId FROM multiplayer_invites WHERE code=? AND expires_at>?').bind(code,Date.now()).first()
  if(!invite)throw new HttpError(404,'Invite expired or not found')
  return Response.json(invite)
 }
 throw new HttpError(404,'Not found')
}
