import {car,advanceCar,freightPosition,validFreightInput,type FreightView} from '../shared/economy'
import {distance} from '../shared/multiplayer'
import {HttpError} from './security'
import {settleFreight,type EconomyEnv} from './economy'
/** Private per-shipment authority. No client position or completion message is accepted. */
export class Freight {
 constructor(private ctx:DurableObjectState,private env:EconomyEnv){}
 async fetch(request:Request){return this.ctx.blockConcurrencyWhile(async()=>{try{return await this.handle(request)}catch(e){return Response.json({error:e instanceof HttpError?e.message:'Freight service unavailable; retry safely'},{status:e instanceof HttpError?e.status:503})}})}
 private async load(id:string){
  const row=await this.env.DB.prepare('SELECT s.*,q.route FROM shipments s JOIN freight_quotes q ON q.id=s.quote_id WHERE s.id=?').bind(id).first<any>();if(!row)throw new HttpError(404,'Shipment not found')
  let v=await this.ctx.storage.get<FreightView>('run')
  if(!v){v={...row,course:JSON.parse(row.route),driver:car(Date.now()),attacker:null,lock:0};await this.ctx.storage.put('run',v);await this.ctx.storage.setAlarm(row.expires_at)}
  if(v!.id!==id)throw new HttpError(409,'Shipment actor mismatch')
  v!.status=row.status
  if(v!.status==='active'&&Date.now()>=v!.expires_at){v=await this.finish(v!,v!.driver.s>v!.course.total*.25?'lost':'cancelled',v!.player_id)}
  return v!
 }
 private async finish(v:FreightView,outcome:'delivered'|'lost'|'cancelled',actor:string){const row=await settleFreight(this.env.DB,v.id,outcome,actor);v.status=row.status;await this.ctx.storage.put('run',v);return v}
 private async handle(request:Request){
  const b=await request.json() as any,path=new URL(request.url).pathname,v=await this.load(b.id),now=Date.now()
  if(path==='/view')return Response.json(v)
  if(path==='/cancel'){if(b.player!==v.player_id)throw new HttpError(403,'Not your shipment');if(v.status==='active')await this.finish(v,v.driver.s>v.course.total*.25?'lost':'cancelled',b.player);return Response.json(v)}
  if(path==='/intercept'){
   let receipt=await this.env.DB.prepare('SELECT * FROM freight_intercepts WHERE shipment_id=?').bind(v.id).first<any>()
   if(receipt&&receipt.player_id!==b.player)throw new HttpError(409,'Shipment already challenged')
   if(v.attacker?.id===b.player)return Response.json(v)
   if(!receipt){
    if(v.status!=='active'||!v.competitive||v.driver.s<v.course.total*.25||v.driver.s>v.course.total*.85)throw new HttpError(409,'Interception window is 25–85% of an opted-in route')
    if(!b.position||distance(b.position,freightPosition(v.course,v.driver))>200)throw new HttpError(409,'Get within 200 metres of the convoy')
    const member=await this.env.DB.prepare('SELECT crew_id,membership FROM crew_members WHERE player_id=?').bind(b.player).first<any>();if(!member)throw new HttpError(409,'Crew membership required')
    try{await this.env.DB.prepare('INSERT INTO freight_intercepts VALUES(?,?,?,?,?,?)').bind(v.id,b.player,member.crew_id,member.membership,now,Math.max(0,v.driver.s-60)).run()}catch{throw new HttpError(409,'Interception denied: rival crew, 25 HG, no active run and two-per-day allowance required')}
    receipt=await this.env.DB.prepare('SELECT * FROM freight_intercepts WHERE shipment_id=?').bind(v.id).first<any>()
   }
   v.attacker={id:b.player,crew:receipt.crew_id,membership:receipt.membership,car:car(now,receipt.start_s)};await this.ctx.storage.put('run',v);return Response.json(v)
  }
  if(path!=='/input'||!validFreightInput(b.input))throw new HttpError(400,'Invalid freight input')
  const driver=b.player===v.player_id,vehicle=driver?v.driver:v.attacker&&v.attacker.id===b.player?v.attacker.car:null
  if(!vehicle)throw new HttpError(403,'Not a freight participant')
  if(v.status!=='active')return Response.json(v)
  if(b.input.seq<=vehicle.seq)return Response.json(v)
  if(b.input.seq>vehicle.seq+1000000&&vehicle.seq>=0)throw new HttpError(400,'Invalid input sequence')
  const dt=Math.min(.3,Math.max(0,(now-vehicle.at)/1000));advanceCar(v.course,vehicle,now);vehicle.seq=b.input.seq;vehicle.throttle=b.input.throttle;vehicle.steer=b.input.steer
  if(v.driver.damage>=3)await this.finish(v,'lost',v.player_id)
  else if(v.driver.s>=v.course.total)await this.finish(v,'delivered',v.player_id)
  else if(v.attacker&&v.attacker.car.damage<3){
   // Both inputs must be fresh, and current rival memberships must still match admission.
   const close=now-v.driver.at<700&&now-v.attacker.car.at<700&&Math.abs(v.driver.s-v.attacker.car.s)<12&&Math.abs(v.driver.lane-v.attacker.car.lane)<1.5
   if(!driver)v.lock=close?v.lock+dt:0
   if(v.lock>=3){const valid=await this.env.DB.prepare('SELECT 1 FROM crew_members a JOIN crew_members d ON d.player_id=? WHERE a.player_id=? AND a.membership=? AND a.crew_id=? AND d.membership=? AND d.crew_id=? AND a.crew_id!=d.crew_id').bind(v.player_id,v.attacker.id,v.attacker.membership,v.attacker.crew,v.membership,v.crew_id).first();if(valid)await this.finish(v,'lost',v.attacker.id);else v.lock=0}
  }
  await this.ctx.storage.put('run',v);return Response.json(v)
 }
 async alarm(){await this.ctx.blockConcurrencyWhile(async()=>{const v=await this.ctx.storage.get<FreightView>('run');if(v)await this.load(v.id)})}
}
