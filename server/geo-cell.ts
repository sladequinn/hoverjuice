import {CELL_PLAYERS,CELLS_WATCHERS,WATCH_METRES,distance,type Geo,type Presence} from '../shared/multiplayer'
import type {MultiplayerEnv} from './multiplayer-http'
interface Watch extends Geo {id:string;epoch:number;expires:number}
/** Ephemeral spatial fan-out, not a simulation or ownership registry. Rebuilt by heartbeats. */
export class GeoCell {
 private watchers=new Map<string,Watch>()
 private publishers=new Map<string,Presence>()
 constructor(private ctx:DurableObjectState,private env:MultiplayerEnv){}
 async fetch(request:Request){
  const path=new URL(request.url).pathname,now=Date.now(),body=await request.json() as any
  for(const [id,w]of this.watchers)if(w.expires<now)this.watchers.delete(id)
  for(const [id,p]of this.publishers)if(p.at+8000<now)this.publishers.delete(id)
  if(path==='/property'){
   this.ctx.waitUntil(Promise.allSettled([...this.watchers.values()].filter(w=>distance(w,body)<WATCH_METRES).map(w=>this.env.PLAYERS.get(this.env.PLAYERS.idFromName(w.id)).fetch('https://player/property',{method:'POST',body:JSON.stringify({watchEpoch:w.epoch,id:body.id,revision:body.revision})}))).then(()=>{}));return new Response('ok')
  }
  if(path==='/watch'){
   const old=this.watchers.get(body.id)
   if(!old&&this.watchers.size>=CELLS_WATCHERS)return new Response('Area full',{status:429})
   if(old&&old.epoch>body.epoch)return Response.json([])
   this.watchers.set(body.id,{...body,expires:now+15000})
   return Response.json([...this.publishers.values()].filter(p=>p.id!==body.id&&distance(p,body)<WATCH_METRES))
  }
  if(path==='/unwatch'){if(this.watchers.get(body.id)?.epoch===body.epoch)this.watchers.delete(body.id);return new Response('ok')}
  if(path==='/remove'){if(this.publishers.get(body.id)?.epoch===body.epoch)this.publishers.delete(body.id);return new Response('ok')}
  if(path==='/publish'){
   const p=body as Presence,old=this.publishers.get(p.id)
   if(!old&&this.publishers.size>=CELL_PLAYERS)return new Response('Area full',{status:429})
   if(old&&(old.epoch>p.epoch||(old.epoch===p.epoch&&old.seq>=p.seq)))return new Response('old')
   this.publishers.set(p.id,p)
   // No cross-region broadcast. Independent deliveries cannot block the publisher's controls.
   this.ctx.waitUntil(Promise.allSettled([...this.watchers.values()].filter(w=>w.id!==p.id&&distance(w,p)<WATCH_METRES).map(w=>
    this.env.PLAYERS.get(this.env.PLAYERS.idFromName(w.id)).fetch('https://player/peer',{method:'POST',body:JSON.stringify({watchEpoch:w.epoch,peer:p})})
   )).then(()=>{}))
   return new Response('ok')
  }
  return new Response('Not found',{status:404})
 }
}
