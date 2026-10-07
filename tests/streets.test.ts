import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fitStreetWidths,streetJunctions,streetCorner,streetKey} from '../src/streets'
import {makeBuilding,proceduralCity,type Road} from '../src/map'

test('ordinary bends and separately tiled continuations share both sidewalk edges',()=>{
 const roads:Road[]=[{pts:[[0,0],[0,10]],width:5,major:false},{pts:[[0,10],[10,20]],width:5,major:false}]
 const j=streetJunctions(roads).get(streetKey([0,10]))!
 assert.equal(j.length,2)
 for(const side of [-1,1])for(const radius of [2.5,3.6]){
  const incoming=streetCorner([0,10],0,0,1,radius,side,j,false)
  const outgoing=streetCorner([0,10],0,Math.SQRT1_2,Math.SQRT1_2,radius,side,j,true)
  assert.ok(Math.hypot(incoming[0]-outgoing[0],incoming[1]-outgoing[1])<1e-8)
 }
})
test('tight building corridor constrains pavement and driving widths together',()=>{
 const city=proceduralCity('test',43.45,-80.49)
 city.roads=[{pts:[[0,0],[0,20]],width:6.5,major:true}]
 city.nodes=[{x:0,z:0,main:true,adj:[1]},{x:0,z:20,main:true,adj:[0]}]
 city.buildings=[makeBuilding([[3,-2],[10,-2],[10,22],[3,22]],12)!]
 fitStreetWidths(city)
 const r=city.roads[0]
 assert.ok(r.width/2+r.sidewalkWidth!<=2.75)
 assert.equal(city.nodes[0].width,r.width)
 assert.ok(r.sidewalkWidth!>0)
 // A new tile can constrain an already-rendered road. Re-fitting must not compound scaling.
 const first=r.width;fitStreetWidths(city);assert.equal(r.width,first)
 city.buildings=[makeBuilding([[2.2,-2],[10,-2],[10,22],[2.2,22]],12)!]
 fitStreetWidths(city);assert.ok(r.width/2+r.sidewalkWidth!<=1.95+1e-8)
})
test('only real intersections have three or more incident branches',()=>{
 const roads:Road[]=[{pts:[[0,0],[0,10],[0,20]],width:5,major:false},{pts:[[0,10],[10,10]],width:3.5,major:false}]
 const junctions=streetJunctions(roads)
 assert.equal(junctions.get(streetKey([0,10]))!.length,3)
 assert.equal(junctions.get(streetKey([0,0]))!.length,1)
})
