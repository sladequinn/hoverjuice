import {distance,wrapLon,type Geo} from './multiplayer'
import {districtBounds,districtFor} from './crews'
export const COMMODITIES=[{id:'glimmer',name:'Glimmer crystals',base:12000},{id:'ghostware',name:'Ghostware chips',base:18000},{id:'nightbloom',name:'Nightbloom extract',base:8000}] as const
export const HOUR=3600000,MAX_DAILY=6,BUDGET=100000000
export function seed(s:string){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0}
export function baseline(district:string,commodity:string){return 50+seed(district+commodity)%71}
export function price(district:string,commodity:string,stock:number,pressure:number){const c=COMMODITIES.find(c=>c.id===commodity)!;return Math.round(c.base*(.85+(seed(district+commodity+'price')%31)/100)*Math.max(.5,Math.min(2.5,1+(baseline(district,commodity)-stock)/100+pressure/100)))}
export function neighbours(id:string){const c=districtBounds(id),out=new Set<string>();for(const [lat,lon]of [[c.lat+.02,c.lon],[c.lat-.02,c.lon],[c.lat,c.lon+(c.east-c.west)],[c.lat,c.lon-(c.east-c.west)]])if(Math.abs(lat)<85)out.add(districtFor({lat,lon:wrapLon(lon)}));out.delete(id);return [...out]}
export interface MarketRow {district:string;commodity:string;stock:number;pressure:number;revision:number;updated_at:number;price:number;previous_price:number;delivered:number;lost:number;incoming:number}
export interface FreightInput {seq:number;throttle:number;steer:number}
export interface FreightCar {s:number;speed:number;lane:number;damage:number;gate:number;at:number;seq:number;throttle:number;steer:number}
export interface FreightCourse {points:Geo[];lengths:number[];total:number;seed:number}
export function course(points:Geo[],key:string):FreightCourse {const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)!+distance(points[i-1],points[i]));return {points,lengths,total:lengths.at(-1)!,seed:seed(key)}}
export function car(now:number,s=0):FreightCar{return {s,speed:0,lane:0,damage:0,gate:Math.floor(s/180)+1,at:now,seq:-1,throttle:0,steer:0}}
export function gateLane(c:FreightCourse,gate:number){return ((c.seed+gate*17)%2?1:-1)*2}
export function validFreightInput(p:any):p is FreightInput{return p&&Object.keys(p).sort().join(',')==='seq,steer,throttle'&&Number.isSafeInteger(p.seq)&&p.seq>=0&&Number.isFinite(p.throttle)&&p.throttle>=-1&&p.throttle<=1&&Number.isFinite(p.steer)&&Math.abs(p.steer)<=1}
/** Server clock advances simulation, never client coordinates, timestamps or frame counts. */
export function advanceCar(c:FreightCourse,v:FreightCar,now:number){
 let dt=Math.min(.3,Math.max(0,(now-v.at)/1000));const stale=now-v.at>700
 while(dt>0){const t=Math.min(.05,dt);dt-=t;v.speed=Math.max(0,Math.min(32,v.speed+((stale?-1:v.throttle)*10-1)*t));v.lane=Math.max(-3,Math.min(3,v.lane+(stale?0:v.steer)*5*t));v.s=Math.min(c.total,v.s+v.speed*t)
  if(v.s>=v.gate*180&&v.gate*180<c.total){if(Math.abs(v.lane-gateLane(c,v.gate))>1.6&&v.speed>8){v.damage++;v.speed*=.35}v.gate++}
 }
 v.at=now
}
export function freightPosition(c:FreightCourse,v:FreightCar):Geo&{yaw:number}{let i=1;while(i<c.lengths.length-1&&c.lengths[i]<v.s)i++;const a=c.points[i-1],b=c.points[i],t=Math.max(0,Math.min(1,(v.s-c.lengths[i-1])/(c.lengths[i]-c.lengths[i-1]||1))),dx=wrapLon(b.lon-a.lon)*111320*Math.cos(a.lat*Math.PI/180),dz=-(b.lat-a.lat)*110540,len=Math.hypot(dx,dz)||1;return {lat:a.lat+(b.lat-a.lat)*t+dx/len*v.lane/110540,lon:wrapLon(a.lon+wrapLon(b.lon-a.lon)*t+dz/len*v.lane/(111320*Math.cos(a.lat*Math.PI/180))),yaw:Math.atan2(dx,dz)}}
export interface FreightView {id:string;status:string;origin:string;destination:string;commodity:string;quantity:number;gross:number;net:number;fee:number;expires_at:number;player_id:string;crew_id:string|null;membership:string|null;competitive:number;course:FreightCourse;driver:FreightCar;attacker:{id:string;crew:string;membership:string;car:FreightCar}|null;lock:number;result?:string}

export function freightReward(length:number,sourcePrice:number,destinationPrice:number,quantity:number,business=false,control=false){const gross=Math.max(2000,Math.min(20000,Math.round(2000+length*2+Math.max(0,destinationPrice-sourcePrice)*quantity*.05))),fee=Math.ceil(gross*(.12-(business ? .01 : 0)-(control ? .02 : 0)));return {gross,fee,net:gross-fee}}
