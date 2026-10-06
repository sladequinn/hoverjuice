import type * as Party from 'partykit/server'
import { spatialDistance, tileKey, unproject, validTelemetry } from '../src/spatial'
interface ClientState {view?:{x:number;z:number}; last?:number; seq?:number; peer?:string}
export default class Room implements Party.Server {
  room:Party.Room
  constructor(room:Party.Room){this.room=room}
  onConnect(conn:Party.Connection,ctx:Party.ConnectionContext){
    if([...this.room.getConnections()].length>128){conn.close(1013,'Room full');return}
    const peer=new URL(ctx.request.url).searchParams.get('peer')
    if(!peer||!/^[a-zA-Z0-9_-]{1,64}$/.test(peer)){conn.close(1008,'Invalid peer');return}
    conn.setState({peer} satisfies ClientState)
  }
  onMessage(message:string|ArrayBuffer,sender:Party.Connection<ClientState>){
    if(typeof message!=='string'||message.length>1024)return
    let data;try{data=JSON.parse(message)}catch{return}
    const state=sender.state??{}
    if(data.type==='view'){
      if(Number.isFinite(data.x)&&Number.isFinite(data.z)&&Math.abs(data.x)<20040000&&Math.abs(data.z)<20040000)sender.setState({...state,view:{x:data.x,z:data.z}})
      return
    }
    if(!validTelemetry(data)||data.id!==state.peer)return
    const now=Date.now()
    if(now-(state.last??0)<45||data.seq<=(state.seq??-1))return
    const crew=this.room.id.startsWith('crew_'),ll=unproject(data.x,data.z)
    if(!crew&&tileKey(ll.lat,ll.lon)!==this.room.id)return
    sender.setState({...state,last:now,seq:data.seq,view:{x:data.x,z:data.z}})
    for(const conn of this.room.getConnections<ClientState>()) {
      if(conn.id===sender.id||conn.state?.peer===data.id)continue
      if(crew||(conn.state?.view&&spatialDistance(data,conn.state.view)<=5000))conn.send(message)
    }
  }
}
Room satisfies Party.Worker
