import {test} from 'node:test'
import assert from 'node:assert/strict'
import {GlobalProperties} from '../src/global-properties'
class MemoryStorage {data=new Map<string,string>();fail=false;getItem(k:string){return this.data.get(k)??null}setItem(k:string,v:string){if(this.fail)throw Error('Storage full');this.data.set(k,v)}removeItem(k:string){this.data.delete(k)}}
function setup(){
 const storage=new MemoryStorage(),player=crypto.randomUUID(),quoteId=crypto.randomUUID(),state={player,balance:1000000,failAfterCommit:false,purchases:[] as any[],receipts:new Map<string,any>(),code:0}
 const property={id:'osm:way:123',name:'Fixture',lat:43,lon:-80,priceMinor:500000,ownerId:null as string|null,ownerName:null,status:'active',revision:1,area:100,levels:1,sourceVersion:1,acquiredAt:null}
 const quote={id:quoteId,playerId:player,propertyId:property.id,priceMinor:property.priceMinor,revision:1,expiresAt:Date.now()+300000}
 const fetcher=(async(path:any,options:any={})=>{
  if(path==='/api/me')return Response.json({playerId:state.player})
  if(path==='/api/wallet')return Response.json({playerId:state.player,balance:state.balance})
  if(path==='/api/properties/inspect')return Response.json({playerId:state.player,property,quote})
  if(path==='/api/properties/purchase'){
   const body=JSON.parse(options.body);state.purchases.push(body)
   if(state.code)return Response.json({error:'Rejected'},{status:state.code})
   let receipt=state.receipts.get(body.requestId)
   if(!receipt){state.balance-=property.priceMinor;property.ownerId=state.player;property.revision++;receipt={...body,propertyId:property.id,priceMinor:property.priceMinor,balance:state.balance,walletVersion:1,createdAt:Date.now()};state.receipts.set(body.requestId,receipt)}
   if(state.failAfterCommit){state.failAfterCommit=false;throw Error('Response lost')}
   return Response.json({receipt,property})
  }
  return Response.json({enabled:false})
 }) as typeof fetch
 const client=new GlobalProperties(storage as any,()=>{},fetcher);return {storage,state,client,fetcher,property}
}
test('purchase journals before sending; lost response survives reload and retries exactly once',async()=>{
 const a=setup();await a.client.inspect({lat:43,lon:-80});a.state.failAfterCommit=true;await a.client.buy();assert.ok(a.client.pending);assert.equal(a.state.balance,500000)
 const restored=new GlobalProperties(a.storage as any,()=>{},a.fetcher);restored.playerId=a.state.player;await restored.retry()
 assert.equal(a.state.receipts.size,1);assert.deepEqual(a.state.purchases[0],a.state.purchases[1]);assert.equal(restored.pending,null);assert.equal(restored.selected?.ownerId,a.state.player);assert.equal(a.state.balance,500000)
})
test('quota/storage failure prevents unjournaled spending; server conflicts clear only failed request',async()=>{
 const a=setup();await a.client.inspect({lat:43,lon:-80});a.storage.fail=true;await a.client.buy();assert.equal(a.state.purchases.length,0);assert.match(a.client.status,/Storage full/)
 a.storage.fail=false;a.state.code=409;await a.client.buy();assert.equal(a.client.pending,null);assert.equal(a.state.balance,1000000)
})
test('account changes cannot replay another account purchase; outages retain recovery record',async()=>{
 const a=setup();await a.client.inspect({lat:43,lon:-80});a.state.code=503;await a.client.buy();const pending=a.client.pending;assert.ok(pending)
 const count=a.state.purchases.length;a.state.player=crypto.randomUUID();await a.client.retry();assert.equal(a.state.purchases.length,count);assert.deepEqual(a.client.pending,pending);assert.match(a.client.status,/original account/)
})
test('disabled backend stays optional and leaves local save untouched',async()=>{
 const a=setup();a.storage.setItem('hoverghini.save.v1','{"money":999999}');await a.client.activate();assert.equal(a.client.enabled,false);assert.equal(a.storage.getItem('hoverghini.save.v1'),'{"money":999999}');assert.equal(a.state.purchases.length,0)
})
