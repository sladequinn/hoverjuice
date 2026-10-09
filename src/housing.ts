import {buildingId} from './filter'
import {pointInPoly,worldToLatLon,type Building,type CityData} from './map'

export interface Safehouse {id:string;name:string;lat:number;lon:number;price:number}
const homes=new Set(['residential','apartments','house','detached','semidetached_house','terrace','bungalow','dormitory'])
/** Housing is a separate purchase class. It never enables criminal property claims. */
export function residential(b:Building,city:CityData){
 const t=b.tags??{}
 if(b.clipped || ['amenity','building','class','subclass'].some(k=>['school','kindergarten','hospital','place_of_worship'].includes(String(t[k]))))return false
 if(homes.has(String(t.building)))return true
 if(t.amenity || t.shop || ['commercial','industrial','retail','warehouse','garage','garages'].includes(String(t.building)))return false
 return t.landuse==='residential' || city.zones.some(z=>z.tags.landuse==='residential'&&pointInPoly(b.cx,b.cz,z.poly))
}
export function houseOffer(b:Building,city:CityData):Safehouse {
 const ll=worldToLatLon(city,b.cx,b.cz)
 return {id:b.id??buildingId(ll.lat,ll.lon),name:b.name||`Safehouse ${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}`,...ll,
  price:Math.round(Math.max(15000,Math.min(2000000,b.area*Math.max(1,b.height/3.5)*85))/500)*500}
}
export function localHome(h:{lat:number;lon:number},city:CityData){
 return {x:(h.lon-city.lon)*111320*Math.cos(city.lat*Math.PI/180),z:-(h.lat-city.lat)*110540}
}
export function distanceToHome(x:number,z:number,b:Building){
 if(pointInPoly(x,z,b.poly))return 0
 let best=Infinity
 for(let i=0;i<b.poly.length;i++){
  const a=b.poly[i],c=b.poly[(i+1)%b.poly.length],dx=c[0]-a[0],dz=c[1]-a[1]
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)))
  best=Math.min(best,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t))
 }
 return best
}
