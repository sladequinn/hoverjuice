import {wrapLon,type Presence} from '../shared/multiplayer'
export interface TimedPresence {state:Presence;received:number}
/** 150ms interpolation buffer, at most 150ms prediction, then hold/fade instead of drifting. */
export function samplePeer(history:TimedPresence[],now:number){
 if(!history.length)return null
 const target=now-150
 let a=history[0],b=history[0]
 for(const point of history){if(point.received<=target)a=point;if(point.received>=target){b=point;break}b=point}
 const t=b===a?0:Math.max(0,Math.min(1,(target-a.received)/(b.received-a.received)))
 const angle=(x:number,y:number)=>Math.atan2(Math.sin(y-x),Math.cos(y-x))
 const result={...a.state,lat:a.state.lat+(b.state.lat-a.state.lat)*t,lon:wrapLon(a.state.lon+wrapLon(b.state.lon-a.state.lon)*t),y:a.state.y+(b.state.y-a.state.y)*t,yaw:a.state.yaw+angle(a.state.yaw,b.state.yaw)*t}
 const last=history[history.length-1]
 if(target>last.received){const ahead=Math.min(.15,(target-last.received)/1000);result.lat=last.state.lat-last.state.vz*ahead/110540;result.lon=wrapLon(last.state.lon+last.state.vx*ahead/(111320*Math.max(.001,Math.cos(last.state.lat*Math.PI/180))));result.y=last.state.y;result.yaw=last.state.yaw}
 return result
}
