import {authenticate} from './auth'
import {HttpError,limit,readJson,sameOrigin} from './security'
import {myCrew,crewCommand} from './crews'
import {districtBounds} from '../shared/crews'
import type {MultiplayerEnv} from './multiplayer-http'
export interface CrewsEnv extends MultiplayerEnv {CREWS_ENABLED?:string;PROPERTIES_ENABLED?:string;TERRITORIES:DurableObjectNamespace;PROPERTY_SOURCE:DurableObjectNamespace}
export async function crewsHttp(request:Request,env:CrewsEnv){
 const url=new URL(request.url),path=url.pathname,enabled=env.BACKEND_ENABLED==='true'&&env.MULTIPLAYER_ENABLED==='true'&&env.PROPERTIES_ENABLED==='true'&&env.CREWS_ENABLED==='true'
 if(path==='/api/crews/status'&&request.method==='GET')return Response.json({enabled})
 if(!enabled)throw new HttpError(503,'Crews are not enabled on this host')
 if(url.origin!==env.APP_ORIGIN||!env.APP_ORIGIN.startsWith('https://'))throw new HttpError(403,'Wrong game origin')
 if(request.method!=='GET')sameOrigin(request,env.APP_ORIGIN)
 const player=await authenticate(request,env.DB);await limit(env.DB,`crew:${player}`,120)
 if(path==='/api/crews/me'&&request.method==='GET')return Response.json({player,crew:await myCrew(env.DB,player)})
 if(path==='/api/crews/command'&&request.method==='POST'){
  await limit(env.DB,`crew-write:${player}`,12)
  return Response.json(await crewCommand(env.DB,player,await readJson(request)))
 }
 if(path==='/api/crews/district'&&request.method==='GET'){
  const district=url.searchParams.get('id');try{districtBounds(district!)}catch{throw new HttpError(400,'Invalid district')}
  return env.TERRITORIES.get(env.TERRITORIES.idFromName(district!)).fetch('https://territory/view',{method:'POST',body:JSON.stringify({district})})
 }
 if(path==='/api/crews/contest'&&request.method==='POST'){
  await limit(env.DB,`crew-contest:${player}`,6)
  const b=await readJson(request);if(!b||!['open','join'].includes(b.action)||Object.keys(b).sort().join(',')!=='action,district')throw new HttpError(400,'Invalid contest command')
  try{districtBounds(b.district)}catch{throw new HttpError(400,'Invalid district')}
  // Serialized through the player's existing actor. Client identities, poses, scores and rewards are ignored.
  return env.PLAYERS.get(env.PLAYERS.idFromName(player)).fetch('https://player/contest',{method:'POST',body:JSON.stringify({player,...b})})
 }
 throw new HttpError(404,'Not found')
}
