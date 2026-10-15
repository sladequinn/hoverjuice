import {limit} from './security'
import {cellFor,watchingCells,distance,saneMove,validMove,validCourse,validId,MAX_PEERS,WATCH_METRES,type Geo,type Presence} from '../shared/multiplayer'
import type {CrewsEnv} from './crews-http'
interface Attachment {id:string;name:string;epoch:number;session:string;anchor:Geo;last:Presence|null;checked:number;window:number;count:number;bad:number;cells:string[];watchAt:number;watchPos:Geo;raceId?:string;raceTick:number;budget:number;budgetAt:number;commandAt:number;ackAt:number;peerLimit:number;contestTick?:number;crewTag?:string}
export class PlayerSession {
 private epoch=0
 private contest:{district:string;id:string}|undefined
 private contestPending=false
 private queue:Promise<unknown>=Promise.resolve()
 private pending=0
 private visible=new Map<string,Presence>()
 constructor(private ctx:DurableObjectState,private env:CrewsEnv){ctx.blockConcurrencyWhile(async()=>{this.epoch=await ctx.storage.get<number>('epoch')??0;this.contest=await ctx.storage.get('contest')})}
 private active(){return this.ctx.getWebSockets().find(ws=>ws.readyState===1&&(ws.deserializeAttachment() as Attachment)?.epoch===this.epoch)}
 private send(ws:WebSocket,data:unknown){try{ws.send(JSON.stringify(data))}catch{}}
 private cell(key:string,path:string,body:unknown){return this.env.CELLS.get(this.env.CELLS.idFromName(key)).fetch(`https://cell${path}`,{method:'POST',body:JSON.stringify(body)})}
 async fetch(request:Request){
  const url=new URL(request.url)
  if(url.pathname==='/connect')return this.ctx.blockConcurrencyWhile(async()=>{
   const id=request.headers.get('X-Player')!,session=request.headers.get('X-Session')!,name=decodeURIComponent(request.headers.get('X-Name')!)
   if(!validId(id)||!session)return new Response('Forbidden',{status:403})
   const pair=new WebSocketPair(),client=pair[0],ws=pair[1]
   this.epoch++;await this.ctx.storage.put('epoch',this.epoch)
   for(const old of this.ctx.getWebSockets())old.close(4009,'Replaced by another connection')
   this.visible.clear()
   this.ctx.acceptWebSocket(ws)
   const anchor={lat:Number(url.searchParams.get('lat')),lon:Number(url.searchParams.get('lon'))}
   const a:Attachment={id,name,epoch:this.epoch,session,anchor,last:null,checked:0,window:Date.now(),count:0,bad:0,cells:[],watchAt:0,watchPos:anchor,raceId:await this.ctx.storage.get<string>('raceId'),raceTick:0,budget:80,budgetAt:Date.now(),commandAt:0,ackAt:0,peerLimit:request.headers.get('X-Peers')==='12'?12:MAX_PEERS}
   ws.serializeAttachment(a)
   this.send(ws,{type:'welcome',id,name,epoch:this.epoch,maxPeers:a.peerLimit,at:Date.now()})
   return new Response(null,{status:101,webSocket:client})
  })
  const ws=this.active(),a=ws?.deserializeAttachment() as Attachment|undefined
  if(url.pathname==='/contest'){
   return (async()=>{
   const b=await request.json() as any,current=this.active(),a=current?.deserializeAttachment() as Attachment|undefined
   if(this.env.CREWS_ENABLED!=='true'||!a?.last||a.id!==b.player||a.last.at+8000<Date.now())return Response.json({error:'Connect and drive in this district first'},{status:409})
   const res=await this.env.TERRITORIES.get(this.env.TERRITORIES.idFromName(b.district)).fetch('https://territory/'+b.action,{method:'POST',body:JSON.stringify({district:b.district,player:a.id,name:a.name,position:a.last})})
   if(!res.ok)return res
   if(a.epoch!==this.epoch||current?.readyState!==1)return Response.json({error:'Connection changed; join again'},{status:409})
   const view=await res.json() as any
   if(b.action==='join'&&view.contest){const contest={district:b.district,id:view.contest.id};const attached=await this.ctx.blockConcurrencyWhile(async()=>{if(a.epoch!==this.epoch)return false;await this.ctx.storage.put('contest',contest);this.contest=contest;return true});if(!attached)return Response.json({error:'Connection changed; join again'},{status:409})}
   return Response.json(view)
   })()
  }
  if(url.pathname==='/location')return a?.last&&a.last.at+8000>Date.now()?Response.json({...a.last,raceId:a.raceId}):new Response('Offline',{status:409})
  if(url.pathname==='/property'){
   const body=await request.json() as any;if(ws&&a?.epoch===body.watchEpoch)this.send(ws,{type:'property-changed',id:body.id,revision:body.revision});return new Response('ok')
  }
  if(url.pathname==='/peer'){
   const body=await request.json() as {watchEpoch:number;peer:Presence}
   if(ws&&a?.epoch===body.watchEpoch)this.deliver(ws,a,body.peer)
   return new Response('ok')
  }
  if(url.pathname==='/race'){
   const body=await request.json() as any
   if(ws&&a?.raceId===body.race?.id)this.send(ws,body)
   return new Response('ok')
  }
  return new Response('Not found',{status:404})
 }
 private deliver(ws:WebSocket,a:Attachment,p:Presence){
  if(!a.last||p.id===a.id||p.at+5000<Date.now()||distance(a.last,p)>WATCH_METRES)return
  const old=this.visible.get(p.id)
  if(old&&(old.epoch>p.epoch||(old.epoch===p.epoch&&old.seq>=p.seq)))return
  for(const [id,peer]of this.visible)if(peer.at+5000<Date.now()||distance(a.last,peer)>WATCH_METRES)this.visible.delete(id)
  if(!this.visible.has(p.id)&&this.visible.size>=(a.peerLimit??MAX_PEERS)){
   const far=[...this.visible.values()].sort((x,y)=>distance(a.last!,y)-distance(a.last!,x))[0]
   if(distance(a.last,p)>=distance(a.last,far))return
   this.visible.delete(far.id);this.send(ws,{type:'remove',id:far.id,epoch:far.epoch})
  }
  this.visible.set(p.id,p);this.send(ws,{type:'peer',peer:p})
 }
 webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){
  if(typeof message!=='string'||message.length>4096){ws.close(1008,'Invalid message');return}
  if(this.pending>=4){ws.close(1013,'Network queue full');return}
  this.pending++
  const task=this.queue.then(()=>this.message(ws,message)).catch(()=>{this.send(ws,{type:'status',message:'Multiplayer temporarily unavailable'});ws.close(1013,'Service unavailable')}).finally(()=>{this.pending--})
  this.queue=task;return task
 }
 private async message(ws:WebSocket,message:string){
  const a=ws.deserializeAttachment() as Attachment,now=Date.now()
  if(a.epoch!==this.epoch||ws.readyState!==1)return
  if(now-a.window>=1000){a.window=now;a.count=0}
  if(++a.count>16){ws.close(1008,'Rate limit');return}
  if(now-a.checked>30000){
   const session=await this.env.DB.prepare('SELECT player_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(a.session,now).first<{player_id:string}>()
   if(!session||session.player_id!==a.id){ws.close(4001,'Sign in again');return}
   if(a.epoch!==this.epoch||ws.readyState!==1)return
   if(this.env.CREWS_ENABLED==='true'){
    const crew=await this.env.DB.prepare('SELECT c.tag FROM crew_members m JOIN crews c ON c.id=m.crew_id WHERE m.player_id=? AND c.active=1').bind(a.id).first<{tag:string}>();a.crewTag=crew?.tag
   }
   a.checked=now
  }
  ws.serializeAttachment(a)
  let body:any;try{body=JSON.parse(message)}catch{body=null}
  if(body?.type==='race-create'||body?.type==='race-join'||body?.type==='race-start'||body?.type==='race-leave'){
   if(now-a.commandAt<1000)return
   a.commandAt=now
   await this.race(ws,a,body);if(a.epoch===this.epoch)ws.serializeAttachment(a);return
  }
  const budget=Math.min(80,a.budget+(now-a.budgetAt)*.22)
  if(!validMove(body)||!saneMove(body,a.last,a.anchor,now)||(a.last&&distance(body,a.last)>budget)){
   a.bad++;ws.serializeAttachment(a);this.send(ws,{type:'rejected',message:'Movement rejected; rejoin after city travel'})
   if(a.bad>=3)ws.close(1008,'Invalid movement');return
  }
  a.budget=a.last?budget-distance(body,a.last):80;a.budgetAt=now
  const oldCell=a.last?cellFor(a.last):null
  a.last={...body,...(a.crewTag?{crewTag:a.crewTag}:{}),id:a.id,name:a.name,epoch:a.epoch,at:now};ws.serializeAttachment(a)
  if(now-a.watchAt>5000||distance(a.watchPos,body)>100){
   const cells=watchingCells(body)
   const responses=await Promise.all(cells.map(key=>this.cell(key,'/watch',{id:a.id,epoch:a.epoch,lat:body.lat,lon:body.lon})))
   if(a.epoch!==this.epoch||ws.readyState!==1)return
   for(const res of responses){if(!res.ok){ws.close(1013,'Area full');return}for(const p of await res.json() as Presence[])this.deliver(ws,a,p)}
   await Promise.all(a.cells.filter(k=>!cells.includes(k)).map(k=>this.cell(k,'/unwatch',a)))
   a.cells=cells;a.watchAt=now;a.watchPos={lat:body.lat,lon:body.lon}
  }
  const current=cellFor(body)
  // Publish new cell before removing old. Clients deduplicate by player/epoch/sequence.
  if(a.epoch!==this.epoch||ws.readyState!==1)return
  const published=await this.cell(current,'/publish',a.last)
  if(!published.ok){ws.close(1013,'Area full');return}
  if(oldCell&&oldCell!==current)await this.cell(oldCell,'/remove',a)
  if(this.env.CREWS_ENABLED==='true'&&this.contest&&!this.contestPending&&now-(a.contestTick??0)>=250){
   a.contestTick=now;this.contestPending=true;const contest=this.contest,position=a.last
   // Bound to one in-flight update; territory latency must never hold the driving message queue.
   this.ctx.waitUntil(this.env.TERRITORIES.get(this.env.TERRITORIES.idFromName(contest.district)).fetch('https://territory/move',{method:'POST',body:JSON.stringify({district:contest.district,contest:contest.id,position})}).then(async res=>{
    if(res.ok&&(await res.json() as any).done)await this.ctx.blockConcurrencyWhile(async()=>{if(this.contest?.id===contest.id){await this.ctx.storage.delete('contest');this.contest=undefined}})
   }).catch(()=>{}).finally(()=>{this.contestPending=false}))
  }
  if(a.raceId&&now-a.raceTick>=180){a.raceTick=now;await this.env.RACES.get(this.env.RACES.idFromName(a.raceId)).fetch('https://race/move',{method:'POST',body:JSON.stringify(a.last)})}
  if(a.epoch===this.epoch){if(now-(a.ackAt??0)>=2000){a.ackAt=now;this.send(ws,{type:'ack',seq:body.seq,at:now})}ws.serializeAttachment(a)}
 }
 private async race(ws:WebSocket,a:Attachment,body:any){
  if(!a.last||a.last.at+8000<Date.now())return
  if(body.type==='race-leave'){if(a.raceId)await this.env.RACES.get(this.env.RACES.idFromName(a.raceId)).fetch('https://race/leave',{method:'POST',body:JSON.stringify({player:a.id})});if(a.epoch!==this.epoch)return;a.raceId=undefined;await this.ctx.storage.delete('raceId');this.send(ws,{type:'race',race:null});return}
  let id=a.raceId,path='/start'
  if(body.type==='race-create'){
   if(!validCourse(body.course,a.last)){this.send(ws,{type:'status',message:'Use a nearby road loop with 2–32 checkpoints'});return}
   await limit(this.env.DB,`mp-race:${a.id}`,3)
   id=crypto.randomUUID();path='/create'
  }else if(body.type==='race-join'){
   if(!validId(body.id))return
   id=body.id;path='/join'
  }
  if(!id)return
  const res=await this.env.RACES.get(this.env.RACES.idFromName(id)).fetch('https://race'+path,{method:'POST',body:JSON.stringify({id,player:a.id,name:a.name,position:a.last,course:body.course})})
  if(a.epoch!==this.epoch||ws.readyState!==1)return
  if(!res.ok){this.send(ws,{type:'status',message:await res.text()});return}
  a.raceId=id;await this.ctx.storage.put('raceId',id);ws.serializeAttachment(a)
  this.send(ws,{type:'race',race:await res.json()})
 }
 async webSocketClose(ws:WebSocket){const a=ws.deserializeAttachment() as Attachment;if(!a||a.epoch!==this.epoch)return;await Promise.allSettled([...a.cells.map(k=>this.cell(k,'/unwatch',a)),...(a.last?[this.cell(cellFor(a.last),'/remove',a)]:[])])}
 webSocketError(ws:WebSocket){ws.close(1011,'Connection failed')}
}
