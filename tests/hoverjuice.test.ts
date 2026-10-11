import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { HoverjuiceSpray } from '../src/hoverjuice'

test('spray emission is time based, bounded, and freezes when paused',()=>{
 const counts=[]
 for(const fps of [30,60,120]){
  const spray=new HoverjuiceSpray(), car={}
  for(let i=0;i<fps;i++)spray.emit(car,1/fps,new Vector3(0,1.3,0),0,30,1,2,0)
  counts.push(spray.activeCount)
  spray.dispose()
 }
 assert.ok(Math.max(...counts)-Math.min(...counts)<=1)
 const spray=new HoverjuiceSpray(), car={}
 for(let i=0;i<1000;i++)spray.emit(car,.1,new Vector3(0,1.3,0),0,60,1,2,0,true)
 assert.equal(spray.activeCount,spray.capacity)
 const before=Array.from(spray.mesh.geometry.attributes.offset.array)
 spray.update(0)
 assert.deepEqual(Array.from(spray.mesh.geometry.attributes.offset.array),before)
 spray.clear();assert.equal(spray.activeCount,0)
 assert.ok(Array.from(spray.mesh.geometry.attributes.appearance.array).every(n=>n===0))
 spray.dispose()
})

test('droplets land on the supplied bridge deck and fade; airborne spray expires',()=>{
 const spray=new HoverjuiceSpray(),car={}
 spray.emit(car,.1,new Vector3(0,6.3,0),0,30,1,2,5)
 for(let i=0;i<21;i++)spray.update(1/60)
 const effect=spray.mesh.geometry.attributes.appearance.array
 const offset=spray.mesh.geometry.attributes.offset.array
 assert.ok(Array.from(effect).some((n,i)=>i%4===2&&n===1))
 for(let i=0;i<spray.capacity;i++)if(effect[i*4+2]===1)assert.ok(Math.abs(offset[i*3+1]-5.055)<.001)
 for(let i=0;i<120;i++)spray.update(1/60)
 assert.equal(spray.activeCount,0)
 spray.emit(car,.1,new Vector3(0,100,0),0,30,1,2,0)
 for(let i=0;i<60;i++)spray.update(1/60)
 assert.equal(spray.activeCount,0)
 spray.dispose()
})
