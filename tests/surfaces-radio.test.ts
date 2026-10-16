import test from 'node:test'
import assert from 'node:assert/strict'
import {SurfaceIndex} from '../src/surfaces'
import {HoverjuiceSpray} from '../src/hoverjuice'
import {Vector3} from 'three'
import {VEHICLE_SCALE} from '../src/data'
import {laneOffset,ROAD_MARKINGS} from '../src/streets'
import {parseRadioConfig,scannerLine,STATIONS} from '../src/radio-config'
import api from '../server/api'
const quad=(x:number,z:number,w:number,l:number,y:number,slope=0)=>[x,y,z,x+w,y,z,x+w,y+slope,z+l,x,y,z,x+w,y+slope,z+l,x,y+slope,z+l]
test('rendered surfaces distinguish roads, raised sidewalks, ramps and stacked decks',()=>{
 const index=new SurfaceIndex();index.add(quad(-3,0,6,20,.05));index.add(quad(3,0,1.1,20,.2));index.add(quad(-3,30,6,20,5.05,2))
 index.add(quad(-3,0,6,20,5.05))
 assert.equal(index.heightAt(0,10,0,0),.05);assert.equal(index.heightAt(3.5,10,0,0),.2)
 assert.equal(index.heightAt(6,10,0,0),0);assert.equal(index.heightAt(0,10,5,0),5.05)
 assert.equal(index.heightAt(0,40,6,0),6.05)
 const spray=new HoverjuiceSpray();spray.surfaceHeight=(x,z,y)=>index.heightAt(x,z,y,0)
 const key={};for(let i=0;i<12;i++){spray.emit(key,1/60,new Vector3(0,1.3,10),0,0,1,2,0);spray.update(1/60)}
 for(let vertex=0;vertex<25;vertex++)assert.ok(Math.abs(spray.mesh.geometry.attributes['surface'+Math.floor(vertex/4)].array[768*4+vertex%4]-.075)<.001)
 spray.clear();for(let i=0;i<12;i++){spray.emit(key,1/60,new Vector3(3.55,1.5,10),0,0,.2,.4,.2);spray.update(1/60)}
 assert.ok(Math.abs(spray.mesh.geometry.attributes.surface3.array[768*4]-.225)<.001)
 spray.dispose()
})
test('vehicle and road marking scales leave clearance on narrow carriageways',()=>{
 assert.equal(VEHICLE_SCALE,.55)
 assert.ok(2*1.3*VEHICLE_SCALE<1.5)
 for(const width of [3.2,5,7,10])assert.ok(laneOffset(width)+1.12*VEHICLE_SCALE<width/2)
 assert.ok(ROAD_MARKINGS.dash<2.3&&ROAD_MARKINGS.paintWidth<.07&&ROAD_MARKINGS.railWidth<.05)
})
test('radio configuration rejects unsafe URLs and scanner follows Heat',async()=>{
 assert.equal(STATIONS.length,6)
 const config=parseRadioConfig({shinobi:[{title:'Song',url:'https://audio.example/a.mp3'},{url:'javascript:alert(1)'},{url:'https://user:password@audio.example/a.mp3'}],police:[{url:'https://a.example'}]})
 assert.equal(config.shinobi.length,1);assert.equal(config.police,undefined)
 assert.match(scannerLine(3,120,'LIARS',0),/LIARS.*120.*No confirmed pursuit/)
 assert.match(scannerLine(0,0,'SHINOBI',0),/No confirmed pursuit/)
 const env={ALLOWED_ORIGIN:'https://slade.ninja',RADIO_CONFIG_JSON:JSON.stringify(config)} as any
 const res=await api.fetch(new Request('https://api.example/api/radio'),env)
 assert.equal(res.status,200);assert.deepEqual(await res.json(),config)
 const broken=await api.fetch(new Request('https://api.example/api/radio'),{...env,RADIO_CONFIG_JSON:'invalid'})
 assert.equal(broken.status,503)
})
