import type {World} from './world'
export interface Point {x:number;y:number;z:number}
export interface Body extends Point {id:string;heading:number;halfW:number;halfL:number;vx:number;vz:number;mass:number;push:(vx:number,vz:number,dx:number,dz:number)=>void}
export interface Driver extends Point {id?:string;heading:number;halfW:number;halfL:number;vx:number;vz:number;mass:number}
/** Continuous relative-motion circle sweep; returns first contact, including initial overlap. */
export function sweepCircle(x:number,z:number,dx:number,dz:number,r:number){const c=x*x+z*z-r*r;if(c<=0)return 0;const a=dx*dx+dz*dz,b=x*dx+z*dz;if(a<1e-10||b>=0)return null;const discriminant=b*b-a*c;if(discriminant<0)return null;const t=(-b-Math.sqrt(discriminant))/a;return t>=0&&t<=1?t:null}
function offsets(b:{halfW:number;halfL:number}){const l=Math.max(0,b.halfL-b.halfW);return l>.1?[-l,0,l]:[0]}
/** 16m broadphase, capsule contact, impulse and positional correction. Online peers are never added. */
export class PhysicalWorld {
 private grid=new Map<string,Body[]>();checks=0
 setBodies(bodies:Body[]){this.grid.clear();for(const b of bodies){const r=b.halfL+2+Math.min(40,Math.hypot(b.vx,b.vz)*.1);for(let x=Math.floor((b.x-r)/16);x<=Math.floor((b.x+r)/16);x++)for(let z=Math.floor((b.z-r)/16);z<=Math.floor((b.z+r)/16);z++){const key=x+':'+z,rows=this.grid.get(key)??[];rows.push(b);this.grid.set(key,rows)}}}
 solve(p:Driver,start:Point,dt:number){let impact=0,hits=0;this.checks=0;const seen=new Set<string>();let from={...start};
  for(let iteration=0;iteration<4;iteration++){
   const candidates=new Set<Body>(),r=p.halfL+2;for(let x=Math.floor((Math.min(from.x,p.x)-r)/16);x<=Math.floor((Math.max(from.x,p.x)+r)/16);x++)for(let z=Math.floor((Math.min(from.z,p.z)-r)/16);z<=Math.floor((Math.max(from.z,p.z)+r)/16);z++)for(const b of this.grid.get(x+':'+z)??[])candidates.add(b)
   let best:{b:Body;t:number;nx:number;nz:number;depth:number}|null=null
   for(const b of candidates){if(b.id===p.id||seen.has(b.id)||Math.abs(p.y-b.y)>1.5)continue;this.checks++;for(const a of offsets(p))for(const c of offsets(b)){
    const x=from.x+Math.sin(p.heading)*a-(b.x-b.vx*dt+Math.sin(b.heading)*c),z=from.z+Math.cos(p.heading)*a-(b.z-b.vz*dt+Math.cos(b.heading)*c),dx=p.x-from.x-b.vx*dt,dz=p.z-from.z-b.vz*dt,radius=p.halfW+b.halfW,t=sweepCircle(x,z,dx,dz,radius);if(t===null||best&&t>=best.t)continue
    const cx=x+dx*t,cz=z+dz*t,d=Math.hypot(cx,cz),nx=d>1e-6?cx/d:Math.abs(dx)+Math.abs(dz)>0?-dx/(Math.hypot(dx,dz)||1):1,nz=d>1e-6?cz/d:-dz/(Math.hypot(dx,dz)||1);best={b,t,nx,nz,depth:Math.max(0,radius-d)}
   }}
   if(!best)break;const {b,t,nx,nz,depth}=best;seen.add(b.id);hits++
   // End at the contact surface in the body's current frame, never beyond it.
   p.x=from.x+(p.x-from.x)*t+b.vx*dt*(1-t)+nx*(depth+.025);p.z=from.z+(p.z-from.z)*t+b.vz*dt*(1-t)+nz*(depth+.025)
   const closing=(p.vx-b.vx)*nx+(p.vz-b.vz)*nz,inv=1/p.mass+(b.mass===Infinity?0:1/b.mass),j=closing<0?-(1.12)*closing/inv:0
   p.vx+=j*nx/p.mass;p.vz+=j*nz/p.mass;b.push(b.mass===Infinity?0:-j*nx/b.mass,b.mass===Infinity?0:-j*nz/b.mass,-nx*depth*.2,-nz*depth*.2);impact=Math.max(impact,j/p.mass);from={x:p.x,y:p.y,z:p.z}
  }return {impact,hits,checks:this.checks}
 }
}
export function footprintBlocked(world:Pick<World,'hitBuilding'>,p:Point,heading:number,halfW:number,halfL:number){const sx=Math.sin(heading),sz=Math.cos(heading);for(const l of [-halfL,0,halfL])for(const w of [-halfW,0,halfW])if(world.hitBuilding(p.x+sx*l+sz*w,p.z+sz*l-sx*w,p.y-.5)>=0)return true;return false}
/** Swept hull sampling also catches thin facades skipped by endpoint-only tests. */
export function clipBuildings(world:Pick<World,'hitBuilding'>,start:Point,end:Point,heading:number,halfW:number,halfL:number){const distance=Math.hypot(end.x-start.x,end.z-start.z),steps=Math.min(256,Math.max(1,Math.ceil(distance/.3)));if(footprintBlocked(world,start,heading,halfW,halfL))return null;for(let i=1;i<=steps;i++){const t=i/steps,p={x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t,z:start.z+(end.z-start.z)*t};if(footprintBlocked(world,p,heading,halfW,halfL)){const safe=(i-1)/steps;return {x:start.x+(end.x-start.x)*safe,y:start.y+(end.y-start.y)*safe,z:start.z+(end.z-start.z)*safe}}}return null}
