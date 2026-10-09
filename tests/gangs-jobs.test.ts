import {test} from 'node:test'
import assert from 'node:assert/strict'
import {jobPair} from '../src/jobs'
import {Territories} from '../src/gangs'
import {proceduralCity} from '../src/map'
import {localHome} from '../src/housing'
import {RunState} from '../src/dynamics'
test('normal jobs have long routes and separated pickup sites without cramped fallbacks',()=>{
 const nodes=[]
 for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)nodes.push({x:x*1000,z:z*1000,main:true,adj:[]})
 const pool=nodes.map((_,i)=>i),used:number[]=[]
 for(let i=0;i<4;i++){
  const p=jobPair(nodes,pool,0,0,used);assert.ok(p)
  assert.ok(p.dist>=1600&&p.dist<=5000)
  for(const n of used)assert.ok(Math.hypot(nodes[n].x-nodes[p.from].x,nodes[n].z-nodes[p.from].z)>=900)
  used.push(p.from)
 }
 assert.equal(jobPair(nodes,[24],0,0,[]),null)
})
test('mapped landuse overrides stable geographic gang districts',()=>{
 const c=proceduralCity('test',43.45,-80.49);c.zones=[]
 const point={lat:43.454321,lon:-80.48765},a=localHome(point,c)
 const other={...c,lat:43.6,lon:-80.7},b=localHome(point,other)
 assert.equal(new Territories(c).at(a.x,a.z),new Territories(other).at(b.x,b.z))
 const poly:[number,number][]=[[-100,-100],[100,-100],[100,100],[-100,100]]
 for(const [landuse,gang] of [['industrial','LIARS'],['residential','HYENAS'],['retail','JESTERS'],['commercial','SHINOBI']] as const){
  c.zones=[{poly,tags:{landuse},gang}];assert.equal(new Territories(c).at(0,0),gang)
 }
 c.zones.push({poly:[[-10,-10],[10,-10],[10,10],[-10,10]],tags:{landuse:'retail'},gang:'JESTERS'})
 assert.equal(new Territories(c).at(0,0),'JESTERS')
})
test('rival territory increases cargo Heat and the balaclava reduces the penalty',()=>{
 const own=new RunState(),rival=new RunState(),masked=new RunState()
 own.update(10,4,false,false,false);rival.update(10,4,false,true,false);masked.update(10,4,false,true,true)
 assert.ok(rival.heat>masked.heat&&masked.heat>own.heat)
})
