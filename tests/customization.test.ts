import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBuilds,tunedVehicle,upgradeCost } from '../src/customization'
import {vehicleById} from '../src/data'
import {TrafficSystem} from '../src/traffic'
import {Vector3} from 'three'
import type {World} from '../src/world'

test('legacy and malformed customization is normalized; tuning never mutates stock',()=>{
 assert.deepEqual(normalizeBuilds(undefined),{})
 const builds=normalizeBuilds({neonic:{paint:'rust',drive:99,handling:-1,efficiency:NaN},bogus:{drive:3}})
 assert.deepEqual(builds,{neonic:{paint:'rust',drive:3,handling:0,efficiency:0}})
 const base=vehicleById('neonic'),stock=base.maxSpeed,v=tunedVehicle('neonic',builds)
 assert.equal(v.body,0x874c3f);assert.equal(v.maxSpeed,stock*1.24);assert.equal(base.maxSpeed,stock)
 const efficient=tunedVehicle('neonic',{neonic:{drive:0,handling:3,efficiency:3}})
 assert.ok(efficient.tank>base.tank&&efficient.burn<base.burn&&efficient.evap<base.evap)
 assert.ok(efficient.turn>base.turn&&efficient.drift<base.drift)
 assert.equal(upgradeCost('neonic',2),upgradeCost('neonic',0)*3)
})
test('dense traffic stays within fleet capacity and uses varied instance colors',()=>{
 const nodes=Array.from({length:8000},(_,i)=>({x:i%100*20,z:Math.floor(i/100)*20,y:0,main:true,width:7,adj:[(i+1)%8000]}))
 const traffic=new TrafficSystem({city:{nodes}} as unknown as World)
 traffic.update(1/60,new Vector3())
 const fleets=traffic.group.children as import('three').InstancedMesh[]
 assert.equal(fleets.reduce((sum,m)=>sum+m.count,0),192)
 assert.ok(fleets.every(m=>m.count<=m.instanceMatrix.count&&m.instanceColor))
 assert.ok(new Set(Array.from(fleets[0].instanceColor!.array)).size>3)
 traffic.dispose()
})
