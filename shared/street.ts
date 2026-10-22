import {VEHICLES,vehicleById} from '../src/data'
import {buildFor,upgradeCost,type GarageBuilds} from '../src/customization'
import {districtBounds} from './crews'
import {seed} from './economy'
export const GOODS=[
 {id:'cyanade',name:'Cyan-ade',base:8500,unit:'vial'},
 {id:'neondust',name:'Neon Dust',base:21000,unit:'gram'},
 {id:'ghostchips',name:'Ghost Chips',base:54000,unit:'chip'},
 {id:'synthglands',name:'Synth Glands',base:125000,unit:'case'},
 {id:'blackice',name:'Black ICE',base:310000,unit:'shard'},
 {id:'sunblood',name:'Sunblood',base:720000,unit:'ampoule'},
] as const
export const MASK_CATALOG=[{id:'balaclava',price:0},{id:'glitcher',price:120000},{id:'respirator',price:250000},{id:'oni',price:600000},{id:'liar',price:400000},{id:'jester',price:400000}]
export const MISSIONS=[
 {id:'parcel',name:'Sealed parcel',client:'Nightline Dispatch',commodity:'ghostware',description:'A routine courier run. Collect at the depot and deliver the sealed package.',pace:18,grace:120,multiplier:1},
 {id:'express',name:'Organ express',client:'Halo Medical',commodity:'nightbloom',description:'A medical cooler on a tight deadline. Keep moving and hit every gate.',pace:25,grace:45,multiplier:1.35},
 {id:'precursor',name:'HJ-77 precursor',client:'SLADE',commodity:'glimmer',description:'Volatile precursor cargo. Lane impacts damage the shipment; three strikes lose it.',pace:21,grace:65,multiplier:1.2},
] as const
export interface StreetState {vehicles:string[];masks:string[];current:string;mask:string;builds:GarageBuilds;cargo:Record<string,number>;vault:Record<string,number>;travel:{lat:number;lon:number;at:number}|null}
export const starterState=():StreetState=>({vehicles:['board'],masks:['balaclava'],current:'board',mask:'balaclava',builds:{},cargo:{},vault:{},travel:null})
export const cargoCount=(s:StreetState)=>Object.values(s.cargo).reduce((n,q)=>n+q,0)
export const capacity=(s:StreetState)=>({board:8,compact:22,truck:70,luxury:36,super:24}[vehicleById(s.current).kind])
export const vehiclePrice=(id:string)=>Math.round(VEHICLES.find(v=>v.id===id)!.price*100)
export const performancePrice=(s:StreetState,id:'drive'|'handling'|'efficiency')=>upgradeCost(s.current,buildFor(s.builds,s.current)[id])*100
export function exchange(district:string){const {lat,lon}=districtBounds(district);return {lat,lon}}
/** Regional variation and hourly shocks are quoted by the server; every trade also moves stock. */
export function streetPrice(district:string,good:string,stock:number,at:number){
 const base=GOODS.find(g=>g.id===good)!.base,epoch=Math.floor(at/3600000),regional=.7+(seed(district+good)%91)/100,event=seed(district+good+epoch)%12
 const shock=event===0?1.8:event===1?.6:1,scarcity=Math.max(.7,Math.min(1.6,1+(80-stock)/160)),mid=Math.round(base*regional*shock*scarcity)
 return {ask:Math.ceil(mid*1.12),bid:Math.floor(mid*.78),event:event===0?'Supply shortage':event===1?'Street glut':'Steady supply'}
}
/** Average marginal price includes this order's stock impact, preventing buy/sell price pumping. */
export function streetOrderPrice(district:string,good:string,stock:number,side:'buy'|'sell',quantity:number,at:number){
 let total=0
 for(let i=0;i<quantity;i++){
  // A buy and its reverse sale traverse the same stock intervals.
  const level=side==='buy'?stock-i-1:stock+i
  const p=streetPrice(district,good,level,at);total+=side==='buy'?p.ask:p.bid
 }
 return side==='buy'?Math.ceil(total/quantity):Math.floor(total/quantity)
}
