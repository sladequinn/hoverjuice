import test from 'node:test'
import assert from 'node:assert/strict'
import {TerrainField,decodeTerrarium,demPixel} from '../src/terrain'
import {MapStreamer,proceduralCity,makeBuilding} from '../src/map'
import {World} from '../src/world'
import {SurfaceIndex} from '../src/surfaces'
function slope(){
 const field=new TerrainField(43.45,-80.49)
 for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++){
  const data=new Float32Array(4225)
  for(let j=0;j<65;j++)for(let i=0;i<65;i++)data[j*65+i]=100+(x*2048+i*32)*.1+(z*2048+j*32)*.05
  field.patches.set(`${x},${z}`,data)
 }
 return field
}
test('Terrarium decoder preserves metres, negative elevations and fractional precision',()=>{
 assert.equal(decodeTerrarium(128,0,0),0);assert.equal(decodeTerrarium(127,255,128),-.5)
 assert.equal(decodeTerrarium(129,44,64),300.25);assert.equal(demPixel(0,0).x,524287.5)
})
test('sampled terrain agrees with rendered triangle planes across patch boundaries',()=>{
 const f=slope()
 for(const x of [-.001,0,2047.999,2048,2048.001])assert.ok(Math.abs(f.heightAt(x,121)-(100+x*.1+121*.05))<.0001)
 const city=proceduralCity('slope',43.45,-80.49);city.terrain=f;city.buildings=[];city.roads=[];city.nodes=[];city.waters=[];city.venues=[]
 const w=new World(city),index=new SurfaceIndex()
 const patch=w.group.children.find(o=>o.name==='terrain-elevation') as any
 const g=patch.geometry.toNonIndexed();index.add(Array.from(g.attributes.position.array));g.dispose()
 assert.ok(Math.abs(index.heightAt(-1000,-1000,-50,0)-(f.heightAt(-1000,-1000)-.025))<.001)
 w.dispose()
})
test('road ingestion adds terrain below bridge/tunnel offsets and keeps graph elevations aligned',()=>{
 const city=proceduralCity('slope',43.45,-80.49);city.terrain=slope();city.roads=[];city.nodes=[]
 const stream=new MapStreamer(city,'unused') as any
 const line=[[-80.49,43.45],[-80.487,43.45]]
 for(const tags of [{},{bridge:'yes',layer:1},{tunnel:'yes'}])stream.addRoad(line,6,true,tags)
 for(const road of city.roads){
  assert.ok(road.pts.length>6)
  road.pts.forEach(([x,z],i)=>{
   const offset=road.heights![i]-city.terrain!.heightAt(x,z)
   assert.ok(road.bridge?offset>=0&&offset<=5:road.tunnel?offset<=0&&offset>=-4:Math.abs(offset)<1e-8)
   assert.ok(city.nodes.some(n=>Math.hypot(n.x-x,n.z-z)<.001&&Math.abs(n.y!-road.heights![i])<.001))
  })
 }
 const b=makeBuilding([[10,10],[20,10],[20,20],[10,20]],12)!
 city.buildings=[b];city.waters=[];city.venues=[]
 const w=new World(city)
 assert.ok(b.base!>100);assert.equal(w.hitBuilding(15,15,b.base!+2),0);assert.equal(w.hitBuilding(15,15,1),-1)
 assert.ok(w.groundHeightAt(80,0,110)>100)
 assert.equal(w.isTunnel(80,0,city.terrain.heightAt(80,0)-2.7),true)
 w.dispose()
})
test('unavailable initial DEM stays flat for the session and aborts do not disable terrain',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('offline')}
 try{
  const f=new TerrainField(43.45,-80.49);await f.ensure(-10,-10,10,10);assert.equal(f.enabled,false);assert.equal(f.heightAt(0,0),0)
  const g=new TerrainField(43.45,-80.49),controller=new AbortController();controller.abort()
  await assert.rejects(g.ensure(-10,-10,10,10,controller.signal));assert.equal(g.enabled,true)
 }finally{globalThis.fetch=original}
})
