import { vehicleById, VEHICLES } from './data'

export const PAINTS = [
 {id:'steel',name:'Steel blue',color:0x596f80}, {id:'bone',name:'Bone white',color:0xb7b5a7},
 {id:'rust',name:'Oxide red',color:0x874c3f}, {id:'olive',name:'Army olive',color:0x667052},
 {id:'amber',name:'Taxi ochre',color:0xb38b38}, {id:'violet',name:'Syndicate violet',color:0x743e78},
 {id:'petrol',name:'Petrol teal',color:0x367976}, {id:'graphite',name:'Graphite',color:0x505660},
]
export const UPGRADES = [
 {id:'drive',name:'Repulsor drive',description:'+8% top speed and +12% acceleration per stage'},
 {id:'handling',name:'Vector control',description:'+10% steering response and less sideways drift per stage'},
 {id:'efficiency',name:'Sealed fuel system',description:'+15% tank capacity and −10% consumption per stage'},
] as const
export type Upgrade = typeof UPGRADES[number]['id']
export interface Customization { paint?:string; drive:number; handling:number; efficiency:number }
export type GarageBuilds = Record<string,Customization>
export function normalizeBuilds(raw:unknown):GarageBuilds {
 const result:GarageBuilds={}
 if(!raw||typeof raw!=='object')return result
 for(const v of VEHICLES){
  const b=(raw as Record<string,unknown>)[v.id]
  if(!b||typeof b!=='object')continue
  const data=b as Record<string,unknown>,level=(key:string)=>typeof data[key]==='number'&&Number.isFinite(data[key])?Math.max(0,Math.min(3,Math.floor(data[key] as number))):0
  result[v.id]={paint:PAINTS.find(p=>p.id===data.paint)?.id,drive:level('drive'),handling:level('handling'),efficiency:level('efficiency')}
 }
 return result
}
export function buildFor(builds:GarageBuilds,id:string):Customization {return builds[id]??{drive:0,handling:0,efficiency:0}}
export function tunedVehicle(id:string,builds:GarageBuilds){
 const base=vehicleById(id),b=buildFor(builds,id)
 return {...base,body:PAINTS.find(p=>p.id===b.paint)?.color??base.body,
  maxSpeed:base.maxSpeed*(1+.08*b.drive),accel:base.accel*(1+.12*b.drive),
  turn:base.turn*(1+.1*b.handling),drift:base.drift*(1-.12*b.handling),
  tank:Math.round(base.tank*(1+.15*b.efficiency)),burn:base.burn*(1-.1*b.efficiency),evap:base.evap*(1-.1*b.efficiency)}
}
export function upgradeCost(id:string,level:number){return Math.round(Math.max(500,vehicleById(id).price*.12)*(level+1))}
