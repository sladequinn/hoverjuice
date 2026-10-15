import {districtBounds,type Contest,type DistrictView,type Run} from '../shared/crews'
import {distance,type Presence} from '../shared/multiplayer'
import {sourceCell} from './property-geometry'
import {territoryCourse,routeDistance} from './territory-course'
import type {CrewsEnv} from './crews-http'
import {HttpError} from './security'
export function advanceRun(run:Run,p:Presence,c:Contest,now:number){
 if(c.finished||now<c.startsAt||now>=c.endsAt||p.at+1500<now||p.at>now+100||run.best!==null)return
 const last=run.last
 if(last&&(p.epoch<last.epoch||(p.epoch===last.epoch&&p.seq<=last.seq)))return
 const broken=last&&(p.epoch!==last.epoch||now-last.at>3000||distance(last,p)>Math.max(3,(now-last.at)*.09)||Math.abs(p.y-last.y)>10+(now-last.at)*.04)
 const corridor=run.next?routeDistance(p,c.course[Math.max(0,run.next-1)],c.course[Math.min(run.next,c.course.length-1)]):0
 if(broken||p.clearance>8||corridor>28){run.started=0;run.next=0;run.invalid='Run reset: stay near the road, below 8 m and under 90 m/s; connection gaps reset the attempt'}
 run.last={lat:p.lat,lon:p.lon,y:p.y,at:now,seq:p.seq,epoch:p.epoch}
 if(distance(p,c.course[run.next])>18)return
 if(run.next===0){if(run.attempts>=3)return;run.attempts++;run.started=now;run.invalid=''}
 run.next++
 if(run.next===c.course.length){
  const elapsed=now-run.started,length=c.course.slice(1).reduce((sum,p,i)=>sum+distance(c.course[i],p),0)
  if(elapsed>=length/90*1000){run.best=elapsed;run.invalid='Delivery completed'}else{run.invalid='Run too fast';run.next=0;run.started=0}
 }
}
/** One durable actor per versioned district. Only authenticated Worker and PlayerSession call it. */
export class Territory {
 constructor(private ctx:DurableObjectState,private env:CrewsEnv){}
 async fetch(request:Request){return this.ctx.blockConcurrencyWhile(async()=>{
  try{return await this.handle(request)}catch(e){if(!(e instanceof HttpError))console.error(JSON.stringify({event:'territory_failure'}));return Response.json({error:e instanceof HttpError?e.message:'Territory service unavailable'},{status:e instanceof HttpError?e.status:503})}
 })}
 private async eligible(player:string,center:{lat:number;lon:number}){
  const row=await this.env.DB.prepare("SELECT m.crew_id AS crew,m.membership,c.name,c.tag,c.color,p.id AS hq,p.lat,p.lon FROM crew_members m JOIN crews c ON c.id=m.crew_id JOIN global_properties p ON p.id=c.hq JOIN crew_members owner ON owner.player_id=p.owner_id AND owner.crew_id=c.id WHERE m.player_id=? AND c.active=1 AND p.status='active'").bind(player).first<any>()
  if(!row||distance(row,center)>15000)throw new HttpError(409,'A member-owned, active crew HQ within 15 km is required')
  return row
 }
 private async finish(c:Contest){
  if(c.finished||Date.now()<c.endsAt)return
  const eligible:Run[]=[],headquarters=new Map<string,string>()
  for(const r of c.runs)if(r.best!==null){try{const current=await this.eligible(r.player,districtBounds(c.district));if(current.crew===r.crew&&current.membership===r.membership){eligible.push(r);headquarters.set(r.crew,current.hq)}}catch(e){if(!(e instanceof HttpError))throw e}}
  const scores=[...new Set(eligible.map(r=>r.crew))].map(crew=>{const runs=eligible.filter(r=>r.crew===crew).sort((a,b)=>a.best!-b.best!);return {crew,hq:headquarters.get(crew),score:Math.round(runs[0].best!*(runs.length>1?.95:1)),drivers:runs.length,roster:runs.map(r=>({player:r.player,membership:r.membership}))}}).sort((a,b)=>a.score-b.score||a.crew.localeCompare(b.crew))
    // Durable result + control + reputation commit together. Retrying after a crash cannot reward twice.
  await this.env.DB.prepare(`INSERT INTO territory_results(contest_id,district,winner,scores,completed_at)
   SELECT ?,?,(SELECT json_extract(s.value,'$.crew') FROM json_each(?) s
    JOIN crews crew ON crew.id=json_extract(s.value,'$.crew') AND crew.active=1
    JOIN global_properties p ON p.id=crew.hq AND p.id=json_extract(s.value,'$.hq') AND p.status='active'
    JOIN crew_members owner ON owner.player_id=p.owner_id AND owner.crew_id=crew.id
    WHERE NOT EXISTS(SELECT 1 FROM json_each(s.value,'$.roster') r WHERE NOT EXISTS(
     SELECT 1 FROM crew_members m WHERE m.player_id=json_extract(r.value,'$.player') AND m.membership=json_extract(r.value,'$.membership') AND m.crew_id=crew.id))
    AND (SELECT count(*) FROM territory_control WHERE crew_id=crew.id AND expires_at>? AND district<>?)<3
    ORDER BY json_extract(s.value,'$.score'),crew.id LIMIT 1),?,? ON CONFLICT(contest_id) DO NOTHING`)
   .bind(c.id,c.district,JSON.stringify(scores),c.endsAt,c.district,JSON.stringify(scores),c.endsAt).run()
  const control=await this.env.DB.prepare('SELECT crew_id FROM territory_control WHERE contest_id=?').bind(c.id).first<any>()
  c.finished=true;c.winner=control?.crew_id??null;await this.ctx.storage.put('contest',c)
 }
 private async view(id:string,c:Contest|null):Promise<DistrictView>{
  const now=Date.now(),row=await this.env.DB.prepare('SELECT t.crew_id,c.name,c.tag,c.color,t.expires_at,t.protected_until,c.active FROM territory_control t LEFT JOIN crews c ON c.id=t.crew_id WHERE district=?').bind(id).first<any>()
  const center=districtBounds(id),b=center
  const headquarters=(await this.env.DB.prepare("SELECT c.id,c.name,c.tag,c.color,p.lat,p.lon FROM crews c JOIN global_properties p ON p.id=c.hq JOIN crew_members m ON m.player_id=p.owner_id AND m.crew_id=c.id WHERE c.active=1 AND p.status='active' AND p.lat>=? AND p.lat<? AND p.lon>=? AND p.lon<? LIMIT 50").bind(b.south,b.north,b.west,b.east).all()).results as any[]
  const active=row&&row.active&&row.expires_at>now
  return {id,controller:active?row.crew_id:null,name:active?row.name:null,tag:active?row.tag:null,color:active?row.color:null,expiresAt:row?.expires_at??0,protectedUntil:row?.protected_until??0,contest:c,headquarters}
 }
 private async handle(request:Request){
  const path=new URL(request.url).pathname,b=await request.json() as any,id=b.district;let center
  try{center=districtBounds(id)}catch{throw new HttpError(400,'Invalid district')}
  const stored=await this.ctx.storage.get<string>('district');if(stored&&stored!==id)throw new HttpError(409,'District mismatch')
  let c=await this.ctx.storage.get<Contest>('contest')??null
  if(c)await this.finish(c)
  if(path==='/view')return Response.json(await this.view(id,c))
  if(path==='/open'){
   await this.eligible(b.player,center)
   if(!b.position||distance(b.position,center)>1800)throw new HttpError(409,'Drive into the district to open a contest')
   if(c&&!c.finished)return Response.json(await this.view(id,c))
   const view=await this.view(id,c);if(view.protectedUntil>Date.now())throw new HttpError(409,'District is resting for 30 minutes after its last contest')
   const key=sourceCell(center),res=await this.env.PROPERTY_SOURCE.get(this.env.PROPERTY_SOURCE.idFromName(key)).fetch(`https://source/?cell=${key}`)
   if(!res.ok)throw new HttpError(503,'Road source unavailable; no contest started')
   let course;try{course=territoryCourse((await res.json() as any).data,center)}catch(e){throw new HttpError(409,(e as Error).message)}
   const now=Date.now();c={id:crypto.randomUUID(),district:id,startsAt:now+30000,closesAt:now+120000,endsAt:now+600000,course,runs:[],finished:false,winner:null}
   await this.ctx.storage.put({district:id,contest:c});await this.ctx.storage.setAlarm(c.endsAt)
  }else if(path==='/join'){
   if(!c||c.finished)throw new HttpError(409,'No active contest')
   const member=await this.eligible(b.player,center),existing=c.runs.find(r=>r.player===b.player)
   if(existing){if(existing.membership!==member.membership)throw new HttpError(409,'Membership changed; wait for the next contest')}
   else{
    if(Date.now()>c.closesAt||c.runs.length>=16||c.runs.filter(r=>r.crew===member.crew).length>=2)throw new HttpError(409,'Admission closed or the two-driver squad is full')
    if(!b.position||distance(b.position,center)>1800)throw new HttpError(409,'Drive into this district first')
    c.runs.push({player:b.player,crew:member.crew,membership:member.membership,name:b.name,attempts:0,next:0,started:0,best:null,last:null,invalid:''})
    await this.ctx.storage.put('contest',c)
   }
  }else if(path==='/move'){
   if(c&&!c.finished&&b.contest===c.id){const r=c.runs.find(r=>r.player===b.position.id);if(r){advanceRun(r,b.position,c,Date.now());await this.ctx.storage.put('contest',c)}}
   return Response.json({done:!c||c.finished||b.contest!==c.id})
  }else throw new HttpError(404,'Not found')
  return Response.json(await this.view(id,c))
 }
 async alarm(){await this.ctx.blockConcurrencyWhile(async()=>{const c=await this.ctx.storage.get<Contest>('contest');if(c)await this.finish(c)})}
}
