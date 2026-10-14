import {test} from 'node:test'
import assert from 'node:assert/strict'
import {CloudSave,LOCAL_BACKUP_KEY,LOCAL_SAVE_KEY} from '../src/cloud-save'
const sample={money:150,owned:['board'],current:'board',holdings:[],city:{name:'Kitchener',lat:43.45,lon:-80.49},masks:['balaclava'],mask:'balaclava'}
class MemoryStorage {
 data=new Map<string,string>();failKey=''
 getItem(key:string){return this.data.get(key)??null}
 setItem(key:string,value:string){if(key===this.failKey)throw new Error('Storage full');this.data.set(key,value)}
 removeItem(key:string){this.data.delete(key)}
}
function setup(){
 const storage=new MemoryStorage(),state={player:'p1',revision:0,payload:null as any,failAfterCommit:false,failRead:false,requests:[] as any[]}
 const receipts=new Map<string,{hash:string;revision:number}>()
 const transport=(async(path:any,options:any={})=>{
  if(state.failRead)throw new TypeError('Network unavailable')
  if(path==='/api/me')return Response.json({playerId:state.player})
  if(path==='/api/wallet')return Response.json({playerId:state.player,balance:0})
  if(path==='/api/save'&&options.method==='PUT'){
   const body=JSON.parse(options.body);state.requests.push(body)
   if(body.playerId!==state.player)return Response.json({error:'Wrong account'},{status:400})
   const old=receipts.get(body.requestId)
   if(old)return old.hash===options.body?Response.json({revision:old.revision}):Response.json({error:'Mismatch'},{status:409})
   if(body.expectedRevision!==state.revision)return Response.json({error:'Cloud save changed'},{status:409})
   state.revision++;state.payload=body.payload;receipts.set(body.requestId,{hash:options.body,revision:state.revision})
   if(state.failAfterCommit){state.failAfterCommit=false;throw new TypeError('Response lost')}
   return Response.json({revision:state.revision})
  }
  if(path==='/api/save')return Response.json({playerId:state.player,schemaVersion:1,mode:'legacy-local',revision:state.revision,payload:state.payload,updatedAt:Date.now()})
  return Response.json({ok:true})
 }) as typeof fetch
 return {storage,state,transport,client:new CloudSave(storage as any,transport)}
}
test('lost upload response persists exact outbox across reload and retries once',async()=>{
 const {client,storage,state,transport}=setup();storage.setItem(LOCAL_SAVE_KEY,JSON.stringify(sample))
 await client.refresh();state.failAfterCommit=true
 await assert.rejects(()=>client.upload(sample),/Response lost/)
 assert.ok(client.pending);assert.equal(state.revision,1)
 const reopened=new CloudSave(storage as any,transport);await reopened.refresh();await reopened.retry()
 assert.equal(state.revision,1);assert.equal(reopened.pending,false)
 assert.deepEqual(state.requests[0],state.requests[1]);assert.equal(JSON.parse(storage.getItem(LOCAL_SAVE_KEY)!).money,150)
})
test('conflict keeps local progress and pending request until explicitly discarded',async()=>{
 const {client,storage,state}=setup();storage.setItem(LOCAL_SAVE_KEY,JSON.stringify(sample));await client.refresh()
 state.revision=1;state.payload={...sample,money:500}
 await assert.rejects(()=>client.upload(sample),/Cloud save changed/)
 assert.ok(client.pending);assert.equal(JSON.parse(storage.getItem(LOCAL_SAVE_KEY)!).money,150)
 assert.equal(state.payload.money,500)
 client.discardPending();assert.equal(client.snapshot,null);assert.equal(client.pending,false)
 await client.refresh();await client.upload(sample);assert.equal(state.revision,2)
})
test('offline reads and quota failure cannot destroy local progress or send an unjournaled save',async()=>{
 const {client,storage,state}=setup();storage.setItem(LOCAL_SAVE_KEY,JSON.stringify(sample));await client.refresh()
 storage.failKey='hoverghini.cloud.pending.p1'
 await assert.rejects(()=>client.upload(sample),/Storage full/);assert.equal(state.requests.length,0)
 state.failRead=true;await assert.rejects(()=>client.refresh(),/Network unavailable/)
 assert.equal(JSON.parse(storage.getItem(LOCAL_SAVE_KEY)!).money,150)
})
test('restore backs up current progress; backup quota failure aborts replacement; local rollback works',async()=>{
 const {client,storage,state}=setup();storage.setItem(LOCAL_SAVE_KEY,JSON.stringify(sample));state.payload={...sample,money:500};state.revision=1;await client.refresh()
 storage.failKey=LOCAL_BACKUP_KEY;await assert.rejects(()=>client.restore(),/Storage full/)
 assert.equal(JSON.parse(storage.getItem(LOCAL_SAVE_KEY)!).money,150)
 storage.failKey='';await client.restore()
 assert.equal(JSON.parse(storage.getItem(LOCAL_BACKUP_KEY)!).money,150)
 assert.equal(JSON.parse(storage.getItem(LOCAL_SAVE_KEY)!).money,500)
 client.restoreLocalBackup();assert.equal(JSON.parse(storage.getItem(LOCAL_SAVE_KEY)!).money,150)
})
test('account changes and unseen cloud revisions require another explicit restore decision',async()=>{
 const {client,storage,state}=setup();storage.setItem(LOCAL_SAVE_KEY,JSON.stringify(sample));state.payload={...sample,money:500};await client.refresh()
 state.revision++;await assert.rejects(()=>client.restore(),/Cloud save changed/)
 state.player='p2';await assert.rejects(()=>client.restore(),/Cloud save changed/)
 assert.equal(JSON.parse(storage.getItem(LOCAL_SAVE_KEY)!).money,150)
})
test('pending upload cannot be replayed into a different signed-in account',async()=>{
 const {client,state}=setup();await client.refresh();state.failAfterCommit=true
 await assert.rejects(()=>client.upload(sample));state.player='p2'
 await assert.rejects(()=>client.retry(),/Account changed/)
 assert.equal(state.requests.length,1)
})
test('invalid cloud payload is rejected before restore',async()=>{
 const {client,storage,state}=setup();storage.setItem(LOCAL_SAVE_KEY,JSON.stringify(sample));state.payload={money:999}
 await assert.rejects(()=>client.refresh(),/Invalid cloud response/)
 assert.equal(JSON.parse(storage.getItem(LOCAL_SAVE_KEY)!).money,150)
})
test('login preflight permits anonymous accounts but keeps disabled/static hosts in the game',async()=>{
 const storage=new MemoryStorage()
 const anonymous=new CloudSave(storage as any,(async()=>Response.json({error:'Sign in required'},{status:401})) as typeof fetch)
 await anonymous.prepareLogin()
 const disabled=new CloudSave(storage as any,(async()=>Response.json({error:'Not enabled'},{status:503})) as typeof fetch)
 await assert.rejects(()=>disabled.prepareLogin(),/Not enabled/)
 const staticOnly=new CloudSave(storage as any,(async()=>new Response('<html>Not found</html>',{status:404})) as typeof fetch)
 await assert.rejects(()=>staticOnly.prepareLogin(),/unavailable on this host/)
})
