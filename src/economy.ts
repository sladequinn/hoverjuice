import {advanceCar,freightPosition,gateLane,type FreightView,type FreightCar,type MarketRow} from '../shared/economy'
import {districtFor} from '../shared/crews'
import {wrapLon,type Geo} from '../shared/multiplayer'
export class Economy {
 enabled=false;player='';balance=0;markets:MarketRow[]=[];shipments:any[]=[];history:any[]=[];active:FreightView|null=null;quote:any=null;status='Global freight is disabled';busy=false;pending=false;fund=0;district=''
 private location:Geo|null=null;private checked=false;private polling=false;private received=0;private seq=0;private predicted:FreightCar|null=null;private input={throttle:0,steer:0};private send:((v:unknown)=>void)|null=null;private nextPoll=0
 private storage:Storage;private changed:()=>void;private transport:typeof fetch;private timer:ReturnType<typeof setInterval>
 private event=(e:Event)=>this.snapshot((e as CustomEvent).detail)
 constructor(storage:Storage,changed:()=>void,transport:typeof fetch=fetch.bind(globalThis)){
  this.storage=storage;this.changed=changed;this.transport=transport
  window.addEventListener('hoverghini:freight',this.event)
  this.timer=setInterval(()=>{if(this.active?.status==='active'&&this.send&&!document.hidden)this.send({type:'freight-input',input:{seq:++this.seq,...this.input}});if(this.enabled&&this.location&&!document.hidden&&Date.now()>this.nextPoll&&!this.busy&&!this.polling){this.nextPoll=Date.now()+10000;void this.refresh()}},250)
 }
 dispose(){clearInterval(this.timer);window.removeEventListener('hoverghini:freight',this.event)}
 setLocation(p:Geo|null){this.location=p?{lat:p.lat,lon:wrapLon(p.lon)}:null;if(this.location)this.district=districtFor(this.location)}
 private async api(path:string,body?:unknown){const r=await this.transport('/api/economy/'+path,{credentials:'same-origin',signal:AbortSignal.timeout(18000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});let data:any;try{data=await r.json()}catch{throw Error('Economy service unavailable')};if(!r.ok)throw Object.assign(Error(data.error??'Freight request failed'),{status:r.status});return data}
 async activate(){if(this.checked)return;this.checked=true;try{this.enabled=(await this.api('status')).enabled;if(this.enabled)await this.refresh()}catch(e){this.status=(e as Error).message}this.changed()}
 async refresh(){if(this.polling)return;this.polling=true;try{
  const me=await this.api('me');if(me.player!==this.player){this.active=null;this.quote=null;this.predicted=null;this.player=me.player}
  this.balance=me.wallet?.balance??0;this.history=me.history;this.pending=!!this.storage.getItem('hoverghini.freight.pending:'+this.player)
  if(!this.active&&me.active){this.active=me.active;this.status='Saved freight found. Resume online to restore its controls.'}
  if(this.active&&!me.active&&this.active.status==='active'){this.active=null;this.predicted=null}
  if(this.district){const board=await this.api('board?district='+encodeURIComponent(this.district));this.markets=board.markets;this.shipments=board.shipments;this.fund=board.fund.available}
  if(!this.pending&&!me.active)this.status='Live freight board · choose a route'
 }catch(e){this.status=(e as Error).message}finally{this.polling=false;this.changed()}}
 private async action(fn:()=>Promise<void>){if(this.busy)return;this.busy=true;try{await fn()}catch(e){this.status=(e as Error).message}finally{this.busy=false;this.changed()}}
 async getQuote(destination:string,commodity:string,competitive:boolean){await this.action(async()=>{this.quote=await this.api('quote',{origin:this.district,destination,commodity,competitive});this.status='Quote ready. Follow the depot waypoint, then load the sealed cargo.'})}
 async courierQuote(destination:string,mission:string){await this.action(async()=>{this.quote=await this.api('courier/quote',{origin:this.district,destination,mission});this.status='Job reserved for quoting. Drive to the pickup depot, then load the package.'})}
 async start(){await this.action(async()=>{if(!this.quote||this.pending)throw Error('Get a quote or recover your pending load first');const me=await this.api('me');if(me.player!==this.player)throw Error('Account changed; refresh first');const b={playerId:this.player,quoteId:this.quote.id,requestId:crypto.randomUUID()};this.storage.setItem('hoverghini.freight.pending:'+this.player,JSON.stringify(b));this.pending=true;await this.submit(b)})}
 private async submit(b:any){try{this.attach(await this.api('start',b));this.storage.removeItem('hoverghini.freight.pending:'+this.player);this.pending=false;this.quote=null}catch(e){if([400,409].includes((e as any).status)){this.storage.removeItem('hoverghini.freight.pending:'+this.player);this.pending=false}throw e}}
 async retry(){await this.action(async()=>{const me=await this.api('me');if(me.player!==this.player)throw Error('Sign in to the original account to recover this load');const b=this.storage.getItem('hoverghini.freight.pending:'+this.player);if(b)await this.submit(JSON.parse(b))})}
 async resume(){await this.action(async()=>{if(this.active)this.attach(await this.api('resume',{id:this.active.id}))})}
 async intercept(id:string){await this.action(async()=>this.attach(await this.api('intercept',{id})))}
 async cancel(){await this.action(async()=>{if(this.active)this.attach(await this.api('cancel',{id:this.active.id}));await this.refresh()})}
 private attach(view:FreightView){this.active=view;this.predicted=null;this.snapshot(view);this.status=view.status==='active'?'Freight assist active: GO accelerates, BRAKE slows, steer into the indicated lane. Three missed gates destroy cargo.':`Shipment ${view.status}`}
 private snapshot(data:any){if(!this.active||data?.id!==this.active.id)return;this.active={...this.active,...data};const v=this.active!,vehicle=v.player_id===this.player?v.driver:v.attacker?.id===this.player?v.attacker.car:null;if(!vehicle)return
  const old=this.predicted;this.predicted={...vehicle,at:performance.now()};if(old&&Math.abs(old.s-vehicle.s)<25){this.predicted.s=old.s+(vehicle.s-old.s)*.4;this.predicted.lane=old.lane+(vehicle.lane-old.lane)*.4}this.seq=Math.max(this.seq,vehicle.seq);this.received=performance.now()
  if(v.status!=='active'){this.status=`Shipment ${v.status}${v.status==='delivered'?' · global payout settled':''}`;this.predicted=null;this.nextPoll=0;this.changed()}
 }
 step(throttle:number,steer:number,send:((v:unknown)=>void)|null){this.send=send;this.input={throttle,steer};if(!this.driving||!this.predicted)return null;const now=performance.now();if(now-this.received<500){this.predicted.throttle=throttle;this.predicted.steer=steer;advanceCar(this.active!.course,this.predicted,now)}return {...freightPosition(this.active!.course,this.predicted),speed:this.predicted.speed}}
 get driving(){return this.active?.status==='active'&&!!this.predicted}
 get target():Geo|null{if(this.active&&this.predicted){const v=this.predicted,c=this.active.course;return freightPosition(c,{...v,s:Math.min(c.total,v.gate*180),lane:gateLane(c,v.gate)})}return this.quote?.route.points[0]??null}
 get progress(){const v=this.predicted,c=this.active;if(!v||!c)return '';return `FREIGHT ${Math.round(v.s/c.course.total*100)}% · ${v.damage}/3 DAMAGE · ${gateLane(c.course,v.gate)>0?'RIGHT':'LEFT'} GATE · ${Math.max(0,Math.ceil((v.gate*180-v.s)))}m${performance.now()-this.received>1500?' · RECONNECT TO RESUME':''}`}
}
