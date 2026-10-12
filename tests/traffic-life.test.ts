import test from 'node:test'
import assert from 'node:assert/strict'
import {Vector3} from 'three'
import {TrafficSystem} from '../src/traffic'
import type {World} from '../src/world'
function setup(junction=false){
 const nodes=junction?[
  {x:0,z:-40,adj:[1]},{x:0,z:0,adj:[0,2,3,4]},{x:-40,z:0,adj:[1]},{x:0,z:40,adj:[1]},{x:40,z:0,adj:[1]},
 ]:[{x:0,z:0,adj:[1]},{x:0,z:1000,adj:[0]}]
 const world={city:{nodes:nodes.map(n=>({...n,main:true,width:7}))},pumps:[{node:0,x:nodes[0].x,z:nodes[0].z}],isWater:()=>false,hitBuilding:()=>-1} as unknown as World
 const traffic=new TrafficSystem(world),state=traffic as any
 return {traffic,state,world}
}
const far=new Vector3(3000,1.3,3000)
test('faster traffic queues behind a freight rig without overlap',()=>{
 const {traffic,state}=setup();const [a,b]=state.agents;state.agents=[a,b]
 Object.assign(a,{a:0,b:1,distance:10,speed:23,kind:0});Object.assign(b,{a:0,b:1,distance:20,speed:5,kind:1})
 traffic.update(0,far)
 for(let i=0;i<300;i++){traffic.update(1/60,far);assert.ok(b.distance-a.distance>4,'Vehicle envelopes must not overlap')}
 assert.ok(a.speed<12,'Courier matches freight pace')
 traffic.dispose()
})
test('crossing traffic yields to a reserved junction',()=>{
 const {traffic,state}=setup(true);const [a,b]=state.agents;state.agents=[a,b]
 Object.assign(a,{a:0,b:1,distance:35,speed:10});Object.assign(b,{a:2,b:1,distance:35,speed:10})
 traffic.update(0,far)
 for(let i=0;i<45;i++)traffic.update(1/60,far)
 assert.equal(b.a,2);assert.ok(b.distance<=37.5)
 assert.ok(a.a===1,'Reservation holder crosses first')
 traffic.dispose()
})
test('venue visitors pull in, dwell and merge out; parking excludes blocked buildings',()=>{
 const {traffic,state,world}=setup();traffic.setActivitySites([],new Vector3());assert.equal(state.sites.length,2)
 const car=state.agents[0];state.agents=[car];const site=state.sites[0]
 car.site=site;site.occupant=car.seed;Object.assign(car,{a:1,b:0,distance:998,speed:8,phase:'drive'});traffic.update(0,far)
 for(let i=0;i<210;i++)traffic.update(1/60,far)
 assert.equal(car.phase,'park');assert.equal(car.visits,1);assert.ok(car.pos.distanceTo(new Vector3(site.x,site.y,site.z))<.01)
 const before=car.pos.clone(),wait=car.wait;traffic.update(0,far);assert.equal(car.wait,wait);assert.deepEqual(car.pos,before)
 car.wait=0;for(let i=0;i<240;i++)traffic.update(1/60,far)
 assert.equal(car.phase,'drive');assert.equal(site.occupant,null);assert.ok(car.distance>6)
 world.hitBuilding=()=>0;traffic.setActivitySites([{id:'new',node:1,x:0,z:1000,gang:'LIARS'}],new Vector3(0,0,1000));assert.equal(state.sites.length,0)
 traffic.dispose()
})
test('initial local traffic uses the existing pool; fly-by horns have per-car cooldown',()=>{
 const {traffic,state}=setup();const count=state.agents.length
 traffic.prime(new Vector3(0,1.3,0));assert.equal(state.agents.length,count)
 const car=state.agents[0];state.agents=[car];Object.assign(car,{a:0,b:1,distance:5,speed:10,kind:0,phase:'drive',site:null});traffic.update(0,new Vector3())
 assert.ok(traffic.update(.016,new Vector3(0,1.3,0),35).horn)
 assert.equal(traffic.update(.016,new Vector3(0,1.3,0),35).horn,undefined)
 assert.equal(traffic.group.children.length,3)
 traffic.dispose()
})
test('all approaches clear over time without a permanently renewed intersection reservation',()=>{
 const {traffic,state}=setup(true);state.agents=state.agents.slice(0,4)
 state.agents.forEach((car:any,i:number)=>Object.assign(car,{a:[0,2,3,4][i],b:1,distance:34,speed:5,kind:0}))
 traffic.update(0,far)
 for(let i=0;i<900;i++)traffic.update(1/60,far)
 for(const car of state.agents)assert.ok(car.turns>0,'Every approach must cross')
 traffic.dispose()
})
test('a player behind or on the sidewalk does not hold nearby traffic stopped',()=>{
 const {traffic,state}=setup();const car=state.agents[0];state.agents=[car];Object.assign(car,{a:0,b:1,distance:100,speed:0,kind:0,seed:1})
 traffic.update(0,far);const player=car.pos.clone();player.z-=2
 for(let i=0;i<120;i++)traffic.update(1/60,player,0)
 assert.ok(car.distance>105);traffic.dispose()
})
