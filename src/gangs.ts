import {type Gang,syndicate,hashName} from './filter'
import {pointInPoly,worldToLatLon,type CityData,type Pt,type Zone} from './map'
export const GANG_INFO:Record<Gang,{color:string;fill:string;leader:string;district:string}>={
 SHINOBI:{color:'#45c4cb',fill:'#123239',leader:'SLADE',district:'Commercial, technology and university districts'},
 LIARS:{color:'#dce0da',fill:'#2c3034',leader:'WHITE LIE',district:'Industry, docks and rail yards'},
 HYENAS:{color:'#d7a35f',fill:'#382a1d',leader:'FASA',district:'Residential grids and backstreets'},
 JESTERS:{color:'#c879af',fill:'#352237',leader:'FRECKLES',district:'Retail, nightlife and marinas'},
}
const NAMES=Object.keys(GANG_INFO) as Gang[]
const LAT=.014,LON=.02
function cell(city:CityData,x:number,z:number){const ll=worldToLatLon(city,x,z);return {x:Math.floor(ll.lon/LON),y:Math.floor(ll.lat/LAT)}}
function owner(x:number,y:number){return NAMES[hashName(`${x}:${y}`)%4]}
function mapped(z:Zone){return /commercial|industrial|retail|residential|rail|port|dock|university|college|nightclub|bar|marina/.test(String(z.tags.landuse||z.tags.amenity||z.tags.class||''))}
function zoneArea(poly:Pt[]){let sum=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];sum+=a[0]*b[1]-b[0]*a[1]}return Math.abs(sum/2)}
export class Territories {
 private zones:Zone[]
 constructor(privateCity:CityData){this.city=privateCity;this.zones=privateCity.zones.filter(mapped).slice().sort((a,b)=>zoneArea(a.poly)-zoneArea(b.poly))}
 private city:CityData
 at(x:number,z:number):Gang{
  const zone=this.zones.find(v=>pointInPoly(x,z,v.poly))
  if(zone)return syndicate(zone.tags)
  const c=cell(this.city,x,z);return owner(c.x,c.y)
 }
 regions():Zone[]{
  const keys=new Map<string,{x:number;y:number}>()
  for(const n of this.city.nodes){const c=cell(this.city,n.x,n.z);keys.set(`${c.x}:${c.y}`,c)}
  const project=(lon:number,lat:number):Pt=>[(lon-this.city.lon)*111320*Math.cos(this.city.lat*Math.PI/180),-(lat-this.city.lat)*110540]
  const regions:Zone[]=[...keys.values()].map(c=>({gang:owner(c.x,c.y),tags:{generated:true},poly:[project(c.x*LON,c.y*LAT),project((c.x+1)*LON,c.y*LAT),project((c.x+1)*LON,(c.y+1)*LAT),project(c.x*LON,(c.y+1)*LAT)]}))
  // Small, specific OSM districts override the larger background regions.
  return [...regions,...this.zones.slice().reverse().map(z=>({...z,gang:syndicate(z.tags)}))]
 }
}
