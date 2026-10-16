import test from 'node:test'
import assert from 'node:assert/strict'
import {Vector3} from 'three'
import {CityLife,IncidentMemory,landMood,routine,solarHour} from '../src/city-life'
import {TrafficSystem,localTrip} from '../src/traffic'
import type {World} from '../src/world'
function fixture(landuse='commercial',count=100){const nodes=Array.from({length:count},(_,i)=>({x:(i%10)*35,z:Math.floor(i/10)*35,y:0,width:6,main:true,adj:[] as number[]}));for(let i=0;i<count;i++){if(i%10<9&&i+1<count)nodes[i].adj.push(i+1);if(i%10>0)nodes[i].adj.push(i-1);if(i+10<count)nodes[i].adj.push(i+10);if(i>=10)nodes[i].adj.push(i-10)}return {city:{lat:43.45,lon:-80.49,nodes,zones:[{tags:{landuse},poly:[[-100,-100],[500,-100],[500,500],[-100,500]]}],venues:[],terrain:{heightAt:()=>0}},pumps:[],isWater:()=>false,hitBuilding:()=>-1} as unknown as World}
const player=new Vector3(0,1,0),noon=Date.UTC(2026,9,15,17)
function ticks(life:CityLife,n=100,p=player,speed=0,heat=0){for(let i=0;i<n;i++)life.update(.1,p,speed,heat,noon+i*100)}
test('real land use and longitude-based routines distinguish neighbourhoods without hardcoded cities',()=>{
 assert.equal(landMood({landuse:'industrial'}),'industrial');assert.equal(landMood({amenity:'nightclub'}),'nightlife');assert.equal(landMood({shop:'retail'}),'commercial');assert.equal(solarHour(180,Date.UTC(2026,0,1,18)),6)
 assert.ok(routine('commercial',12).walkers>routine('industrial',12).walkers);assert.ok(routine('nightlife',23).walkers>routine('nightlife',12).walkers)
 for(const mood of ['residential','commercial','industrial']){const life=new CityLife(fixture(mood));ticks(life,15);assert.equal(life.mood,mood);assert.ok(life.stats.walkers<=24);life.dispose()}
})
test('walkers are pooled, stay on validated sidewalk segments, pause and avoid unsafe terrain',()=>{
 const world=fixture(),life=new CityLife(world);ticks(life);assert.ok(life.stats.walkers>0);assert.equal(life.group.children.length,1)
 const state=life as any,before=state.walkers.map((w:any)=>w.t);life.update(0,player,40,4);assert.deepEqual(state.walkers.map((w:any)=>w.t),before)
 for(const w of state.walkers){assert.ok(w.t>=0&&w.t<=1);assert.ok(w.a.x!==0||w.a.z!==0)}
 const capacity=life.stats.walkers;ticks(life,100,player,35,3);assert.ok(life.stats.walkers<=24);assert.ok(capacity>0);assert.ok(life.stats.roadChecks<=12);assert.ok(life.stats.zoneChecks<=32)
 for(const block of ['water','building','elevation']){const w=fixture();if(block==='water')w.isWater=()=>true;else if(block==='building')w.hitBuilding=()=>0;else w.city.terrain!.heightAt=()=>20;const l=new CityLife(w);ticks(l);assert.equal(l.stats.walkers,0);l.dispose()}
 life.dispose();assert.equal(life.group.children.length,0)
})
test('local incident history survives reload, is bounded and storage failure cannot stop cruising',()=>{
 let raw='{}';const storage={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v}},memory=new IncidentMemory(storage)
 memory.mark('street',noon);assert.equal(new IncidentMemory(storage).available('street',noon+1000),false);assert.equal(memory.available('street',noon+600001),true)
 for(let i=0;i<100;i++)memory.mark('street'+i,noon+i);assert.equal(Object.keys(JSON.parse(raw)).length,64)
 const broken=new IncidentMemory({getItem:()=>'{',setItem:()=>{throw Error('quota')}});assert.doesNotThrow(()=>broken.mark('x',noon))
})
test('incidents emerge while cruising, expire without a mission, and roadside assistance clears a breakdown',()=>{
 const life=new CityLife(fixture('industrial'));ticks(life,210);assert.equal(life.incident?.kind,'delivery');assert.match(life.incident!.announcement!,/delivery/)
 life.incident={id:'help',kind:'breakdown',engaged:true,x:0,z:0,remaining:30};ticks(life,35);assert.equal(life.incident?.helped,true);assert.match(life.notice,/thanks/);ticks(life,50);assert.equal(life.incident,null);life.dispose()
})
test('server-derived crew context changes ambience without mutating ownership or producing currency',()=>{
 const life=new CityLife(fixture());life.context={gang:'LIARS',reputation:20,friendlyControl:true,contested:true,crewColor:'#73ffcb'};ticks(life,210);assert.match(life.label,/Crew regulars/);assert.equal(life.incident?.kind,'patrol');assert.ok(!('reward' in life.incident!));life.dispose()
})
test('actual traffic responds to a breakdown then resumes, with no new fleet allocations',()=>{
 const world=fixture(),life=new CityLife(world),traffic=new TrafficSystem(world);traffic.setLife(life);const state=traffic as any,car=state.agents[0];state.agents=[car];car.a=0;car.b=1;car.distance=10;car.speed=12;traffic.update(0,player)
 life.incident={id:'break',kind:'breakdown',x:car.pos.x,z:car.pos.z,remaining:30};for(let i=0;i<50;i++)traffic.update(.1,player);assert.ok(car.speed<.1);assert.equal(state.agents.length,1)
 life.incident=null;for(let i=0;i<50;i++)traffic.update(.1,player);assert.ok(car.speed>2);assert.equal(traffic.group.children.length,3);traffic.dispose();life.dispose()
})
test('large-map incremental simulation holds fixed budgets and population',()=>{
 const life=new CityLife(fixture('commercial',10000));ticks(life,1000);assert.ok(life.stats.roadChecks<=12);assert.ok(life.stats.zoneChecks<=32);assert.ok(life.stats.walkers<=24);life.dispose()
})

test('destination trips follow connected roads and decline disconnected or excessive routes',()=>{
 const world=fixture();const path=localTrip(world.city.nodes,0,99)!;assert.equal(path[0],0);assert.equal(path.at(-1),99);for(let i=1;i<path.length;i++)assert.ok(world.city.nodes[path[i-1]].adj.includes(path[i]));assert.equal(localTrip(world.city.nodes,0,99,3),null);assert.equal(localTrip(world.city.nodes,0,500),null)
})
test('one cruising session changes neighbourhood routines and does not retain the previous mood',()=>{
 const world=fixture();world.city.zones=['residential','commercial','industrial'].map((landuse,i)=>({tags:{landuse},gang:'LIARS' as const,poly:[[i*400-50,-50],[i*400+300,-50],[i*400+300,300],[i*400-50,300]]}));const life=new CityLife(world)
 for(const [i,mood]of ['residential','commercial','industrial'].entries()){ticks(life,20,new Vector3(i*400,1,0));assert.equal(life.mood,mood)}life.dispose()
})
