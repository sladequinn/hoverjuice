import {streetMe,streetBoard} from './street'
import {courierQuote} from './courier'
import {MISSIONS,exchange} from '../shared/street'
import {freightPosition} from '../shared/economy'
import {authenticate,type AuthEnv} from './auth'
import {HttpError,limit,readJson,sameOrigin} from './security'
import {marketBoard,freightQuote,type EconomyEnv} from './economy'
import {districtBounds} from '../shared/crews'
import {requestId} from '../shared/properties'
export interface EconomyHttpEnv extends EconomyEnv,AuthEnv {BACKEND_ENABLED?:string;MULTIPLAYER_ENABLED?:string;PROPERTIES_ENABLED?:string;CREWS_ENABLED?:string}
export async function economyHttp(request:Request,env:EconomyHttpEnv){
 const url=new URL(request.url),path=url.pathname,enabled=env.BACKEND_ENABLED==='true'&&env.MULTIPLAYER_ENABLED==='true'&&env.CREWS_ENABLED==='true'&&env.PROPERTIES_ENABLED==='true'&&env.ECONOMY_ENABLED==='true'
 if(path==='/api/economy/status'&&request.method==='GET')return Response.json({enabled})
 if(!enabled)throw new HttpError(503,'Global freight markets are not enabled')
 if(url.origin!==env.APP_ORIGIN||!env.APP_ORIGIN.startsWith('https://'))throw new HttpError(403,'Wrong origin')
 if(request.method!=='GET')sameOrigin(request,env.APP_ORIGIN)
 const player=await authenticate(request,env.DB);await limit(env.DB,'economy:'+player,90)
 if(path==='/api/economy/street/me'&&request.method==='GET')return Response.json(await streetMe(env.DB,player))
 if(path==='/api/economy/street/board'&&request.method==='GET'){
  const district=url.searchParams.get('district')??'';const rows=await streetBoard(env.DB,district)
  return Response.json({district,exchange:exchange(district),rows})
 }
 if(path==='/api/economy/courier/board'&&request.method==='GET')return Response.json({missions:MISSIONS})
 if(path==='/api/economy/courier/quote'&&request.method==='POST'){
  await limit(env.DB,'freight-quote:'+player,6);return Response.json(await courierQuote(env,player,await readJson(request)))
 }
 if(['/api/economy/street/quote','/api/economy/street/trade','/api/economy/street/command'].includes(path)&&request.method==='POST'){
  await limit(env.DB,'street-action:'+player,30)
  return env.PLAYERS.get(env.PLAYERS.idFromName(player)).fetch('https://player/street-'+path.split('/').at(-1),{method:'POST',body:JSON.stringify({player,body:await readJson(request)})})
 }
 if(path==='/api/economy/board'&&request.method==='GET'){
  const district=url.searchParams.get('district')!;try{districtBounds(district)}catch{throw new HttpError(400,'Invalid district')}
  const markets=await marketBoard(env.DB,district),member=await env.DB.prepare('SELECT crew_id FROM crew_members WHERE player_id=?').bind(player).first<any>()
  const shipments=(await env.DB.prepare('SELECT id,player_id,origin,destination,commodity,quantity,crew_id,expires_at FROM shipments WHERE (origin=? OR destination=?) AND status=\'active\' AND competitive=1 AND crew_id!=? AND expires_at>? LIMIT 8').bind(district,district,member?.crew_id??'',Date.now()).all()).results
  const convoys=await Promise.all(shipments.map(async(s:any)=>{try{const res=await env.FREIGHT.get(env.FREIGHT.idFromName(s.id)).fetch('https://freight/view',{method:'POST',body:JSON.stringify({id:s.id})});if(!res.ok)return s;const v=await res.json() as any;return {...s,status:v.status,position:freightPosition(v.course,v.driver),progress:v.driver.s/v.course.total}}catch{return s}}))
  return Response.json({player,markets,shipments:convoys.filter(s=>s.status==='active'),fund:await env.DB.prepare('SELECT available FROM freight_fund WHERE id=1').first()})
 }
 if(path==='/api/economy/me'&&request.method==='GET'){
  const rows=(await env.DB.prepare('SELECT id FROM shipments WHERE player_id=? AND status=\'active\' UNION SELECT i.shipment_id AS id FROM freight_intercepts i JOIN shipments s ON s.id=i.shipment_id WHERE i.player_id=? AND s.status=\'active\' LIMIT 1').bind(player,player).all()).results as any[]
  let active=null;if(rows[0]){const res=await env.FREIGHT.get(env.FREIGHT.idFromName(rows[0].id)).fetch('https://freight/view',{method:'POST',body:JSON.stringify({id:rows[0].id})});if(!res.ok)throw new HttpError(503,'Freight recovery unavailable');const view=await res.json() as any;if(view.status==='active')active=view}
  const history=(await env.DB.prepare('SELECT id,status,origin,destination,commodity,quantity,net,created_at FROM shipments WHERE player_id=? ORDER BY created_at DESC LIMIT 10').bind(player).all()).results
  return Response.json({player,active,history,wallet:await env.DB.prepare('SELECT balance FROM wallets WHERE player_id=?').bind(player).first()})
 }
 if(path==='/api/economy/quote'&&request.method==='POST'){await limit(env.DB,'freight-quote:'+player,6);return Response.json(await freightQuote(env,player,await readJson(request)))}
 if(path==='/api/economy/start'&&request.method==='POST'){
  await limit(env.DB,'freight-start:'+player,10);const body=await readJson(request);if(body?.playerId!==player)throw new HttpError(400,'Account changed')
  return env.PLAYERS.get(env.PLAYERS.idFromName(player)).fetch('https://player/freight-start',{method:'POST',body:JSON.stringify({player,body})})
 }
 if((path==='/api/economy/intercept'||path==='/api/economy/resume')&&request.method==='POST'){
  const b=await readJson(request);if(!b||Object.keys(b).join(',')!=='id'||!requestId(b.id))throw new HttpError(400,'Invalid shipment')
  await limit(env.DB,'freight-action:'+player,6)
  return env.PLAYERS.get(env.PLAYERS.idFromName(player)).fetch('https://player/freight-'+(path.endsWith('resume')?'resume':'intercept'),{method:'POST',body:JSON.stringify({player,id:b.id})})
 }
 if(path==='/api/economy/cancel'&&request.method==='POST'){
  const b=await readJson(request);if(!b||Object.keys(b).join(',')!=='id'||!requestId(b.id))throw new HttpError(400,'Invalid shipment')
  return env.FREIGHT.get(env.FREIGHT.idFromName(b.id)).fetch('https://freight/cancel',{method:'POST',body:JSON.stringify({id:b.id,player})})
 }
 throw new HttpError(404,'Not found')
}
