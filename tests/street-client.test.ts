import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Street} from '../src/street'
import {starterState} from '../shared/street'
class Memory {data=new Map<string,string>();fail=false;getItem(k:string){return this.data.get(k)??null}setItem(k:string,v:string){if(this.fail)throw Error('Storage full');this.data.set(k,v)}removeItem(k:string){this.data.delete(k)}}
function fixture(){
 const storage=new Memory(),state={player:'p1',revision:0,state:starterState(),wallet:{balance:250000}},requests:any[]=[],receipts=new Set<string>();let lost=false
 const fetcher=(async(path:any,opt:any={})=>{
  if(String(path).endsWith('/me'))return Response.json(state)
  const b=JSON.parse(opt.body);requests.push(b)
  if(b.playerId!==state.player)return Response.json({error:'Wrong account'},{status:400})
  if(!receipts.has(b.requestId)){
   if(b.expectedRevision!==state.revision)return Response.json({error:'Account changed'},{status:409})
   state.revision++;state.state.vehicles.push('neonic');state.wallet.balance-=250000;receipts.add(b.requestId)
  }
  if(lost){lost=false;throw Error('Lost response')}
  return Response.json(state)
 }) as typeof fetch
 return {storage,state,requests,fetcher,lose(){lost=true},client:new Street(storage as any,()=>{},fetcher)}
}
test('garage outbox survives lost response and exactly retries across client reload',async()=>{
 const f=fixture();await f.client.refresh();f.lose();await f.client.command('buy-vehicle','neonic')
 assert.equal(f.client.pending,true);assert.equal(f.state.wallet.balance,0)
 const reopened=new Street(f.storage as any,()=>{},f.fetcher);await reopened.refresh();await reopened.retry()
 assert.equal(reopened.pending,false);assert.equal(f.state.revision,1);assert.deepEqual(f.requests[0],f.requests[1]);assert.equal(reopened.state.vehicles.filter(v=>v==='neonic').length,1)
 assert.deepEqual(Object.keys(f.requests[0]).sort(),['action','expectedRevision','item','playerId','requestId'])
})
test('storage failure cannot spend and original-account commands never replay into another account',async()=>{
 const f=fixture();await f.client.refresh();f.storage.fail=true;await f.client.command('buy-vehicle','neonic');assert.equal(f.requests.length,0)
 f.storage.fail=false;f.lose();await f.client.command('buy-vehicle','neonic');const count=f.requests.length;f.state.player='p2';await f.client.retry();assert.equal(f.requests.length,count);assert.equal(f.client.pending,true)
})
test('revision conflicts discard rejected commands and refresh authoritative inventory',async()=>{
 const f=fixture();await f.client.refresh();f.state.revision=5;await f.client.command('buy-vehicle','neonic');assert.equal(f.client.pending,false);assert.equal(f.client.revision,5);assert.equal(f.state.wallet.balance,250000)
})
