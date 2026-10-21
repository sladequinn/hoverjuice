import {test} from 'node:test'
import assert from 'node:assert/strict'
import {OnlineSession} from '../src/online-session'
import {CloudSave,LOCAL_SAVE_KEY} from '../src/cloud-save'
const sample={money:150,owned:['board'],current:'board',holdings:[],city:null,masks:['balaclava'],mask:'balaclava'}
class StorageMock {data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null}setItem(k:string,v:string){this.data.set(k,v)}removeItem(k:string){this.data.delete(k)}}
function setup(){
 const storage=new StorageMock(),state={player:'p1',offline:false,signedOut:false,revision:0,payload:null as any,lost:false,requests:[] as any[]},receipts=new Set<string>()
 const fetcher=(async(path:any,options:any={})=>{
  if(state.offline)throw new TypeError('Offline')
  if(state.signedOut)return Response.json({error:'Sign in required'},{status:401})
  if(path==='/api/me')return Response.json({playerId:state.player,displayName:'Driver',providers:['google']})
  if(path==='/api/wallet')return Response.json({playerId:state.player,balance:0})
  if(path==='/api/save'&&options.method==='PUT'){
   const body=JSON.parse(options.body);state.requests.push(body)
   if(receipts.has(body.requestId))return Response.json({revision:state.revision})
   if(body.expectedRevision!==state.revision)return Response.json({error:'Conflict'},{status:409})
   state.revision++;state.payload=body.payload;receipts.add(body.requestId)
   if(state.lost){state.lost=false;throw Error('Lost response')}
   return Response.json({revision:state.revision})
  }
  if(path==='/api/save')return Response.json({playerId:state.player,mode:'legacy-local',schemaVersion:1,revision:state.revision,payload:state.payload,updatedAt:1})
  return Response.json({ok:true})
 }) as typeof fetch
 const cloud=new CloudSave(storage as any,fetcher),session=new OnlineSession(cloud,fetcher)
 return {storage,state,cloud,session,fetcher}
}
test('online admission requires account and server; never imports local progress',async()=>{
 const a=setup();a.storage.setItem(LOCAL_SAVE_KEY,JSON.stringify({...sample,money:9999999}))
 a.state.signedOut=true;await a.session.start();assert.equal(a.session.ready,false)
 a.state.signedOut=false;a.state.offline=true;await a.session.start();assert.equal(a.session.ready,false)
 a.state.offline=false;await a.session.start();assert.equal(a.session.ready,true);assert.equal(a.cloud.snapshot?.payload,null);assert.equal(a.state.requests.length,0)
 assert.equal(JSON.parse(a.storage.getItem(LOCAL_SAVE_KEY)!).money,9999999)
})
test('automatic writes serialize, survive response loss and restore across devices',async()=>{
 const a=setup();await a.session.start();a.state.lost=true;a.session.save(sample);await a.session.flush()
 assert.equal(a.session.ready,false);assert.equal(a.cloud.pending,true)
 await a.session.heartbeat();assert.equal(a.session.ready,true);assert.equal(a.state.revision,1);assert.deepEqual(a.state.requests[0],a.state.requests[1])
 a.session.save({...sample,money:200});await Promise.all([a.session.flush(),a.session.flush()]);assert.equal(a.state.revision,2)
 const other=new OnlineSession(new CloudSave(new StorageMock() as any,a.fetcher),a.fetcher);await other.start();assert.equal(other.cloud.snapshot?.payload?.money,200)
})
test('disconnect, expired sessions and account changes stop play and unsafe writes',async()=>{
 const a=setup();await a.session.start();a.state.offline=true;await a.session.heartbeat();assert.equal(a.session.ready,false)
 a.session.save(sample);assert.equal(a.state.requests.length,0)
 a.state.offline=false;await a.session.heartbeat();assert.equal(a.session.ready,true)
 a.state.player='p2';a.session.save(sample);await a.session.flush();assert.equal(a.session.ready,false);assert.equal(a.session.conflict,true);assert.equal(a.state.requests.length,0)
 const b=setup();await b.session.start();b.state.signedOut=true;await b.session.heartbeat();assert.equal(b.session.ready,false);assert.equal(b.session.signedOut,true)
})
test('conflicting device progress is never overwritten, including reload retry',async()=>{
 const a=setup();await a.session.start();a.state.revision=1;a.state.payload={...sample,money:500};a.session.save(sample);await a.session.flush()
 assert.equal(a.session.conflict,true);assert.equal(a.session.ready,false);assert.equal(a.state.payload.money,500)
 const reloaded=new OnlineSession(new CloudSave(a.storage as any,a.fetcher),a.fetcher);await reloaded.start()
 assert.equal(reloaded.ready,false);assert.equal(reloaded.conflict,true);assert.equal(a.state.payload.money,500)
})
