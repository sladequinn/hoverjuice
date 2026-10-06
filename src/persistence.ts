export interface Ownership {buildingId:string;tile:string;ownerId:string;gang:string}
/** Global reads only. Claims require an authenticated, authoritative economy transaction. */
export class OwnershipClient {
  private endpoint=import.meta.env.VITE_API_BASE as string|undefined
  private loaded=new Map<string,number>()
  private abort=new AbortController()
  ownership=new Map<string,Ownership>()
  status='LOCAL SAVE'
  async load(tiles:string[]) {
    if(!this.endpoint)return
    for(const tile of [...new Set(tiles)]) {
      if(Date.now()-(this.loaded.get(tile)??0)<30000)continue
      try{
        const res=await fetch(`${this.endpoint.replace(/\/$/,'')}/api/ownership?tile=${encodeURIComponent(tile)}`,{signal:this.abort.signal})
        if(!res.ok)throw new Error(String(res.status))
        const rows=await res.json() as Ownership[]
        if(!Array.isArray(rows))throw new Error('Invalid response')
        for(const [id,row]of this.ownership)if(row.tile===tile)this.ownership.delete(id)
        for(const row of rows)if(row.tile===tile&&typeof row.buildingId==='string'&&typeof row.ownerId==='string')this.ownership.set(row.buildingId,row)
        this.loaded.set(tile,Date.now());this.status='GLOBAL READS'
      }catch{if(!this.abort.signal.aborted)this.status='GLOBAL UNAVAILABLE'}
    }
  }
  dispose(){this.abort.abort()}
}
