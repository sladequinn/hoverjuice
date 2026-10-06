import {test} from 'node:test'
import assert from 'node:assert/strict'
import {RunState,OVERCLOCK_SPEED} from '../src/dynamics'
import {buildingId,criminalEligible,grindVenue,protectedVenue} from '../src/filter'
import {crewInvite,mercator,unproject,tileKey,nearbyTiles,spatialDistance,validTelemetry} from '../src/spatial'
import {makeBuilding,proceduralCity} from '../src/map'
import {Player} from '../src/vehicle'
import {vehicleById} from '../src/data'
import {highwayLoop} from '../src/campaign'
import type {World} from '../src/world'

test('protected and unknown uses fail closed',()=>{
 for(const amenity of ['school','kindergarten','hospital','place_of_worship'])assert.equal(criminalEligible({amenity,shop:'convenience'}),false)
 for(const building of ['house','apartments','residential'])assert.equal(criminalEligible({building,amenity:'bar'}),false)
 assert.equal(criminalEligible({}),false)
 assert.equal(protectedVenue({subclass:'hospital'}),true)
 assert.equal(criminalEligible({building:'commercial',amenity:'bar'}),true)
})
test('brand and independent venue names are deterministic',()=>{
 assert.equal(grindVenue({brand:'Shell'}),'SHELFISH Precursor & Hydropumps')
 assert.equal(grindVenue({brand:'McDonald’s'}),"McREPULSOR'S 24/7 Nutrient Sludge")
 assert.equal(grindVenue({name:"Angelo's Pizzeria",cuisine:'pizza'}),grindVenue({name:"Angelo's Pizzeria",cuisine:'pizza'}))
})
test('polygon centroid ignores redundant vertices and winding',()=>{
 const a=makeBuilding([[0,0],[10,0],[10,10],[0,10]],5)!,b=makeBuilding([[0,10],[10,10],[10,0],[5,0],[0,0]],5)!
 assert.equal(a.cx,5);assert.equal(a.cz,5);assert.equal(b.cx,a.cx);assert.equal(b.cz,a.cz)
 assert.equal(buildingId(43.45000001,-80.49000001),buildingId(43.45,-80.49))
 assert.equal(buildingId(-0,0),'bld_0.00000_0.00000')
})
test('overclock costs hull once, lasts 15 seconds and cannot bypass limp',()=>{
 const r=new RunState();assert.equal(r.burn(),true);assert.equal(r.hull,75);assert.equal(r.burn(),false)
 r.update(15,0,false,false,false);assert.equal(r.overclock,0);assert.equal(OVERCLOCK_SPEED*3.6,300)
 r.damage(100);assert.equal(r.limp,15);assert.equal(r.burn(),false);r.update(15,0,false,false,false);assert.equal(r.limp,0)
})
test('Flow expires and impacts reset it; tunnels decay Heat faster',()=>{
 const r=new RunState();r.chain();assert.equal(r.flow,1.25);r.damage(1);assert.equal(r.flow,1)
 r.chain();r.update(8,0,false,false,false);assert.equal(r.flow,1)
 r.heat=3;r.update(1,5,true,true,false);assert.ok(r.heat<3)
 const a=new RunState(),b=new RunState();a.update(10,5,false,true,false);b.update(10,5,false,true,true);assert.ok(b.heat<a.heat)
})
test('crew hashes, spatial coverage and projection remain origin independent',()=>{
 assert.deepEqual(crewInvite('#toronto?crew=IronLungs'),{city:'toronto',crew:'ironlungs'})
 assert.equal(crewInvite('#toronto?crew=../admin').crew,null)
 const p=mercator(43.45,-80.49),ll=unproject(p.x,p.z)
 assert.ok(Math.abs(ll.lat-43.45)<1e-8);assert.ok(Math.abs(ll.lon+80.49)<1e-8)
 const halo=nearbyTiles(ll.lat,ll.lon);assert.ok(halo.includes(tileKey(ll.lat,ll.lon)));assert.ok(halo.length>9)
 const nearby=mercator(43.45,-80.44);assert.ok(spatialDistance(p,nearby)<5000)
 assert.ok(halo.includes(tileKey(43.45,-80.44)))
})
test('malformed or out-of-range telemetry is rejected',()=>{
 const good={id:'a',x:0,y:1,z:0,rotY:0,laneIndex:1,velocity:20,maskId:'oni',chassisId:'board',boost:false,seq:0}
 assert.equal(validTelemetry(good),true)
 for(const change of [{x:NaN},{laneIndex:3},{maskId:'rooster'},{velocity:Infinity},{seq:-1},{boost:'yes'}])assert.equal(validTelemetry({...good,...change}),false)
})
function fixture(){
 const city=proceduralCity('test',43.45,-80.49)
 return {city,hitBuilding:()=>-1,isWater:()=>false,groundHeightAt:()=>0} as unknown as World
}
test('holding a lane input advances only once; release enables next lane',()=>{
 const w=fixture(),p=new Player(vehicleById('board'),'balaclava');p.placeAtNode(w,0)
 const input={throttle:0,brake:0,steer:1,boost:false,up:false,down:false}
 for(let i=0;i<30;i++)p.update(1/60,input,w,true)
 assert.equal(p.laneIndex,0)
 p.update(1/60,{...input,steer:0},w,true);p.update(1/60,{...input,steer:-1},w,true);assert.equal(p.laneIndex,1)
})
test('highway circuit consists entirely of adjacent nodes and closes',()=>{
 const w=fixture(),path=highwayLoop(w,0);assert.ok(path.length>2)
 for(let i=0;i<path.length;i++)assert.ok(w.city.nodes[path[i]].adj.includes(path[(i+1)%path.length]))
})

test('high-speed corner breaks Mag-Lock and preserves motion',()=>{
 const city=proceduralCity('test',0,0)
 city.nodes=[{x:0,z:0,adj:[1],main:true},{x:0,z:20,adj:[0,2],main:true},{x:20,z:20,adj:[1],main:true}]
 const w={city,hitBuilding:()=>-1,isWater:()=>false,groundHeightAt:()=>0} as unknown as World
 const p=new Player(vehicleById('hovercedes'),'balaclava');p.placeAtNode(w,0);p.speed=60;p.edgeS=19
 p.update(0.05,{throttle:1,brake:0,steer:0,boost:false,up:false,down:false},w,true)
 assert.equal(p.mode,'free');assert.ok(p.vel.length()>40)
})
