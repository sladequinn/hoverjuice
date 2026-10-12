export const STATIONS = [
 {id:'shinobi',name:'SHINOBI FM',host:'SLADE'},
 {id:'liars',name:'WHITE NOISE',host:'WHITE LIE · LIARS'},
 {id:'hyenas',name:'PACK RADIO',host:'FASA · HYENAS'},
 {id:'jesters',name:'LAST LAUGH',host:'FRECKLES · JESTERS'},
 {id:'police',name:'POLICE SCANNER',host:'Municipal dispatch'},
 {id:'talk',name:'DEAD AIR',host:'After-hours talk'},
] as const
export interface RadioTrack {title:string;url:string}
export type RadioConfig=Record<string,RadioTrack[]>
/** Public direct audio URLs only; never treat station configuration as HTML. */
export function parseRadioConfig(raw:unknown):RadioConfig{
 const result:RadioConfig={}
 if(!raw||typeof raw!=='object')return result
 for(const station of STATIONS){
  if(station.id==='police')continue
  const rows=(raw as Record<string,unknown>)[station.id]
  if(!Array.isArray(rows))continue
  result[station.id]=rows.slice(0,100).flatMap(row=>{
   if(!row||typeof row!=='object'||typeof row.url!=='string')return []
   try{const url=new URL(row.url);if(url.protocol!=='https:'||url.username||url.password)return []
    return [{url:url.href,title:typeof row.title==='string'?row.title.slice(0,120):station.name}]
   }catch{return []}
  })
 }
 return result
}
export function scannerLine(heat:number,speed:number,gang:string,sequence:number){
 const lines=heat>=2?[
  `All units, active pursuit in ${gang} territory. Suspect moving at ${Math.round(speed)} kilometres per hour.`,
  'Interceptors, close the next junction. Keep the civilian lanes clear.',
  'Dispatch to pursuit units. Maintain visual contact. Watch for turquoise propellant.',
 ]:heat>0?[
  `Patrol advisory. Suspicious hover vehicle reported in ${gang} territory.`,
  'Unit seven, check the service roads. Possible unregistered cargo transfer.',
 ]:[
  `Dispatch, routine patrol through ${gang} territory. No active pursuit.`,
  'Unit twelve, abandoned freight rig reported. Recovery team requested.',
  'All units, road surface is wet. Give couriers room at intersections.',
 ]
 return lines[sequence%lines.length]
}
