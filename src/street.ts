import {neighbours} from '../shared/economy'
import {starterState,type StreetState} from '../shared/street'
export class Street {
 player='';revision=0;state:StreetState=starterState();balance=0;ready=false;busy=false;pending=false;status='Loading your inventory…';rows:any[]=[];quote:any=null;district='';exchange:{lat:number;lon:number}|null=null
 scouts:{district:string;rows:any[];exchange:{lat:number;lon:number}}[]=[]
 private polling=false;private next=0
 private storage:Storage;private changed:()=>void;private transport:typeof fetch
 constructor(storage:Storage,changed:()=>void,transport:typeof fetch=fetch.bind(globalThis)){this.storage=storage;this.changed=changed;this.transport=transport}
 private key(){return 'hoverghini.street.pending:'+this.player}
 private async api(path:string,body?:unknown){const r=await this.transport('/api/economy/street/'+path,{credentials:'same-origin',signal:AbortSignal.timeout(15000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error??'Progression unavailable'),{status:r.status});return v}
 private apply(v:any){if(this.player&&this.player!==v.player)throw Error('Account changed. Reload to continue');this.player=v.player;this.revision=v.revision;this.state=v.state;this.balance=v.wallet.balance;this.ready=true;this.pending=!!this.storage.getItem(this.key())}
 async refresh(){if(this.polling)return;this.polling=true;try{this.apply(await this.api('me'));if(this.district){const b=await this.api('board?district='+encodeURIComponent(this.district));this.rows=b.rows;this.exchange=b.exchange}this.status=this.pending?'A pending command needs recovery.':'Account inventory synchronized'}catch(e){this.status=(e as Error).message}finally{this.polling=false;this.changed()}}
 tick(district:string){if(district!==this.district){this.district=district;this.scouts=[];this.rows=[];this.quote=null;this.exchange=null;this.next=0}if(Date.now()>this.next&&!this.busy){this.next=Date.now()+10000;void this.refresh()}}
 private async action(fn:()=>Promise<void>){if(this.busy)return;this.busy=true;try{await fn()}catch(e){this.status=(e as Error).message}finally{this.busy=false;this.changed()}}
 async scout(){await this.action(async()=>{this.scouts=await Promise.all(neighbours(this.district).map(d=>this.api('board?district='+encodeURIComponent(d))));this.status='Nearby prices loaded. Quotes may change before you arrive.'})}
 async getQuote(good:string,quantity:number,side:'buy'|'sell'){await this.action(async()=>{this.quote=await this.api('quote',{district:this.district,good,quantity,side});this.status='Review the price, then confirm the trade.'})}
 private async submit(path:string,body:any){try{this.apply(await this.api(path,body));this.storage.removeItem(this.key());this.pending=false;this.quote=null;this.status='Transaction complete';await this.refresh()}catch(e){if([400,403,409].includes((e as any).status)){this.storage.removeItem(this.key());this.pending=false;this.quote=null;await this.refresh()}throw e}}
 private async journal(path:string,fields:Record<string,unknown>){if(!this.ready||this.pending)throw Error('Refresh your account or recover the pending command first');const b={playerId:this.player,expectedRevision:this.revision,requestId:crypto.randomUUID(),...fields};this.storage.setItem(this.key(),JSON.stringify({path,body:b}));this.pending=true;await this.submit(path,b)}
 async trade(){await this.action(async()=>{if(!this.quote)throw Error('Request a fresh quote');await this.journal('trade',{quoteId:this.quote.id})})}
 async command(action:string,item:string){await this.action(()=>this.journal('command',{action,item}))}
 async retry(){await this.action(async()=>{const me=await this.api('me');if(me.player!==this.player)throw Error('Sign in to the original account');const raw=this.storage.getItem(this.key());if(raw){const p=JSON.parse(raw);await this.submit(p.path,p.body)}})}
}
