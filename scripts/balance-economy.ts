import assert from 'node:assert/strict'
import {COMMODITIES,baseline,price,freightReward,BUDGET,MAX_DAILY} from '../shared/economy'
import {districtFor} from '../shared/crews'
const scenarios=[]
for(const commodity of COMMODITIES){let min=Infinity,max=0
 for(let i=0;i<100;i++){const district=districtFor({lat:-60+i*1.2,lon:-170+i*3.4});for(const stock of [0,baseline(district,commodity.id),500])for(const pressure of [0,100]){const p=price(district,commodity.id,stock,pressure);assert.ok(p>=commodity.base*.425-1&&p<=commodity.base*2.875+1);min=Math.min(min,p);max=Math.max(max,p)}}
 scenarios.push({commodity:commodity.id,minHG:min/100,maxHG:max/100})
}
const normal=freightReward(2200,12000,14000,4),maximum=freightReward(6000,1000,1000000,6,true,true)
assert.ok(maximum.gross<=20000&&maximum.fee>=maximum.gross*.09-1)
assert.equal(BUDGET-(normal.net+normal.fee)*1000,BUDGET-normal.gross*1000)
console.log(JSON.stringify({version:1,currency:'HG (100 minor units)',prices:scenarios,ordinaryDelivery:normal,maxDelivery:maximum,accountDailyNetCeilingHG:maximum.net*MAX_DAILY/100,globalReserveHG:BUDGET/100,ordinaryDeliveriesUntilExhaustion:Math.floor(BUDGET/normal.gross),note:'No recurring monetary refill. Reserve exhaustion pauses new contracts; stock recovery does not mint currency.'},null,2))
