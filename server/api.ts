import {crewsHttp,type CrewsEnv} from './crews-http'
export {Territory} from './territory'
import {propertiesHttp,type PropertiesEnv} from './properties-http'
export {PropertySource} from './property-source'
import {multiplayerHttp,type MultiplayerEnv} from './multiplayer-http'
export {PlayerSession} from './player-session'
export {GeoCell} from './geo-cell'
export {CruiseRace} from './cruise-race'
import {foundation,foundationPath,cleanup,type FoundationEnv} from './foundation'
import {HttpError} from './security'
import {parseRadioConfig} from '../src/radio-config'
export { Geocoder } from './geocoder'
interface Env extends FoundationEnv,MultiplayerEnv,PropertiesEnv,CrewsEnv {ASSETS?:Fetcher;RADIO_CONFIG_JSON?:string;DB:D1Database; ALLOWED_ORIGIN:string; GEOCODER:DurableObjectNamespace}
/** Public map reads and an isolated same-origin account API. */
export default {
 async scheduled(_event:ScheduledController,env:Env){await cleanup(env.DB)},
 async fetch(request:Request,env:Env,ctx?:ExecutionContext):Promise<Response>{
  const path=new URL(request.url).pathname
  if(path.startsWith('/api/crews/')){
   try{const r=await crewsHttp(request,env);return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}catch(e){return Response.json({error:e instanceof HttpError?e.message:'Crew service unavailable; retry the same request'},{status:e instanceof HttpError?e.status:503,headers:{'Cache-Control':'no-store'}})}
  }
  if(path.startsWith('/api/properties/')){
   let response:Response
   try{response=await propertiesHttp(request,env,ctx)}catch(error){response=Response.json({error:error instanceof HttpError?error.message:'Property service unavailable; retry the same purchase request safely'},{status:error instanceof HttpError?error.status:503})}
   const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');if(response.status===429)headers.set('Retry-After','60')
   return new Response(response.body,{status:response.status,headers})
  }
  if(path.startsWith('/api/multiplayer/')){
   try{const response=await multiplayerHttp(request,env);if(response.status===101)return response;const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers})}catch(error){return Response.json({error:error instanceof HttpError?error.message:'Multiplayer unavailable'},{status:error instanceof HttpError?error.status:503,headers:{'Cache-Control':'no-store'}})}
  }
  if(foundationPath(path)){
   const requestId=crypto.randomUUID()
   let response:Response
   try{response=await foundation(request,env)}
   catch(error){
    const status=error instanceof HttpError?error.status:503
    if(status>=500)console.error(JSON.stringify({event:'backend_failure',requestId,path,status}))
    response=Response.json({requestId,error:error instanceof HttpError?error.message:'Service unavailable. Retry the same request safely.'},{status})
   }
   const headers=new Headers(response.headers)
   headers.set('X-Request-ID',requestId);headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer')
   if(response.status===429)headers.set('Retry-After','60')
   return new Response(response.body,{status:response.status,headers})
  }
  if(!path.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404})
  if(!['/api/geocode','/api/radio','/api/ownership','/api/records'].includes(path))return Response.json({error:'Not found'},{status:404})
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':env.ALLOWED_ORIGIN,'Vary':'Origin'}
  const url=new URL(request.url)
  if(request.method!=='GET')return new Response('{"error":"Read-only gateway"}',{status:405,headers})
  if(url.pathname==='/api/geocode'){
    try{const res=await env.GEOCODER.get(env.GEOCODER.idFromName('global')).fetch(request);return new Response(res.body,{status:res.status,headers})}
    catch{return new Response('{"error":"Geocoder unavailable"}',{status:503,headers})}
  }
  if(url.pathname==='/api/radio'){
   try{return new Response(JSON.stringify(parseRadioConfig(JSON.parse(env.RADIO_CONFIG_JSON??'{}'))),{headers:{...headers,'Cache-Control':'public, max-age=60'}})}
   catch{return new Response('{"error":"Invalid radio configuration"}',{status:503,headers})}
  }
  const tile=url.searchParams.get('tile')??''
  if(!/^14_\d{1,5}_\d{1,5}$/.test(tile)||tile.split('_').slice(1).some(n=>Number(n)>16383))return new Response('{"error":"Invalid tile"}',{status:400,headers})
  if(url.pathname==='/api/ownership'){
   const rows=await env.DB.prepare('SELECT building_id AS buildingId,tile,owner_id AS ownerId,gang FROM ownership WHERE tile=? LIMIT 2000').bind(tile).all()
   return new Response(JSON.stringify(rows.results),{headers})
  }
  if(url.pathname==='/api/records'){
   const rows=await env.DB.prepare('SELECT segment_id AS segmentId,player_id AS playerId,elapsed_ms AS elapsedMs,ghost_json AS ghost FROM speed_records WHERE tile=? LIMIT 100').bind(tile).all()
   return new Response(JSON.stringify(rows.results),{headers})
  }
  return new Response('{"error":"Not found"}',{status:404,headers})
 }
}
