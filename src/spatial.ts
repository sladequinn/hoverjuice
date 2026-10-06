export const EARTH_RADIUS=6378137
export const PEER_RADIUS=5000
export function mercator(lat:number,lon:number) {
  const phi=Math.max(-85,Math.min(85,lat))*Math.PI/180
  return {x:EARTH_RADIUS*lon*Math.PI/180,z:-EARTH_RADIUS*Math.log(Math.tan(Math.PI/4+phi/2))}
}
export function unproject(x:number,z:number) {return {lat:(2*Math.atan(Math.exp(-z/EARTH_RADIUS))-Math.PI/2)*180/Math.PI,lon:x/EARTH_RADIUS*180/Math.PI}}
export function tileKey(lat:number,lon:number) {
  const n=16384, p=mercator(lat,lon), half=Math.PI*EARTH_RADIUS
  return `14_${Math.max(0,Math.min(n-1,Math.floor((p.x+half)/(2*half)*n)))}_${Math.max(0,Math.min(n-1,Math.floor((p.z+half)/(2*half)*n)))}`
}
export function nearbyTiles(lat:number,lon:number,radius=PEER_RADIUS) {
  const p=mercator(lat,lon),scale=1/Math.cos(Math.max(-85,Math.min(85,lat))*Math.PI/180)
  const a=unproject(p.x-radius*scale,p.z-radius*scale),b=unproject(p.x+radius*scale,p.z+radius*scale)
  const [,ax,ay]=tileKey(a.lat,a.lon).split('_').map(Number),[,bx,by]=tileKey(b.lat,b.lon).split('_').map(Number)
  const out:string[]=[]
  for(let x=ax;x<=bx;x++)for(let y=ay;y<=by;y++)out.push(`14_${x}_${y}`)
  return out
}
export function crewInvite(hash:string) {
  const [city,query='']=hash.replace(/^#/,'').split('?')
  const crew=new URLSearchParams(query).get('crew')
  return {city:decodeURIComponent(city),crew:crew&&/^[a-z0-9_-]{1,40}$/i.test(crew)?crew.toLowerCase():null}
}
export function spatialDistance(a:{x:number;z:number},b:{x:number;z:number}) {
  const lat=unproject((a.x+b.x)/2,(a.z+b.z)/2).lat*Math.PI/180
  return Math.hypot(a.x-b.x,a.z-b.z)*Math.cos(lat)
}
export interface Telemetry {
  id:string; x:number;y:number;z:number;rotY:number;laneIndex:number;velocity:number;maskId:string;chassisId:string;boost:boolean;seq:number
}
export function validTelemetry(v:unknown):v is Telemetry {
  if(!v||typeof v!=='object')return false
  const p=v as Telemetry
  return typeof p.id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(p.id)&&
    [p.x,p.y,p.z,p.rotY,p.velocity,p.seq].every(Number.isFinite)&&Math.abs(p.x)<20040000&&Math.abs(p.z)<20040000&&p.y>=-10&&p.y<800&&p.velocity>=0&&p.velocity<=220&&Number.isSafeInteger(p.seq)&&p.seq>=0&&[0,1,2].includes(p.laneIndex)&&typeof p.boost==='boolean'&&
    ['balaclava','glitcher','respirator','oni','liar','jester'].includes(p.maskId)&&['board','neonic','z150','hovercedes','goblin','hoverarrari','hoverghini'].includes(p.chassisId)
}
