import {test} from 'node:test'
import assert from 'node:assert/strict'
import {residential,houseOffer,distanceToHome,localHome} from '../src/housing'
import {makeBuilding,proceduralCity} from '../src/map'

test('residential purchases do not need criminal eligibility and exclude protected buildings',()=>{
 const c=proceduralCity('test',43.45,-80.49),b=makeBuilding([[0,0],[20,0],[20,20],[0,20]],8)!
 b.tags={building:'house'};b.eligible=false
 assert.equal(residential(b,c),true)
 for(const key of ['amenity','building','class','subclass']){b.tags={building:'house',[key]:'hospital'};assert.equal(residential(b,c),false)}
 b.tags={landuse:'residential'};assert.equal(residential(b,c),true)
 b.clipped=true;assert.equal(residential(b,c),false)
 b.clipped=false;b.tags={building:'warehouse',landuse:'residential'};assert.equal(residential(b,c),false)
})
test('home identity survives a change of city origin and uses footprint proximity',()=>{
 const c=proceduralCity('test',43.45,-80.49),b=makeBuilding([[0,0],[200,0],[200,200],[0,200]],8)!
 b.tags={building:'apartments'}
 const h=houseOffer(b,c),p=localHome(h,c)
 assert.ok(Math.abs(p.x-b.cx)<.001);assert.ok(Math.abs(p.z-b.cz)<.001)
 assert.equal(distanceToHome(205,100,b),5)
 assert.equal(distanceToHome(100,100,b),0)
 const c2={...c,lon:c.lon+.1},p2=localHome(h,c2)
 const shifted={...b,cx:p2.x,cz:p2.z}
 assert.equal(houseOffer(shifted,c2).id,h.id)
 assert.ok(h.price>=15000&&h.price<=2000000)
})
