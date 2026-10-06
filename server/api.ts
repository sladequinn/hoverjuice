export { Geocoder } from './geocoder'
interface Env {DB:D1Database; ALLOWED_ORIGIN:string; GEOCODER:DurableObjectNamespace}
/** Read gateway. Do not expose claim/record writes until server-side identity and economy validation exist. */
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':env.ALLOWED_ORIGIN,'Vary':'Origin'}
  const url=new URL(request.url)
  if(request.method!=='GET')return new Response('{"error":"Read-only gateway"}',{status:405,headers})
  if(url.pathname==='/api/geocode'){
    try{const res=await env.GEOCODER.get(env.GEOCODER.idFromName('global')).fetch(request);return new Response(res.body,{status:res.status,headers})}
    catch{return new Response('{"error":"Geocoder unavailable"}',{status:503,headers})}
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
