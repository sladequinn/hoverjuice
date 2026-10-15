import {cellFor,wrapLon,type Geo} from './multiplayer'
/** Versioned, immutable ~2.2 km latitude-band districts; independent of OSM labels. */
export function districtFor(p:Geo){return 'd1:'+cellFor(p)}
export function districtBounds(id:string){
 const m=/^d1:(0|[1-9]\d{0,3}):(0|[1-9]\d{0,4})$/.exec(id);if(!m)throw new Error('Invalid district')
 const row=Number(m[1]),col=Number(m[2]);if(row>=9000)throw new Error('Invalid district')
 const south=-90+row*.02,north=south+.02,n=Math.max(1,Math.ceil(360*Math.cos((south+.01)*Math.PI/180)/.02))
 if(col>=n)throw new Error('Invalid district')
 const west=-180+360*col/n,east=-180+360*(col+1)/n
 return {south,north,west,east,lat:(south+north)/2,lon:wrapLon((west+east)/2)}
}
export const CREW_COLORS=['#73ffcb','#ffba73','#bba0ff','#77ccff','#ff8fb4','#ffe580']
export interface CrewView {id:string;name:string;tag:string;color:string;reputation:number;hq:string|null;role:string;membership:string;members:{id:string;name:string;role:string}[];invite?:string;territories?:{id:string;lat:number;lon:number;expiresAt:number}[];headquarters?:{lat:number;lon:number;name:string}|null}
export interface Run {player:string;crew:string;membership:string;name:string;attempts:number;next:number;started:number;best:number|null;last:{lat:number;lon:number;y:number;at:number;seq:number;epoch:number}|null;invalid:string}
export interface Contest {id:string;district:string;startsAt:number;closesAt:number;endsAt:number;course:Geo[];runs:Run[];finished:boolean;winner:string|null}
export interface DistrictView {id:string;controller:string|null;name:string|null;tag:string|null;color:string|null;expiresAt:number;protectedUntil:number;contest:Contest|null;headquarters:{id:string;name:string;tag:string;color:string;lat:number;lon:number}[]}
