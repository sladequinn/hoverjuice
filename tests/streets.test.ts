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

// Actual MVT-style topology: a road crosses another line without a shared endpoint.
import {PavementLayout,inPavement,appendPavement,subtractPavement} from '../src/pavement'
test('pavement is clipped at an un-noded T junction, with no duplicate tile surface',()=>{
 const city=proceduralCity('test',43.45,-80.49)
 city.buildings=[]
 city.roads=[{pts:[[-20,0],[20,0]],width:5,major:false},{pts:[[0,0],[0,20]],width:5,major:false}]
 const layout=new PavementLayout(city),strip:[number,number][]=[[-20,2.5],[20,2.5],[20,3.6],[-20,3.6]]
 const result=layout.cut(strip,0)
 assert.equal(inPavement([0,3],result),false,'sidewalk must not close the mouth of the side street')
 assert.equal(inPavement([10,3],result),true)
 assert.equal(layout.cut(strip,0).length,0,'repeated tile feature must not render twice')
 const roadMask:[number,number][][]=[[[ -2.5,0],[2.5,0],[2.5,20],[-2.5,20]]]
 assert.deepEqual(result.flatMap(p=>subtractPavement(p,[roadMask])),result)
 const vertices:number[]=[];appendPavement(vertices,result,()=>0)
 assert.ok(vertices.length>0);assert.ok(vertices.every(Number.isFinite))
})
test('streetlights require a full footplate on surviving pavement and minimum spacing',()=>{
 const city=proceduralCity('test',43.45,-80.49);city.buildings=[];city.roads=[{pts:[[-40,0],[40,0]],width:5,major:false}]
 const layout=new PavementLayout(city),polygons=layout.cut([[-40,2.5],[40,2.5],[40,3.6],[-40,3.6]],0)
 assert.equal(layout.addLamp({x:0,z:0,y:0,heading:0},polygons),false)
 assert.equal(layout.addLamp({x:0,z:3,y:0,heading:0},polygons),true)
 assert.equal(layout.addLamp({x:10,z:3,y:0,heading:0},polygons),false)
 assert.equal(layout.addLamp({x:32,z:3,y:0,heading:0},polygons),true)
})
test('clipped pavement preserves holes around building footprints',()=>{
 const city=proceduralCity('test',43.45,-80.49);city.roads=[]
 city.buildings=[makeBuilding([[2,2],[6,2],[6,6],[2,6]],10)!]
 const layout=new PavementLayout(city),result=layout.cut([[0,0],[8,0],[8,8],[0,8]],0)
 assert.equal(inPavement([3,3],result),false);assert.equal(inPavement([1,1],result),true)
 const vertices:number[]=[];appendPavement(vertices,result,()=>0);assert.ok(vertices.every(Number.isFinite))
})

import {readFileSync} from 'node:fs'
import {World} from '../src/world'
test('captured Kitchener tile junctions build finite pavement and spaced streetlights',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/kitchener-pavement.json',import.meta.url),'utf8'))
 const city=proceduralCity('Kitchener regression',fixture.lat,fixture.lon)
 city.roads=fixture.roads;city.nodes=[];city.buildings=fixture.buildings.map((b:{poly:[number,number][];height:number})=>makeBuilding(b.poly,b.height)).filter(Boolean)
 city.waters=[];city.venues=[];city.landmarks=[];city.zones=[]
 const world=new World(city),sidewalk=world.group.getObjectByName('sidewalks') as import('three').Mesh
 const terrain=world.group.getObjectByName('terrain-backdrop') as import('three').Mesh
 assert.equal((terrain.material as import('three').Material).depthWrite,false)
 const poles=world.group.getObjectByName('streetlight-poles') as import('three').InstancedMesh
 assert.ok(poles.count>0)
 const matrices=poles.instanceMatrix.array
 for(let i=0;i<poles.count;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(matrices[i*16+12]-matrices[j*16+12],matrices[i*16+14]-matrices[j*16+14])>21.99)
 assert.ok(sidewalk,'actual MVT junction fixture should retain pavement')
 assert.ok(sidewalk.geometry.getAttribute('position').count>30)
 assert.ok(Array.from(sidewalk.geometry.getAttribute('position').array).every(Number.isFinite))
 world.dispose()
})
