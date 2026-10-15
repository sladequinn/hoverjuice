export const MP_VERSION=1
export const VIEW_METRES=650
export const WATCH_METRES=1000
export const MAX_PEERS=24
export const CELL_PLAYERS=64
export const CELLS_WATCHERS=256
export const STEP=.02
const ROWS=9000,R=6371000,rad=Math.PI/180
export interface Geo {lat:number;lon:number}
export const wrapLon=(lon:number)=>((lon+180)%360+360)%360-180
export const validGeo=(p:any):boolean=>p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180
export function distance(a:Geo,b:Geo){const dlat=(b.lat-a.lat)*rad,dlon=wrapLon(b.lon-a.lon)*rad;const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)))}
const rowFor=(lat:number)=>Math.max(0,Math.min(ROWS-1,Math.floor((lat+90)/STEP)))
const columns=(row:number)=>Math.max(1,Math.ceil(360*Math.cos((-90+(row+.5)*STEP)*rad)/STEP))
const columnFor=(lon:number,n:number)=>Math.min(n-1,Math.floor((wrapLon(lon)+180)/360*n))
export function cellFor(p:Geo){const row=rowFor(p.lat);return `${row}:${columnFor(p.lon,columns(row))}`}
/** Latitude bands with longitude count adjusted to physical width, including poles/dateline. */
export function watchingCells(p:Geo){
 const angle=WATCH_METRES/R,deltaLat=angle/rad
 const dlon=Math.abs(p.lat)+deltaLat>=90?180:Math.asin(Math.min(1,Math.sin(angle)/Math.cos(p.lat*rad)))/rad
 const out=new Set<string>()
 for(let row=rowFor(p.lat-deltaLat);row<=rowFor(p.lat+deltaLat);row++){
  const n=columns(row)
  if(dlon>=180){for(let col=0;col<n;col++)out.add(`${row}:${col}`);continue}
  const start=Math.floor((p.lon-dlon+180)/360*n),end=Math.floor((p.lon+dlon+180)/360*n)
  for(let col=start;col<=end;col++)out.add(`${row}:${((col%n)+n)%n}`)
 }
 return [...out]
}
export const chassisIds=['board','neonic','z150','hovercedes','goblin','hoverarrari','hoverghini']
export const maskIds=['balaclava','glitcher','respirator','oni','liar','jester']
export const paintIds=['factory','steel','bone','rust','olive','amber','violet','petrol','graphite']
export interface Move extends Geo {type:'move';v:1;seq:number;y:number;clearance:number;yaw:number;vx:number;vz:number;chassis:string;mask:string;paint:string;boost:boolean}
export interface Presence extends Move {id:string;name:string;epoch:number;at:number;crewTag?:string}
export function validMove(p:any):p is Move {
 return p&&Object.keys(p).sort().join(',')==='boost,chassis,clearance,lat,lon,mask,paint,seq,type,v,vx,vz,y,yaw'&&p.type==='move'&&p.v===1&&validGeo(p)&&
  ['y','clearance','yaw','vx','vz'].every(k=>Number.isFinite(p[k]))&&p.y>=-1500&&p.y<=10000&&p.clearance>=0&&p.clearance<=400&&Math.abs(p.yaw)<=Math.PI*2&&Math.hypot(p.vx,p.vz)<=220&&
  Number.isSafeInteger(p.seq)&&p.seq>=0&&chassisIds.includes(p.chassis)&&maskIds.includes(p.mask)&&paintIds.includes(p.paint)&&typeof p.boost==='boolean'
}
export function saneMove(p:Move,last:Presence|null,anchor:Geo,now:number){
 if(!last)return distance(p,anchor)<250
 const dt=Math.min(2,Math.max(0,(now-last.at)/1000))
 return p.seq>last.seq&&distance(last,p)<=80+220*dt&&Math.abs(p.y-last.y)<=15+150*dt
}
export const validName=(name:unknown):name is string=>typeof name==='string'&&/^[\p{L}\p{N} _.-]{2,20}$/u.test(name)
export const validId=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)
export interface RaceView {id:string;host:string;course:Geo[];startsAt:number;expiresAt:number;status:'waiting'|'racing'|'finished';racers:{id:string;name:string;checkpoint:number;finished:number|null}[]}
export function validCourse(course:unknown,anchor:Geo):course is Geo[]{
 if(!Array.isArray(course)||course.length<2||course.length>32||!course.every(validGeo)||distance(course[0],anchor)>200)return false
 return course.every((p,i)=>distance(p,anchor)<10000&&(i===0||(distance(p,course[i-1])>=15&&distance(p,course[i-1])<2500)))
}

export function validRace(r:any):r is RaceView {
 return r&&validId(r.id)&&validId(r.host)&&['waiting','racing','finished'].includes(r.status)&&Number.isFinite(r.startsAt)&&Number.isFinite(r.expiresAt)&&
  Array.isArray(r.course)&&r.course.length>=2&&r.course.length<=32&&r.course.every(validGeo)&&Array.isArray(r.racers)&&r.racers.length<=8&&
  r.racers.every((p:any)=>p&&validId(p.id)&&validName(p.name)&&Number.isInteger(p.checkpoint)&&p.checkpoint>=0&&p.checkpoint<=r.course.length&&(p.finished===null||(Number.isFinite(p.finished)&&p.finished>=0)))
}
