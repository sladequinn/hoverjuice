import {Vector3} from 'three'
import type {World} from './world'
/** Sample the rendered road, including DEM triangle breaks and separate bridge decks. */
export function routeGuide(world:World,route:number[]){
 const points:Vector3[]=[]
 for(let i=1;i<route.length;i++){
  const a=world.city.nodes[route[i-1]],b=world.city.nodes[route[i]],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/2))
  for(let j=i===1?0:1;j<=steps;j++){const t=j/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,reference=(a.y??0)*(1-t)+(b.y??0)*t
   points.push(new Vector3(x,world.surfaceHeightAt(x,z,reference)+.1,z))
  }
 }
 return points
}
