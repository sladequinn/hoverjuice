import {MISSIONS} from '../shared/street'
import {freightQuote,type EconomyEnv} from './economy'
import {HttpError} from './security'
export async function courierQuote(env:EconomyEnv,player:string,b:any){
 if(!b||Object.keys(b).sort().join(',')!=='destination,mission,origin')throw new HttpError(400,'Invalid courier request')
 const mission=MISSIONS.find(m=>m.id===b.mission);if(!mission)throw new HttpError(400,'Unknown courier mission')
 const q=await freightQuote(env,player,{origin:b.origin,destination:b.destination,commodity:mission.commodity,competitive:false})
 const gross=Math.min(20000,Math.round(q.gross*mission.multiplier)),fee=Math.ceil(gross*.12),duration=Math.max(60000,Math.min(900000,Math.ceil(q.route.total/mission.pace+mission.grace)*1000))
 await env.DB.batch([
  env.DB.prepare('UPDATE freight_quotes SET gross=?,fee=? WHERE id=?').bind(gross,fee,q.id),
  env.DB.prepare('INSERT INTO courier_quotes VALUES(?,?,?)').bind(q.id,mission.id,duration)
 ])
 return {...q,gross,fee,net:gross-fee,mission:mission.id,client:mission.client,label:mission.name,duration}
}
