import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Crews} from '../src/crews'
class Memory {data=new Map<string,string>();fail=false;getItem(k:string){return this.data.get(k)??null}setItem(k:string,v:string){if(this.fail)throw Error('Storage full');this.data.set(k,v)}removeItem(k:string){this.data.delete(k)}}
function fixture(){const storage=new Memory(),state={player:crypto.randomUUID(),lost:false,calls:[] as any[],receipts:new Map<string,any>(),enabled:true};const client=new Crews(storage as any,()=>{},(async(path:any,opts:any)=>{
 if(path.endsWith('/status'))return Response.json({enabled:state.enabled})
 if(path.endsWith('/me'))return Response.json({player:state.player,crew:null})
 if(path.endsWith('/command')){const b=JSON.parse(opts.body);state.calls.push(b);state.receipts.set(b.requestId,b);if(state.lost){state.lost=false;throw Error('Lost response')}return Response.json({ok:true})}
 return Response.json({})
 }) as any);return {storage,state,client}}
test('crew outbox survives lost response and retries the same command exactly once',async()=>{
 const {client,state,storage}=fixture();try{await client.activate();state.lost=true;await client.command({action:'leave'});assert.ok(client.pending);assert.equal(storage.data.size,1);await client.retry();assert.equal(state.receipts.size,1);assert.deepEqual(state.calls[0],state.calls[1]);assert.equal(client.pending,false)}finally{client.dispose()}
})
test('storage failures and account switching prevent unsafe command submission; disabled host stays local',async()=>{
 const {client,state,storage}=fixture();try{await client.activate();storage.fail=true;await client.command({action:'leave'});assert.equal(state.calls.length,0);storage.fail=false;state.lost=true;await client.command({action:'leave'});state.player=crypto.randomUUID();await client.retry();assert.equal(state.calls.length,1);assert.ok(client.pending);await client.refresh();assert.equal(client.pending,false);assert.equal(storage.data.size,1)}finally{client.dispose()}
 const f=fixture();try{f.state.enabled=false;await f.client.activate();assert.equal(f.client.enabled,false);assert.equal(f.state.calls.length,0)}finally{f.client.dispose()}
})
