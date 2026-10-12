/** Mapzen/AWS Terrarium DEM. Immutable 32 m samples keep streamed sectors stable. */
export const TERRAIN_STEP=32, TERRAIN_SIZE=2048
const ZOOM=12,N=2**ZOOM
export function decodeTerrarium(r:number,g:number,b:number){return r*256+g+b/256-32768}
export function demPixel(lat:number,lon:number){return {x:(lon+180)/360*N*256-.5,y:(1-Math.asinh(Math.tan(Math.max(-85.051,Math.min(85.051,lat))*Math.PI/180))/Math.PI)/2*N*256-.5}}
export class TerrainField {
 readonly patches=new Map<string,Float32Array>()
 datum=0
 enabled=true
 private initialized=false
 private tiles=new Map<string,Float32Array>()
 readonly lat:number
 readonly lon:number
 constructor(lat:number,lon:number){this.lat=lat;this.lon=lon}
 private ll(x:number,z:number){return {lat:this.lat-z/110540,lon:this.lon+x/(111320*Math.cos(this.lat*Math.PI/180))}}
 private raw(x:number,z:number){
  const ll=this.ll(x,z),p=demPixel(ll.lat,ll.lon),ix=Math.floor(p.x),iy=Math.floor(p.y),fx=p.x-ix,fy=p.y-iy
  const at=(a:number,b:number)=>{const tx=((Math.floor(a/256)%N)+N)%N,ty=Math.max(0,Math.min(N-1,Math.floor(b/256)));return this.tiles.get(`${tx}/${ty}`)?.[((b%256)+256)%256*256+((a%256)+256)%256]??NaN}
  return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy
 }
 async ensure(minX:number,minZ:number,maxX:number,maxZ:number,signal?:AbortSignal){
  if(!this.enabled)return
  const missing:{x:number;z:number}[]=[]
  for(let x=Math.floor(minX/TERRAIN_SIZE);x<=Math.floor(maxX/TERRAIN_SIZE);x++)for(let z=Math.floor(minZ/TERRAIN_SIZE);z<=Math.floor(maxZ/TERRAIN_SIZE);z++)if(!this.patches.has(`${x},${z}`))missing.push({x,z})
  if(!missing.length)return
  const wanted=new Set<string>()
  for(const patch of missing){
   const a=this.ll(patch.x*TERRAIN_SIZE,patch.z*TERRAIN_SIZE),b=this.ll((patch.x+1)*TERRAIN_SIZE,(patch.z+1)*TERRAIN_SIZE),p=demPixel(a.lat,a.lon),q=demPixel(b.lat,b.lon)
   for(let x=Math.floor(p.x/256);x<=Math.floor((q.x+1)/256);x++)for(let y=Math.floor(p.y/256);y<=Math.floor((q.y+1)/256);y++)wanted.add(`${((x%N)+N)%N}/${Math.max(0,Math.min(N-1,y))}`)
  }
  try{
   const keys=[...wanted].filter(k=>!this.tiles.has(k))
   for(let i=0;i<keys.length;i+=4)await Promise.all(keys.slice(i,i+4).map(async key=>{
    const timeout=AbortSignal.timeout(6000),combined=signal?AbortSignal.any([signal,timeout]):timeout
    const response=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${key}.png`,{signal:combined})
    if(!response.ok)throw Error('Elevation tile unavailable')
    const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'})
    try{
     if(bitmap.width!==256||bitmap.height!==256)throw Error('Invalid DEM dimensions')
     const canvas=document.createElement('canvas');canvas.width=canvas.height=256
     const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(bitmap,0,0)
     const rgba=ctx.getImageData(0,0,256,256).data,heights=new Float32Array(65536)
     for(let p=0;p<heights.length;p++)heights[p]=decodeTerrarium(rgba[p*4],rgba[p*4+1],rgba[p*4+2])
     this.tiles.set(key,heights)
    }finally{bitmap.close()}
   }))
   if(!this.initialized){this.datum=this.raw(0,0);if(!Number.isFinite(this.datum))throw Error('Invalid terrain origin')}
   const baked: [string,Float32Array][]=[]
   for(const p of missing){const data=new Float32Array(65*65);for(let z=0;z<=64;z++)for(let x=0;x<=64;x++){const h=this.raw(p.x*TERRAIN_SIZE+x*TERRAIN_STEP,p.z*TERRAIN_SIZE+z*TERRAIN_STEP)-this.datum;if(!Number.isFinite(h))throw Error('Incomplete terrain patch');data[z*65+x]=h}baked.push([`${p.x},${p.z}`,data])}
   for(const [key,data] of baked)this.patches.set(key,data)
   this.initialized=true
   // Only baked samples are retained for old sectors; raw PNG data is a bounded cache.
   while(this.tiles.size>16)this.tiles.delete(this.tiles.keys().next().value!)
  }catch(error){
   if(signal?.aborted)throw error
   if(this.initialized)throw error
   this.enabled=false;this.tiles.clear() // Whole-session flat fallback, never sudden height changes.
  }
 }
 heightAt(x:number,z:number){
  const px=Math.floor(x/TERRAIN_SIZE),pz=Math.floor(z/TERRAIN_SIZE),data=this.patches.get(`${px},${pz}`)
  if(!data)return 0
  const u=(x-px*TERRAIN_SIZE)/TERRAIN_STEP,v=(z-pz*TERRAIN_SIZE)/TERRAIN_STEP,ix=Math.min(63,Math.floor(u)),iz=Math.min(63,Math.floor(v)),a=u-ix,b=v-iz,i=iz*65+ix
  // Match the mesh's diagonal exactly, rather than bilinear interpolation above its triangles.
  return a+b<=1?data[i]+a*(data[i+1]-data[i])+b*(data[i+65]-data[i]):data[i+66]+(1-a)*(data[i+65]-data[i+66])+(1-b)*(data[i+1]-data[i+66])
 }
}
