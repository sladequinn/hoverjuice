import {test} from 'node:test'
import assert from 'node:assert/strict'
import Room from '../server/rooms'
import api from '../server/api'
import {mercator,tileKey} from '../src/spatial'
function setup(roomId:string){
 const connections:any[]=[]
 const room=new Room({id:roomId,getConnections:()=>connections} as any)
 const connect=(id:string)=>{const c:any={id,state:{},sent:[],closed:false,setState(s:any){this.state=s},send(s:string){this.sent.push(JSON.parse(s))},close(){this.closed=true}};connections.push(c);room.onConnect(c,{request:new Request(`https://edge.test/?peer=${id}`)} as any);return c}
 return {room,connect}
}
const position=mercator(43.45,-80.49)
const sample={id:'driver',...position,y:1,rotY:0,laneIndex:1,velocity:20,maskId:'oni',chassisId:'neonic',boost:false,seq:0}
test('ambient rooms filter radius, duplicate sequence, spoofed identity and wrong shard',()=>{
 const {room,connect}=setup(tileKey(43.45,-80.49)),driver=connect('driver'),near=connect('near'),far=connect('far')
 room.onMessage(JSON.stringify({type:'view',...mercator(43.45,-80.48)}),near)
 room.onMessage(JSON.stringify({type:'view',...mercator(44.45,-80.49)}),far)
 room.onMessage(JSON.stringify(sample),driver);assert.equal(near.sent.length,1);assert.equal(far.sent.length,0)
 room.onMessage(JSON.stringify(sample),driver);assert.equal(near.sent.length,1)
 driver.state.last=0
 room.onMessage(JSON.stringify({...sample,id:'spoof',seq:1}),driver);assert.equal(near.sent.length,1)
 room.onMessage(JSON.stringify({...sample,...mercator(0,0),seq:2}),driver);assert.equal(near.sent.length,1)
})
test('crew peers receive telemetry across ambient boundaries',()=>{
 const {room,connect}=setup('crew_ironlungs'),driver=connect('driver'),crew=connect('crew')
 room.onMessage(JSON.stringify(sample),driver);assert.equal(crew.sent.length,1)
})
test('global gateway rejects writes and invalid tile coordinates',async()=>{
 const env:any={ALLOWED_ORIGIN:'https://hoverjuice.test'}
 const write=await api.fetch(new Request('https://api.test/api/ownership',{method:'POST'}),env)
 assert.equal(write.status,405)
 const invalid=await api.fetch(new Request('https://api.test/api/ownership?tile=14_99999_0'),env)
 assert.equal(invalid.status,400)
})
