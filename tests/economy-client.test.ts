import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Economy} from '../src/economy'
import {car,course} from '../shared/economy'
Object.assign(globalThis,{window:new EventTarget(),document:{hidden:false}})
class Memory {data=new Map<string,string>();fail=false;getItem(k:string){return this.data.get(k)??null}setItem(k:string,v:string){if(this.fail)throw Error('Storage unavailable');this.data.set(k,v)}removeItem(k:string){this.data.delete(k)}}
function fixture(){const storage=new Memory(),state={player:crypto.randomUUID(),lost:false,calls:[] as any[],receipts:new Map<string,any>(),enabled:true},quoteId=crypto.randomUUID(),view={id:crypto.randomUUID(),player_id:state.player,status:'active',course:course([{lat:43,lon:-80},{lat:43.004,lon:-80}],'test'),driver:car(Date.now()),attacker:null,lock:0,origin:'d1:1:1',destination:'d1:2:1',commodity:'glimmer',quantity:4,gross:2500,net:2200,fee:300,expires_at:Date.now()+900000,crew_id:null,membership:null,competitive:0}
 const transport=(async(path:any,opts:any)=>{if(path.endsWith('/status'))return Response.json({enabled:state.enabled});if(path.endsWith('/me'))return Response.json({player:state.player,active:null,history:[],wallet:{balance:0}});if(path.endsWith('/start')){const b=JSON.parse(opts.body);state.calls.push(b);state.receipts.set(b.requestId,b);if(state.lost){state.lost=false;throw Error('Lost response')}return Response.json(view)}return Response.json({})}) as typeof fetch
 const make=()=>new Economy(storage as any,()=>{},transport);return {storage,state,view,quoteId,make}}
test('freight journals before loading; lost-response retries preserve exact account-bound request',async()=>{
 const f=fixture(),client=f.make();try{await client.activate();client.quote={id:f.quoteId};f.state.lost=true;await client.start();assert.ok(client.pending);assert.equal(f.state.receipts.size,1);client.dispose();const re=f.make();try{await re.activate();await re.retry();assert.equal(f.state.receipts.size,1);assert.deepEqual(f.state.calls[0],f.state.calls[1]);assert.equal(re.pending,false);assert.ok(re.driving)}finally{re.dispose()}}finally{client.dispose()}
})
test('storage failure, account replacement and disabled backend prevent unintended loading',async()=>{
 const f=fixture(),client=f.make();try{await client.activate();client.quote={id:f.quoteId};f.storage.fail=true;await client.start();assert.equal(f.state.calls.length,0);f.storage.fail=false;f.state.lost=true;await client.start();f.state.player=crypto.randomUUID();await client.retry();assert.equal(f.state.calls.length,1);assert.ok(client.pending)}finally{client.dispose()}
 const g=fixture();g.state.enabled=false;const local=g.make();try{await local.activate();assert.equal(local.enabled,false);assert.equal(local.driving,false)}finally{local.dispose()}
})
