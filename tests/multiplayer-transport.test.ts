import {test} from 'node:test'
import assert from 'node:assert/strict'
import {RealtimeConnection} from '../src/multiplayer-transport'
import {GeoCell} from '../server/geo-cell'
import {CELL_PLAYERS,CELLS_WATCHERS} from '../shared/multiplayer'
const pose={type:'move' as const,v:1 as const,lat:0,lon:0,y:0,clearance:1,yaw:0,vx:0,vz:0,chassis:'board',mask:'balaclava',paint:'factory',boost:false}
class Socket {readyState=0;bufferedAmount=0;sent:string[]=[];onopen:any;onmessage:any;onclose:any;onerror:any;send(data:string){this.sent.push(data)}close(){this.readyState=3}open(){this.readyState=1;this.onopen()}receive(data:any){this.onmessage({data:JSON.stringify(data)})}}
function setup(enabled=true,authenticated=true){const sockets:Socket[]=[],status:string[]=[];let calls=0;const c=new RealtimeConnection(pose,{origin:'https://game.test',fetch:async()=>{calls++;return calls%2===1?Response.json({enabled}):new Response('{}',{status:authenticated?200:401})},socket:()=>{const s=new Socket();sockets.push(s);return s as any},status:s=>status.push(s),message:()=>{}});return {c,sockets,status,get calls(){return calls}}}
test('disabled service and signed-out player leave local play available without sockets',async()=>{for(const enabled of [false,true]){const a=setup(enabled,false);await a.c.start();assert.equal(a.sockets.length,0);assert.match(a.status.at(-1)!,enabled?/SIGN IN/:/LOCAL/);a.c.dispose()}})
test('one connecting socket; bounded mobile bandwidth and backpressure without blocking sample updates',async()=>{
 const a=setup();await a.c.start();await a.c.start();assert.equal(a.sockets.length,1);const ws=a.sockets[0];ws.open();assert.doesNotThrow(()=>ws.receive(null));a.c.sample(pose)
 ;(a.c as any).tick();for(let i=0;i<20;i++)(a.c as any).tick();assert.equal(ws.sent.length,1);assert.ok(a.c.bytesSent<350)
 ws.bufferedAmount=20000;a.c.sample({...pose,lon:.00001});(a.c as any).tick();assert.equal(ws.sent.length,1)
 ws.bufferedAmount=0;(a.c as any).tick();assert.equal(ws.sent.length,2);assert.equal(JSON.parse(ws.sent[1]).seq,1);a.c.dispose()
})
test('heartbeat failure retries, duplicate replacement stops retry, explicit rejoin recovers',async()=>{
 const a=setup();await a.c.start();a.sockets[0].open();(a.c as any).lastReceived=0;(a.c as any).tick();assert.equal(a.c.connected,false);assert.ok((a.c as any).reconnect);a.c.pause()
 await a.c.start();const ws=a.sockets.at(-1)!;ws.open();ws.onclose({code:4009});assert.match(a.status.at(-1)!,/ANOTHER TAB/);assert.equal((a.c as any).reconnect,null)
 await a.c.start();assert.equal(a.sockets.length,3);a.c.dispose()
})
test('dispose while authentication is pending cannot open a socket',async()=>{
 let resolve!:(r:Response)=>void,sockets=0;const c=new RealtimeConnection(pose,{origin:'https://game.test',fetch:()=>new Promise(r=>{resolve=r}),socket:()=>{sockets++;return new Socket() as any},status:()=>{},message:()=>{}})
 const start=c.start();c.dispose();resolve(Response.json({enabled:false}));await start;assert.equal(sockets,0)
})
test('cell admission enforces publisher and watcher limits and rejects old epochs',async()=>{
 const cell=new GeoCell({waitUntil:()=>{}} as any,{PLAYERS:{get:()=>({fetch:async()=>new Response('ok')}),idFromName:(s:string)=>s}} as any)
 const request=(path:string,body:unknown)=>cell.fetch(new Request('https://cell'+path,{method:'POST',body:JSON.stringify(body)}))
 for(let i=0;i<CELL_PLAYERS;i++)assert.equal((await request('/publish',{...pose,id:String(i),epoch:2,seq:2,at:Date.now()})).status,200)
 assert.equal((await request('/publish',{...pose,id:'overflow',epoch:2,seq:2,at:Date.now()})).status,429)
 await request('/remove',{id:'0',epoch:1});assert.equal((await request('/publish',{...pose,id:'overflow',epoch:2,seq:2,at:Date.now()})).status,429)
 await request('/remove',{id:'0',epoch:2});assert.equal((await request('/publish',{...pose,id:'overflow',epoch:2,seq:2,at:Date.now()})).status,200)
 for(let i=0;i<CELLS_WATCHERS;i++)assert.equal((await request('/watch',{id:String(i),epoch:2,lat:50,lon:50})).status,200)
 assert.equal((await request('/watch',{id:'overflow',epoch:2,lat:50,lon:50})).status,429)
})
test('static hosts stay local without retry; service outages back off',async()=>{
 for(const status of [404,503,200]){
  const messages:string[]=[],c=new RealtimeConnection(pose,{origin:'https://game.test',fetch:async()=>new Response('<html>game</html>',{status,headers:{'Content-Type':'text/html'}}),socket:()=>{throw Error('Should not connect')},status:m=>messages.push(m),message:()=>{}})
  await c.start();assert.equal(Boolean((c as any).reconnect),status===503);assert.match(messages.at(-1)!,status===503?/RECONNECTING/:/LOCAL/);c.dispose()
 }
})
