import {districtFor,type CrewView,type DistrictView} from '../shared/crews'
import {wrapLon,type Geo} from '../shared/multiplayer'
export class Crews {
 enabled=false;player='';crew:CrewView|null=null;district:DistrictView|null=null;status='Crews require an enabled online host';busy=false;pending=false
 private location:Geo|null=null;private tracked='';private checked=false;private polling=false;private next=0
 private storage:Storage;private changed:()=>void;private transport:typeof fetch;private timer:ReturnType<typeof setInterval>
 constructor(storage:Storage,changed:()=>void,transport:typeof fetch=fetch.bind(globalThis)){
  this.storage=storage;this.changed=changed;this.transport=transport
  this.timer=setInterval(()=>{if(this.enabled&&this.location&&!document.hidden&&Date.now()>this.next&&!this.busy&&!this.polling){this.next=Date.now()+5000;void this.refresh()}},1000)
 }
 dispose(){clearInterval(this.timer)}
 setLocation(p:Geo|null){this.location=p?{lat:p.lat,lon:wrapLon(p.lon)}:null}
 private async api(path:string,body?:unknown){const r=await this.transport('/api/crews/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let data:any;try{data=await r.json()}catch{throw new Error('Crew service unavailable')};if(!r.ok)throw Object.assign(new Error(data.error??'Crew request failed'),{status:r.status});return data}
 async activate(){if(this.checked)return;this.checked=true;try{const s=await this.api('status');this.enabled=s.enabled;if(s.enabled)await this.refresh()}catch{this.status='Crews unavailable; local driving is unaffected'}this.changed()}
 async refresh(){if(this.polling)return;this.polling=true;try{
  const account=await this.api('me');if(this.player!==account.player){this.player=account.player;this.district=null;this.tracked=this.storage.getItem('hoverghini.contest:'+this.player)??''}
  this.crew=account.crew;this.pending=!!this.storage.getItem('hoverghini.crew.pending:'+this.player)
  const id=this.tracked||(this.location?districtFor(this.location):'');if(id)this.district=await this.api('district?id='+encodeURIComponent(id))
  this.status=this.pending?'An unconfirmed crew command can be retried safely':'Global crew state synchronized'
 }catch(e){this.status=(e as Error).message}finally{this.polling=false;this.changed()}}
 async command(body:Record<string,unknown>){if(this.busy||this.pending)return;this.busy=true;try{
  const me=await this.api('me');if(me.player!==this.player)throw new Error('Account changed; refresh before changing your crew')
  const b={...body,playerId:this.player,requestId:crypto.randomUUID()};this.storage.setItem('hoverghini.crew.pending:'+this.player,JSON.stringify(b));this.pending=true;await this.submit(b)
 }catch(e){this.status=(e as Error).message}finally{this.busy=false;this.changed()}}
 private async submit(b:any){try{await this.api('command',b);this.storage.removeItem('hoverghini.crew.pending:'+this.player);this.pending=false;await this.refresh()}catch(e){if([400,409].includes((e as any).status)){this.storage.removeItem('hoverghini.crew.pending:'+this.player);this.pending=false}throw e}}
 async retry(){if(this.busy)return;this.busy=true;try{const me=await this.api('me');if(me.player!==this.player)throw new Error('Sign in to the original account before retrying');const raw=this.storage.getItem('hoverghini.crew.pending:'+this.player);if(raw)await this.submit(JSON.parse(raw))}catch(e){this.status=(e as Error).message}finally{this.busy=false;this.changed()}}
 async contest(action:'open'|'join'){if(this.busy||!this.district)return;this.busy=true;try{this.district=await this.api('contest',{action,district:this.district.id});if(action==='join'){this.tracked=this.district!.id;this.storage.setItem('hoverghini.contest:'+this.player,this.tracked)}this.status=action==='join'?'Joined: follow the numbered road delivery gates on your map':'Contest opened: drivers have two minutes to join'}catch(e){this.status=(e as Error).message}finally{this.busy=false;this.changed()}}
 current(){this.tracked='';if(this.player)this.storage.removeItem('hoverghini.contest:'+this.player);void this.refresh()}
 get target(){const c=this.district?.contest,r=c?.runs.find(r=>r.player===this.player);return c&&!c.finished&&r&&r.best===null?c.course[r.next]:null}
}
