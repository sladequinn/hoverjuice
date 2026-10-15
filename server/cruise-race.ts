import {distance,validCourse,type Presence,type RaceView} from '../shared/multiplayer'
import type {MultiplayerEnv} from './multiplayer-http'
/** Casual checkpoint races only: no money, progression or globally ranked results. */
export class CruiseRace {
 private race:RaceView|null=null
 constructor(private ctx:DurableObjectState,private env:MultiplayerEnv){ctx.blockConcurrencyWhile(async()=>{this.race=await ctx.storage.get<RaceView>('race')??null})}
 private broadcast(){const race=this.race!;this.ctx.waitUntil(Promise.allSettled(race.racers.map(p=>this.env.PLAYERS.get(this.env.PLAYERS.idFromName(p.id)).fetch('https://player/race',{method:'POST',body:JSON.stringify({type:'race',race})}))).then(()=>{}))}
 async fetch(request:Request){return this.ctx.blockConcurrencyWhile(async()=>{
  const path=new URL(request.url).pathname,b=await request.json() as any,now=Date.now()
  if(path==='/create'){
   if(this.race||!validCourse(b.course,b.position))return new Response('Invalid race',{status:400})
   this.race={id:b.id,host:b.player,course:b.course,startsAt:0,expiresAt:now+3600000,status:'waiting',racers:[{id:b.player,name:b.name,checkpoint:0,finished:null}]}
   await this.ctx.storage.setAlarm(this.race.expiresAt)
  }else{
   const r=this.race
   if(!r||r.expiresAt<now)return new Response('Race expired',{status:404})
   if(path==='/join'){
    if(r.racers.some(p=>p.id===b.player))return Response.json(r)
    if(r.status!=='waiting'||r.racers.length>=8||distance(b.position,r.course[0])>250)return new Response('Join near the starting checkpoint before the race starts (8 racers maximum)',{status:409})
    r.racers.push({id:b.player,name:b.name,checkpoint:0,finished:null})
   }else if(path==='/start'){
    if(b.player!==r.host||r.status!=='waiting'||r.racers.length<2)return new Response('The host starts after at least two players join',{status:409})
    r.startsAt=now+5000;r.status='racing';r.expiresAt=now+15*60000;await this.ctx.storage.setAlarm(r.expiresAt)
   }else if(path==='/leave'){
    r.racers=r.racers.filter(p=>p.id!==b.player);if(r.host===b.player&&r.racers.length)r.host=r.racers[0].id
    if(!r.racers.length)r.status='finished'
   }else if(path==='/move'){
    const p=b as Presence,entry=r.racers.find(v=>v.id===p.id)
    if(r.status!=='racing'||now<r.startsAt||!entry||entry.finished!==null)return Response.json(r)
    if(distance(p,r.course[entry.checkpoint])>40)return Response.json(r)
    entry.checkpoint++
    if(entry.checkpoint===r.course.length)entry.finished=now-r.startsAt
    if(r.racers.every(v=>v.finished!==null))r.status='finished'
   }else return new Response('Not found',{status:404})
  }
  await this.ctx.storage.put('race',this.race);this.broadcast();return Response.json(this.race)
 })}
 async alarm(){if(this.race){this.race.status='finished';this.broadcast()}await this.ctx.storage.deleteAll();this.race=null}
}
