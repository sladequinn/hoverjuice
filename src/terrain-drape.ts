import type {Pt} from './map'
import {TERRAIN_STEP} from './terrain'
/** Split road triangles at DEM cell edges/diagonals so asphalt cannot cut through a hill. */
export function drapeTriangles(vertices:number[],from:number,height:(x:number,z:number)=>number,offset:number){
 const source=vertices.splice(from),step=TERRAIN_STEP
 const clip=(poly:Pt[],distance:(p:Pt)=>number)=>{
  const out:Pt[]=[]
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a),db=distance(b)
   if(da>=-1e-7)out.push(a)
   if((da>0&&db<0)||(da<0&&db>0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])}
  }return out
 }
 for(let i=0;i<source.length;i+=9){
  const tri:Pt[]=[[source[i],source[i+2]],[source[i+3],source[i+5]],[source[i+6],source[i+8]]]
  const minX=Math.floor(Math.min(...tri.map(p=>p[0]))/step),maxX=Math.floor(Math.max(...tri.map(p=>p[0]))/step),minZ=Math.floor(Math.min(...tri.map(p=>p[1]))/step),maxZ=Math.floor(Math.max(...tri.map(p=>p[1]))/step)
  for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
   let p=clip(tri,p=>p[0]-x*step);p=clip(p,p=>(x+1)*step-p[0]);p=clip(p,p=>p[1]-z*step);p=clip(p,p=>(z+1)*step-p[1])
   for(const sign of [-1,1]){const polygon=clip(p,p=>sign*(p[0]+p[1]-(x+z+1)*step))
    for(let j=1;j+1<polygon.length;j++)for(const q of [polygon[0],polygon[j],polygon[j+1]])vertices.push(q[0],height(q[0],q[1])+offset,q[1])
   }
  }
 }
}
