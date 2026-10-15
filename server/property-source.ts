import {sourceCenter} from './property-geometry'
import {limit} from './security'
export interface PropertySourceEnv {DB:D1Database;PROPERTY_SOURCE_URL?:string;PROPERTY_SOURCE_TOKEN?:string;APP_CONTACT?:string}
/** Demand-loaded OSM snapshots. Dedicated per-cell cache/coalescing; no worldwide preload. */
export class PropertySource {
 constructor(private ctx:DurableObjectState,private env:PropertySourceEnv,private transport:typeof fetch=fetch.bind(globalThis)){}
 async fetch(request:Request){return this.ctx.blockConcurrencyWhile(async()=>{
  const key=new URL(request.url).searchParams.get('cell')??''
  if(!/^\d{1,5}:\d{1,5}$/.test(key))return new Response('Invalid cell',{status:400})
  const center=sourceCenter(key);if(Math.abs(center.lat)>85||Math.abs(center.lon)>180)return new Response('Unsupported location',{status:400})
  const cached=await this.ctx.storage.get<{at:number;count:number}>('snapshot')
  if(cached&&Date.now()-cached.at<900000){const parts=await this.ctx.storage.get<string>(Array.from({length:cached.count},(_,i)=>'part:'+i));return Response.json({at:cached.at,data:JSON.parse(Array.from({length:cached.count},(_,i)=>parts.get('part:'+i)).join(''))})}
  if(!this.env.PROPERTY_SOURCE_URL?.startsWith('https://')||!this.env.APP_CONTACT)return new Response('Property map source is not configured',{status:503})
  await limit(this.env.DB,'property-source-global',60)
  const query=`[out:json][timeout:10];way["building"][!"building:part"](around:1000,${center.lat},${center.lon})->.w;(.w;relation["building"]["type"="multipolygon"](around:1000,${center.lat},${center.lon});relation(bw.w)["building"]["type"="multipolygon"];way["highway"~"^(residential|unclassified|tertiary|secondary|living_street|service)$"](around:1000,${center.lat},${center.lon}););out meta geom;`
  const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded','User-Agent':`HOVERGHINI property registry (${this.env.APP_CONTACT})`}
  if(this.env.PROPERTY_SOURCE_TOKEN)headers.Authorization=`Bearer ${this.env.PROPERTY_SOURCE_TOKEN}`
  const response=await this.transport(this.env.PROPERTY_SOURCE_URL,{method:'POST',headers,body:new URLSearchParams({data:query}),redirect:'manual',signal:AbortSignal.timeout(12000)})
  if(!response.ok)return new Response('Property source unavailable',{status:503})
  const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let length=0
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2097152){await reader.cancel();return new Response('Area too complex for safe import',{status:503})}chunks.push(value)}
  const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
  const data=JSON.parse(new TextDecoder().decode(bytes));if(data.remark||!Array.isArray(data.elements))return new Response('Incomplete source data',{status:503})
  const snapshot={at:Date.now(),data},json=JSON.stringify(data),entries:Record<string,unknown>={snapshot:{at:snapshot.at,count:Math.ceil(json.length/20000)}};for(let i=0;i<json.length;i+=20000)entries['part:'+i/20000]=json.slice(i,i+20000);await this.ctx.storage.put(entries);await this.ctx.storage.setAlarm(Date.now()+86400000)
  return Response.json(snapshot)
 })}
 async alarm(){await this.ctx.storage.deleteAll()}
}
