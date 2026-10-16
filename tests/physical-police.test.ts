import test from 'node:test'
import assert from 'node:assert/strict'
import {Vector3} from 'three'
import {PhysicalWorld,sweepCircle,clipBuildings,type Body,type Driver} from '../src/physical'
import {PoliceSystem} from '../src/police'
import {StreetObjects} from '../src/street-objects'
import {TrafficSystem} from '../src/traffic'
import type {World} from '../src/world'
const driver=(x=0,z=0):Driver=>({x,y:1,z,heading:0,halfW:.6,halfL:1.3,vx:0,vz:40,mass:1000})
const body=(values:Partial<Body>={}):Body=>({id:'npc',x:0,y:1,z:5,heading:0,halfW:.6,halfL:1.3,vx:0,vz:0,mass:1000,push:()=>{},...values})
function world(){const nodes=Array.from({length:80},(_,i)=>({x:0,z:i*10,y:0,width:7,main:true,adj:[i-1,i+1].filter(j=>j>=0&&j<80)}));return {city:{nodes,venues:[],zones:[],lat:43,lon:-80,terrain:{heightAt:()=>0}},isWater:()=>false,hitBuilding:()=>-1} as unknown as World}
function unit(police:PoliceSystem,z=0){const u={id:1,a:z/10,b:z/10+1,s:0,speed:0,heading:0,pos:new Vector3(0,1,z),path:[],stun:0,block:false};police.units=[u];return u}
test('swept contacts catch high speed head-on, rear and glancing impacts with momentum transfer',()=>{
 for(const x of [0,.7]){const physics=new PhysicalWorld(),p=driver(x,20);let transferred=0;physics.setBodies([body({push:(_vx,vz)=>{transferred=vz}})]);const result=physics.solve(p,{x,y:1,z:0},.1);assert.ok(result.hits);assert.ok(p.z<5);assert.ok(p.vz<40);assert.ok(transferred>0)}
 assert.equal(sweepCircle(0,-10,0,30,2),8/30);assert.equal(sweepCircle(10,10,1,1,2),null)
 const physics=new PhysicalWorld(),p=driver(0,20);physics.setBodies([body({y:15})]);assert.equal(physics.solve(p,{x:0,y:1,z:0},.1).hits,0,'Bridge separation must not collide')
})
test('stationary penetration separates, barriers stop motion, and broadphase excludes distant traffic',()=>{
 const physics=new PhysicalWorld(),p=driver(0,5);p.vz=0;physics.setBodies([body(),...Array.from({length:192},(_,i)=>body({id:String(i),x:1000+i*20}))]);const hit=physics.solve(p,{x:0,y:1,z:5},.016);assert.ok(hit.hits);assert.ok(Math.abs(p.x)>.1||Math.abs(p.z-5)>.1);assert.equal(hit.checks,1)
 const d=driver(0,20);physics.setBodies([body({mass:Infinity})]);physics.solve(d,{x:0,y:1,z:0},.1);assert.ok(d.vz<0);assert.ok(d.z<5)
})
test('swept full hull stops at thin facades that endpoint tests miss',()=>{
 const w={hitBuilding:(x:number,z:number,y:number)=>Math.abs(x)<10&&z>5&&z<5.4&&y<10?0:-1};const contact=clipBuildings(w,{x:0,y:1,z:0},{x:0,y:1,z:20},0,.6,1.3);assert.ok(contact);assert.ok(contact.z<5);assert.equal(clipBuildings(w,{x:0,y:15,z:0},{x:0,y:15,z:20},0,.6,1.3),null)
})
test('traffic impulse persists beyond the next road-follow update',()=>{
 const w=world(),traffic=new TrafficSystem(w),state=traffic as any;state.agents=state.agents.slice(0,1);const p=new Vector3(0,1,0);traffic.update(0,p);traffic.bodies()[0].push(8,-5,1,0);traffic.update(.05,p);assert.ok(state.agents[0].offsetX>1);assert.ok(state.agents[0].stun>0);traffic.dispose()
})
test('props scatter, tumble, break, and concrete barriers remain solid',()=>{
 const props=new StreetObjects(world()),p=new Vector3(0,1,0);for(let i=0;i<40;i++)props.update(.05,p,Array.from({length:30},(_,i)=>i+5));assert.ok(props.items.length>0);assert.ok(props.items.length<=48)
 const sign=props.items.find(i=>i.kind===2)!;props.bodies().find(b=>b.id==='prop:'+sign.id)!.push(20,0,0,0);const x=sign.pos.x;props.update(.05,p,[]);assert.ok(sign.pos.x>x);assert.ok(sign.broken);assert.ok(sign.angle>0);assert.equal(props.bodies().some(b=>b.id==='prop:'+sign.id),false)
 const barrier=props.bodies().find(b=>b.mass===Infinity)!;barrier.push(100,100,10,10);assert.equal(props.items.find(i=>'prop:'+i.id===barrier.id)!.vx,0);props.dispose()
})
test('police need visible offences; occlusion prevents detection and pursuit can be escaped',()=>{
 const w=world(),police=new PoliceSystem(w),u=unit(police),p=new Vector3(0,1,30);(police as any).spawnClock=999
 w.hitBuilding=()=>0;for(let i=0;i<50;i++)police.update(.1,p,40,3);assert.equal(police.state,'patrol')
 w.hitBuilding=()=>-1;u.pos.set(0,1,0);u.a=0;u.b=1;u.s=0;for(let i=0;i<30;i++)police.update(.1,p,40,3);assert.equal(police.state,'pursuit');assert.match(police.message,/Active pursuit/)
 p.set(5000,1,5000);for(let i=0;i<140;i++)police.update(.1,p,40,3);assert.equal(police.state,'search');for(let i=0;i<200;i++)police.update(.1,p,40,3);assert.equal(police.state,'escaped');assert.match(police.message,/escaped/);police.dispose()
})
test('minor offences lead to a stop, evasion escalates and nearby stationary suspects are impounded',()=>{
 const police=new PoliceSystem(world()),u=unit(police),p=new Vector3(0,1,8);(police as any).spawnClock=999
 for(let i=0;i<25;i++){u.pos.set(0,1,0);police.update(.1,p,35,.5)}assert.equal(police.state,'stop')
 for(let i=0;i<90;i++){u.pos.set(0,1,0);police.update(.1,p,10,.5)}assert.equal(police.state,'pursuit')
 for(let i=0;i<50&&!police.busted;i++){u.pos.set(0,1,5);police.update(.1,p,0,3)}assert.equal(police.busted,true);police.dispose()
})
test('police spawn away from the player, remain capped and pause without simulation',()=>{
 const police=new PoliceSystem(world()),p=new Vector3(0,1,300);police.update(.1,p,0,0);assert.ok(police.units.length);assert.ok(police.units.every(u=>u.pos.distanceTo(p)>150));const before=police.units[0].pos.clone();police.update(0,p,40,5);assert.deepEqual(police.units[0].pos,before);for(let i=0;i<1000;i++)police.update(.1,p,40,5);assert.ok(police.units.length<=6);police.dispose()
})
test('escalation sends a roadblock unit to a fixed road target and holds it there',()=>{
 const police=new PoliceSystem(world()),base=unit(police,300);police.units=Array.from({length:4},(_,i)=>({...base,id:i+1,a:30+i,b:31+i,pos:new Vector3(0,1,300+i*10),path:[]}));police.state='pursuit';(police as any).spawnClock=999;const p=new Vector3(0,1,440)
 for(let i=0;i<150;i++)police.update(.1,p,15,5,0)
 const blocker=police.units[3];assert.ok(blocker.block);assert.ok(blocker.goal!==undefined);assert.ok(Math.abs(blocker.pos.z-police['world'].city.nodes[blocker.goal!].z)<6);assert.equal(blocker.speed,0);police.dispose()
})
test('light props transfer much less damaging momentum than concrete barriers',()=>{
 const impact=(mass:number)=>{const physical=new PhysicalWorld(),p=driver(0,20);physical.setBodies([body({mass})]);return physical.solve(p,{x:0,y:1,z:0},.1).impact};assert.ok(impact(35)<impact(Infinity)*.1)
})
test('parked vehicles retain knockback without compounding displacement each frame',()=>{
 const traffic=new TrafficSystem(world()),state=traffic as any,c=state.agents[0];state.agents=[c];c.phase='park';c.wait=100;c.site={x:0,y:1.3,z:50,node:5,next:6,heading:0,occupant:c.seed};c.pos.set(0,1.3,50);c.heading=0;traffic.bodies()[0].push(12,0,0,0);for(let i=0;i<120;i++)traffic.update(1/60,new Vector3(0,1,0));assert.ok(c.pos.x>0&&c.pos.x<5);traffic.dispose()
})
