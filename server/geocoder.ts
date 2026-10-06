interface GeocoderEnv { NOMINATIM_URL?:string; APP_CONTACT:string }
/** One Durable Object for the whole application: aggregate one request/sec, cached queries. */
export class Geocoder {
 private state:DurableObjectState
 private env:GeocoderEnv
 private queue:Promise<unknown>=Promise.resolve()
 constructor(state:DurableObjectState,env:GeocoderEnv){this.state=state;this.env=env}
 fetch(request:Request):Promise<Response>{
  const job=this.queue.then(()=>this.search(request))
  this.queue=job.catch(()=>{})
  return job
 }
 private async search(request:Request){
  const q=new URL(request.url).searchParams.get('q')?.trim()??''
  if(q.length<2||q.length>120)return Response.json({error:'Query must be 2–120 characters'},{status:400})
  if(!this.env.APP_CONTACT)return Response.json({error:'Geocoder contact not configured'},{status:503})
  const key=`query:${q.toLowerCase()}`,hit=await this.state.storage.get<{time:number;body:string}>(key)
  if(hit&&Date.now()-hit.time<86400000)return new Response(hit.body,{headers:{'Content-Type':'application/json'}})
  const last=await this.state.storage.get<number>('last')??0
  const wait=1100-(Date.now()-last)
  if(wait>0)await new Promise(r=>setTimeout(r,wait))
  await this.state.storage.put('last',Date.now())
  const url=new URL(this.env.NOMINATIM_URL??'https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format','json');url.searchParams.set('limit','6');url.searchParams.set('q',q)
  const response=await fetch(url.toString(),{headers:{Accept:'application/json','User-Agent':`Hoverjuice/0.2 (${this.env.APP_CONTACT})`},signal:AbortSignal.timeout(10000)})
  if(!response.ok)return Response.json({error:'Geocoder unavailable'},{status:503})
  const body=await response.text();await this.state.storage.put(key,{time:Date.now(),body})
  // Bounded cache: oldest entries are removed after the cap.
  const keys=await this.state.storage.list({prefix:'query:',limit:201})
  if(keys.size>200){const oldest=[...keys].sort((a,b)=>(a[1] as {time:number}).time-(b[1] as {time:number}).time)[0];await this.state.storage.delete(oldest[0])}
  return new Response(body,{headers:{'Content-Type':'application/json'}})
 }
}
