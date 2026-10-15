import {propertyId,requestId,type PropertyView,type PropertyQuote,type PurchaseReceipt} from '../shared/properties'
import {wrapLon,type Geo} from '../shared/multiplayer'
interface Pending {playerId:string;requestId:string;quoteId:string}
export class PropertyError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status}}
/** Separate from legacy save data. Journal the exact request before any network purchase. */
export class GlobalProperties {
 enabled=false;playerId:string|null=null;balance=0;selected:PropertyView|null=null;quote:PropertyQuote|null=null
 nearby:PropertyView[]=[];items:PropertyView[]=[];next:string|null=null;busy=false;status='Global properties require a configured game host.'
 private point:Geo|null=null;private running=false;private lastArea=0;private lastItem=0;private disposed=false
 private timer:ReturnType<typeof setInterval>|null=null;private fetcher:typeof fetch
 private changed=()=>{this.lastArea=0;this.lastItem=0;void this.poll()}
 private storage:Storage;private onChange:()=>void
 constructor(storage:Storage,onChange=()=>{},transport:typeof fetch=fetch){this.storage=storage;this.onChange=onChange;this.fetcher=transport.bind(globalThis)}
 private async api(path:string,body?:unknown){
  const res=await this.fetcher('/api/properties/'+path,{credentials:'same-origin',signal:AbortSignal.timeout(15000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})})
  let data:any;try{data=await res.json()}catch{throw new PropertyError(res.status,'Global properties unavailable on this host')}
  if(!res.ok)throw new PropertyError(res.status,data.error||'Property request failed');return data
 }
 async activate(){
  try{
   this.enabled=(await this.api('status')).enabled===true;if(!this.enabled){this.status='Global properties are disabled. Local progress stays on this device.';return}
   const me=await this.fetcher('/api/me',{credentials:'same-origin',signal:AbortSignal.timeout(8000)});if(!me.ok){this.playerId=null;throw new PropertyError(me.status,'Sign in to inspect global properties')}
   const id=(await me.json()).playerId;if(this.playerId&&this.playerId!==id){this.items=[];this.nearby=[];this.selected=null;this.quote=null;this.next=null}this.playerId=id;await this.wallet();this.status='Global registry connected.'
   if(!this.timer&&!this.disposed){this.timer=setInterval(()=>void this.poll(),1000);window.addEventListener('hoverghini:property-changed',this.changed)}
  }catch(e){this.status=e instanceof Error?e.message:'Global properties unavailable'}finally{this.onChange()}
 }
 private async wallet(){const res=await this.fetcher('/api/wallet',{credentials:'same-origin',signal:AbortSignal.timeout(8000)});if(res.ok){const data=await res.json();if(data.playerId===this.playerId)this.balance=data.balance}}
 setLocation(point:Geo|null){this.point=point?{lat:point.lat,lon:wrapLon(point.lon)}:null}
 get pending():Pending|null{if(!this.playerId)return null;try{const value=JSON.parse(this.storage.getItem('hoverghini.property.pending:'+this.playerId)||'null');return value?.playerId===this.playerId&&requestId(value.requestId)&&requestId(value.quoteId)?value:null}catch{return null}}
 private async action(fn:()=>Promise<void>){if(this.busy)return;this.busy=true;this.onChange();try{await fn()}catch(e){this.status=e instanceof Error?e.message:'Property service unavailable'}finally{this.busy=false;this.onChange()}}
 async inspect(point:Geo){await this.action(async()=>{this.selected=null;this.quote=null;this.status='Checking the OSM building and global title…';this.onChange();const data=await this.api('inspect',{lat:point.lat,lon:wrapLon(point.lon)});this.playerId=data.playerId;this.selected=data.property;this.quote=data.quote;await this.wallet();this.status='Title checked against the global registry.'})}
 async select(id:string){if(!propertyId(id))return;await this.action(async()=>{const data=await this.api('item?id='+encodeURIComponent(id));this.playerId=data.playerId;this.selected=data.property;this.quote=null;this.status='Current global title.'})}
 async requote(){const selected=this.selected;if(!selected)return;await this.action(async()=>{const data=await this.api('quote',{id:selected.id});this.playerId=data.playerId;this.selected=data.property;this.quote=data.quote;await this.wallet();this.status='Fresh server price and title checked.'})}
 async loadPortfolio(more=false){await this.action(async()=>{if(!this.playerId)await this.activate();if(!this.playerId)return;const data=await this.api('portfolio'+(more&&this.next?'?cursor='+encodeURIComponent(this.next):''));this.items=more?[...this.items,...data.items]:data.items;this.next=data.next;await this.wallet();this.status='Portfolio loaded from the global registry.'})}
 async buy(){await this.action(async()=>{
  if(!this.playerId||!this.quote||this.quote.playerId!==this.playerId)throw Error('Get a fresh quote while signed in.')
  if(this.pending)throw Error('Resolve the pending purchase before starting another.')
  const pending={playerId:this.playerId,quoteId:this.quote.id,requestId:crypto.randomUUID()}
  this.storage.setItem('hoverghini.property.pending:'+this.playerId,JSON.stringify(pending))
  await this.submit(pending)
 })}
 async retry(){await this.action(async()=>{const pending=this.pending;if(!pending)throw Error('No pending purchase for this account');await this.submit(pending)})}
 private async submit(pending:Pending){
  try{
   const me=await this.fetcher('/api/me',{credentials:'same-origin',signal:AbortSignal.timeout(8000)});if(!me.ok||(await me.json()).playerId!==pending.playerId)throw new PropertyError(401,'Sign back into the original account to recover this purchase.')
   const data=await this.api('purchase',pending),receipt=data.receipt as PurchaseReceipt
   if(receipt.playerId!==pending.playerId||receipt.requestId!==pending.requestId)throw Error('Purchase response mismatch; retry the saved request.')
   this.storage.removeItem('hoverghini.property.pending:'+pending.playerId);this.selected=data.property;this.quote=null;this.balance=receipt.balance;this.status='Purchase recorded. This title is yours worldwide.';this.lastArea=0;await this.wallet().catch(()=>{})
  }catch(e){
   if(e instanceof PropertyError&&[400,409].includes(e.status))this.storage.removeItem('hoverghini.property.pending:'+pending.playerId)
   throw e
  }
 }
 private async poll(){
  if(this.running||this.disposed||!this.enabled||!this.playerId||document.hidden)return
  this.running=true
  try{
   if(this.selected&&Date.now()-this.lastItem>5000){this.lastItem=Date.now();const id=this.selected.id,data=await this.api('item?id='+encodeURIComponent(id));if(this.selected?.id===id){if(data.property.revision!==this.selected.revision)this.quote=null;this.selected=data.property;this.onChange()}}
   if(this.point&&Date.now()-this.lastArea>10000){this.lastArea=Date.now();const point={...this.point},items:PropertyView[]=[];let cursor=''
    for(let page=0;page<5;page++){const data=await this.api(`area?lat=${point.lat}&lon=${point.lon}&cursor=${encodeURIComponent(cursor)}`);items.push(...data.items);if(!data.next)break;cursor=data.next}
    this.nearby=items
   }
  }catch(e){if(e instanceof PropertyError&&e.status===401){this.playerId=null;this.nearby=[];this.quote=null}this.status='Ownership refresh unavailable. Purchases always recheck the server.'}
  finally{this.running=false}
 }
 dispose(){this.disposed=true;if(this.timer)clearInterval(this.timer);window.removeEventListener('hoverghini:property-changed',this.changed)}
}
