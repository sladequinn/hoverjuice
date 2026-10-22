import type {Geo,Move} from '../shared/multiplayer'
export interface NetworkDeps {peerLimit?:number;fetch:typeof fetch;socket:(url:string)=>WebSocket;origin:string;status:(message:string)=>void;message:(data:any)=>void}
/** Network timers and JSON parsing stay outside the animation loop. Driving never awaits this. */
export class RealtimeConnection {
 private ws:WebSocket|null=null
 private disposed=false
 private stopped=false
 private retry=0
 private reconnect:ReturnType<typeof setTimeout>|null=null
 private timer:ReturnType<typeof setInterval>|null=null
 private openedAt=0
 private lastReceived=0
 private lastSent=0
 private signature=''
 private seq=0
 private latest:Omit<Move,'seq'>|null=null
 private inFlight=false
 private epoch=0
 private deps:NetworkDeps
 private anchor:Geo
 bytesSent=0
 bytesReceived=0
 connected=false
 constructor(anchor:Geo,deps:NetworkDeps){this.anchor=anchor;this.deps=deps}
 sample(sample:Omit<Move,'seq'>){this.latest=sample}
 async start(){
  if(this.disposed)return
  this.stopped=false
  if(this.inFlight||(this.ws&&this.ws.readyState<2))return
  this.inFlight=true
  try{
   const response=await this.deps.fetch('/api/multiplayer/status',{credentials:'same-origin',signal:AbortSignal.timeout(8000)})
   if(response.status===404){this.deps.status('ONLINE SERVICE UNAVAILABLE');return}
   if(!response.ok)throw Error('Service unavailable')
   if(!response.headers.get('Content-Type')?.includes('application/json')){this.deps.status('ONLINE SERVICE UNAVAILABLE');return}
   const config=await response.json()
   if(!config?.enabled){this.deps.status('ONLINE SERVICE UNAVAILABLE');return}
   const me=await this.deps.fetch('/api/me',{credentials:'same-origin',signal:AbortSignal.timeout(8000)})
   if(me.status===401){this.deps.status('SIGN IN TO CRUISE');return}
   if(!me.ok)throw Error('Offline')
   if(this.disposed||this.stopped)return
   const p=this.latest??this.anchor,url=new URL('/api/multiplayer/socket',this.deps.origin)
   url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('lat',String(p.lat));url.searchParams.set('lon',String(p.lon));url.searchParams.set('peers',String(this.deps.peerLimit??24))
   this.deps.status('CONNECTING')
   const ws=this.deps.socket(url.href);this.ws=ws;this.seq=0;this.signature='';this.lastSent=0
   ws.onopen=()=>{if(this.ws!==ws)return;this.connected=true;this.lastReceived=Date.now();this.openedAt=this.lastReceived;this.deps.status('CRUISING ONLINE');this.timer=setInterval(()=>this.tick(),100)}
   ws.onmessage=event=>{
    if(this.ws!==ws||typeof event.data!=='string'||event.data.length>32768)return
    this.lastReceived=Date.now()
    this.bytesReceived+=event.data.length
    let data;try{data=JSON.parse(event.data)}catch{return}
    if(!data||typeof data!=='object')return
    if(data.type==='ack'&&Date.now()-this.openedAt>10000)this.retry=0
    if(data.type==='welcome'){this.epoch=data.epoch}
    this.deps.message(data)
   }
   ws.onerror=()=>this.deps.status('RECONNECTING')
   ws.onclose=event=>{
    if(this.ws!==ws)return
    this.ws=null;this.connected=false;if(this.timer)clearInterval(this.timer);this.timer=null
    if(this.disposed||this.stopped)return
    if([4001,4009,1008].includes(event.code)){this.stopped=true;this.deps.status(event.code===4009?'ACTIVE IN ANOTHER TAB':event.code===4001?'SIGN IN AGAIN':'REJOIN TO RESUME MULTIPLAYER');return}
    this.schedule();if(event.code===1013&&event.reason?.includes('full'))this.deps.status('AREA BUSY · RETRYING')
   }
  }catch{if(!this.disposed&&!this.stopped){this.deps.status('MULTIPLAYER UNAVAILABLE');this.schedule()}}
  finally{this.inFlight=false}
 }
 private schedule(){if(this.disposed||this.stopped||this.reconnect)return;this.deps.status('RECONNECTING');const delay=Math.min(30000,1000*2**this.retry++)+Math.random()*500;this.reconnect=setTimeout(()=>{this.reconnect=null;void this.start()},delay)}
 private tick(){
  if(this.connected&&Date.now()-this.lastReceived>12000){
   const ws=this.ws;this.ws=null;this.connected=false;if(this.timer)clearInterval(this.timer);this.timer=null;ws?.close(4000,'Heartbeat timeout');this.schedule();return
  }
  if(!this.latest||this.ws?.readyState!==1||this.ws.bufferedAmount>16384)return
  const signature=JSON.stringify(this.latest),now=Date.now()
  if(signature===this.signature&&now-this.lastSent<1000)return
  this.signature=signature;this.lastSent=now
  this.send({...this.latest,seq:this.seq++})
 }
 send(data:unknown){if(this.ws?.readyState!==1||this.ws.bufferedAmount>16384)return false;const text=JSON.stringify(data);this.bytesSent+=text.length;this.ws.send(text);return true}
 pause(){this.stopped=true;this.connected=false;if(this.reconnect)clearTimeout(this.reconnect);this.reconnect=null;if(this.timer)clearInterval(this.timer);this.timer=null;const ws=this.ws;this.ws=null;ws?.close(1000,'Paused');this.deps.status('ONLINE SERVICE UNAVAILABLE')}
 dispose(){this.disposed=true;this.pause()}
 get generation(){return this.epoch}
}
