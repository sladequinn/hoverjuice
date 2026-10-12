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
 const traffic={}
 for(let i=0;i<1000;i++)spray.emit(traffic,.1,new Vector3(0,1.3,0),0,60,1,2,0,true,.45)
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


test('distance stamps leave a continuous persistent wake, and traffic preserves the player pool',()=>{
 const spray=new HoverjuiceSpray(),car={},pos=new Vector3(0,1.3,0)
 spray.emit(car,1/30,pos,0,60,1,2,0)
 for(let i=1;i<=30;i++){
  pos.z=i*2
  spray.emit(car,1/30,pos,0,60,1,2,0)
  spray.update(1/30)
 }
 const offsets=spray.mesh.geometry.attributes.offset.array,effects=spray.mesh.geometry.attributes.appearance.array
 const trail=[]
 for(let i=768;i<1152;i++)if(effects[i*4+1]>0)trail.push(offsets[i*3+2])
 trail.sort((a,b)=>a-b)
 assert.ok(trail.length>60,'Dense wake across the full 60m route')
 for(let i=1;i<trail.length;i++)assert.ok(trail[i]-trail[i-1]<1)
 const before=Array.from(offsets.slice(768*3,1152*3)),traffic={}
 for(let i=0;i<500;i++)spray.emit(traffic,.1,new Vector3(40,1.3,i),0,20,1,2,0,false,.45)
 assert.deepEqual(Array.from(offsets.slice(768*3,1152*3)),before)
 for(let i=0;i<120;i++)spray.update(1/60)
 assert.ok(spray.activeCount>0,'Liquid lingers after droplets have expired')
 for(let i=0;i<400;i++)spray.update(1/60)
 assert.equal(spray.activeCount,0)
 spray.dispose()
})

test('idle pools spread; teleporting and high flight do not draw connecting puddles',()=>{
 const spray=new HoverjuiceSpray(),car={},pos=new Vector3(0,1.3,0)
 for(let i=0;i<30;i++){spray.emit(car,1/60,pos,0,0,1,2,0);spray.update(1/60)}
 const effects=spray.mesh.geometry.attributes.appearance.array
 assert.ok(effects[768*4]>2.8,'Stationary liquid spreads beyond its initial footprint')
 spray.clear()
 spray.emit(car,.1,pos,0,60,1,2,0)
 pos.z=1000;spray.emit(car,.1,pos,0,60,1,2,0)
 const offsets=spray.mesh.geometry.attributes.offset.array
 for(let i=768;i<1536;i++)if(effects[i*4+1]>0)assert.ok(offsets[i*3+2]===0||offsets[i*3+2]===1000)
 spray.clear();pos.y=100
 for(let i=0;i<30;i++){pos.z+=2;spray.emit(car,1/30,pos,0,60,1,2,0)}
 for(let i=768;i<1536;i++)assert.equal(effects[i*4+1],0)
 spray.dispose()
})
