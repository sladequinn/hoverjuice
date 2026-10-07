import {test} from 'node:test'
import assert from 'node:assert/strict'
import {RunState,OVERCLOCK_SPEED} from '../src/dynamics'
import {buildingId,criminalEligible,protectedVenue} from '../src/filter'
import {crewInvite,mercator,unproject,tileKey,nearbyTiles,spatialDistance,validTelemetry} from '../src/spatial'
import {makeBuilding,proceduralCity} from '../src/map'
import {Player,buildVehicleMesh} from '../src/vehicle'
import {DealerSystem,SYNDICATE_LEADERS} from '../src/dealers'
import {vehicleById} from '../src/data'
import {highwayLoop} from '../src/campaign'
import {World} from '../src/world'

test('protected and unknown uses fail closed',()=>{
 for(const amenity of ['school','kindergarten','hospital','place_of_worship'])assert.equal(criminalEligible({amenity,shop:'convenience'}),false)
 for(const building of ['house','apartments','residential'])assert.equal(criminalEligible({building,amenity:'bar'}),false)
 assert.equal(criminalEligible({}),false)
 assert.equal(protectedVenue({subclass:'hospital'}),true)
 assert.equal(criminalEligible({building:'commercial',amenity:'bar'}),true)
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

test('high-speed corner assist keeps Mag-Lock and sheds speed',()=>{
 const city=proceduralCity('test',0,0)
 city.nodes=[{x:0,z:0,adj:[1],main:true},{x:0,z:20,adj:[0,2],main:true},{x:20,z:20,adj:[1],main:true}]
 const w={city,hitBuilding:()=>-1,isWater:()=>false,groundHeightAt:()=>0} as unknown as World
 const p=new Player(vehicleById('hovercedes'),'balaclava');p.placeAtNode(w,0);p.speed=60;p.edgeS=19
 p.update(0.05,{throttle:1,brake:0,steer:0,boost:false,up:false,down:false},w,true)
 assert.equal(p.mode,'mag');assert.equal(p.edgeB,2);assert.ok(p.speed<38)
})

test('streamed building batches retain collision indexing and stop when a city is disposed',async()=>{
 const city=proceduralCity('Streaming test',43.45,-80.49), world=new World(city)
 const append=()=>{
  const from=city.buildings.length
  for(let i=0;i<600;i++){
   const x=20000+(from+i)*20
   city.buildings.push(makeBuilding([[x,0],[x+10,0],[x+10,10],[x,10]],20)!)
  }
  return {buildingsFrom:from,roadsFrom:city.roads.length,tiles:1}
 }
 const delta=append()
 await world.appendMap(delta)
 const last=city.buildings.at(-1)!
 assert.equal(world.hitBuilding(last.cx,last.cz,1),city.buildings.length-1)
 const pending=world.appendMap(append())
 world.dispose()
 const count=world.group.children.length
 await pending
 assert.equal(world.group.children.length,count)
})

const neutral={throttle:0,brake:0,steer:0,boost:false,up:false,down:false}
function junctionFixture(){
 const w=fixture()
 w.city.nodes=[
  {x:0,z:0,adj:[1],main:true,width:7.5},
  {x:0,z:10,adj:[0,2],main:true,width:7.5},
  {x:0,z:20,adj:[1,3,4,5],main:true,width:7.5},
  {x:20,z:20,adj:[2],main:true,width:7.5},
  {x:-20,z:20,adj:[2],main:true,width:7.5},
  {x:0,z:40,adj:[2],main:true,width:7.5}]
 return w
}
test('both turn directions survive a released tap and intermediate map nodes',()=>{
 for(const steer of [-1,1]){
  const w=junctionFixture(),p=new Player(vehicleById('hovercedes'),'balaclava')
  p.placeAtNode(w,0);p.speed=26
  p.update(1/60,{...neutral,steer},w,true)
  assert.equal(p.nextTurn(w).dir,steer)
  for(let i=0;i<75 && p.edgeA!==2;i++)p.update(1/60,neutral,w,true)
  assert.equal(p.mode,'mag');assert.equal(p.edgeA,2);assert.equal(p.edgeB,steer===1?3:4)
 }
})
test('no turn request goes straight and lane offset fits a narrow road',()=>{
 const w=junctionFixture(),p=new Player(vehicleById('hovercedes'),'balaclava')
 p.placeAtNode(w,0);p.speed=26
 for(let i=0;i<75&&p.edgeA!==2;i++)p.update(1/60,neutral,w,true)
 assert.equal(p.edgeB,5)
 p.speed=0
 for(let i=0;i<30;i++)p.update(1/60,{...neutral,steer:1},w,true)
 assert.ok(Math.abs(p.sway)+p.mesh.userData.halfW<=Math.min(w.city.nodes[p.edgeA].width!,w.city.nodes[p.edgeB].width!)/2-.49)
})
test('lane overlap with a footprint recentres instead of ejecting',()=>{
 const w=junctionFixture();w.hitBuilding=(x)=>Math.abs(x)>0.5?0:-1
 const p=new Player(vehicleById('hovercedes'),'balaclava');p.placeAtNode(w,0)
 for(let i=0;i<12;i++)p.update(1/60,{...neutral,steer:1},w,true)
 assert.equal(p.mode,'mag');assert.equal(p.laneIndex,1);assert.ok(Math.abs(p.pos.x)<=0.5)
})
test('test flight climbs, holds, descends and returns to street height when disabled',()=>{
 const w=fixture(),p=new Player(vehicleById('board'),'balaclava');p.placeAtNode(w,0);p.unsnap();p.testFlight=true
 for(let i=0;i<120;i++)p.update(1/60,{...neutral,up:true},w,true)
 assert.ok(p.pos.y>30)
 const target=p.targetAlt
 for(let i=0;i<60;i++)p.update(1/60,neutral,w,true)
 assert.equal(p.targetAlt,target);assert.ok(p.pos.y>30)
 for(let i=0;i<60;i++)p.update(1/60,{...neutral,down:true},w,true)
 assert.ok(p.pos.y<30)
 p.testFlight=false
 for(let i=0;i<180;i++)p.update(1/60,neutral,w,true)
 assert.ok(p.pos.y<1.5)
})
test('enclosed vehicles have no cockpit head while boards keep their rider',()=>{
 const car=buildVehicleMesh(vehicleById('neonic'))
 assert.equal(car.getObjectByName('cockpit-mask'),undefined);assert.equal(car.getObjectByName('rider'),undefined)
 assert.ok(buildVehicleMesh(vehicleById('board')).getObjectByName('rider'))
})
test('four gang leaders trade from parked cars without kiosks or sign sprites',()=>{
 const w=new World(proceduralCity('Dealers',43.45,-80.49)),dealers=new DealerSystem(w)
 assert.deepEqual(dealers.dealers.map(d=>[d.gang,d.name]),SYNDICATE_LEADERS.map(d=>[d.gang,d.name]))
 dealers.refresh();assert.equal(dealers.group.children.length,4);assert.equal(dealers.dealers.length,4)
 dealers.group.traverse(o=>{assert.notEqual(o.type,'Sprite');assert.notEqual(o.name,'cockpit-mask')})
 for(const d of dealers.dealers)assert.ok(dealers.group.getObjectByName(`dealer-car-${d.gang}`))
 dealers.dispose();w.dispose()
})

test('vehicle batching preserves opaque chassis geometry for every vehicle class',()=>{
  // RoundedBoxGeometry is non-indexed while Box/Cylinder geometries are indexed.
  // An unnormalised merge silently discarded the complete compact chassis.
  for(const id of ['board','neonic','z150','hovercedes','goblin','hoverarrari','hoverghini']){
    const spec=vehicleById(id),mesh=buildVehicleMesh(spec)
    const body=mesh.children.find(child=>{
      const candidate=child as unknown as {material?:{color?:{getHex:()=>number}}}
      return candidate.material?.color?.getHex()===spec.body
    }) as unknown as {geometry?:{attributes:{position:{count:number}},computeBoundingBox:()=>void,boundingBox:{min:{y:number},max:{y:number}}}}
    assert.ok(body?.geometry,`Missing chassis for ${spec.id}`)
    assert.ok(body.geometry.attributes.position.count>30)
    body.geometry.computeBoundingBox()
    assert.ok(body.geometry.boundingBox.max.y>body.geometry.boundingBox.min.y)
  }
})

test('fallback city never generates inverted building heights at its outskirts',()=>{
  for(const building of proceduralCity('test',43.45,-80.49).buildings)assert.ok(building.height>=10)
})

test('scaled vehicle envelopes fit the minimum carriageway and shadows stay at ground level',()=>{
 for(const id of ['board','neonic','z150','hovercedes','hoverghini']){
  const w=fixture();w.city.nodes.forEach(n=>n.width=3.2)
  const p=new Player(vehicleById(id),'balaclava');p.placeAtNode(w,0)
  for(let i=0;i<60;i++)p.update(1/60,{...neutral,steer:1},w,true)
  assert.equal(p.mesh.scale.x,.75)
  assert.ok(Math.abs(p.sway)+p.mesh.userData.halfW<=1.6-.49)
  const pad=p.mesh.getObjectByName('pad')!
  assert.ok(Math.abs(p.pos.y+pad.position.y*p.mesh.scale.y-.15)<.001)
 }
})
