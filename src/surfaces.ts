/** Spatial index of rendered road/pavement triangles, including clipped sidewalk holes. */
export class SurfaceIndex {
 private triangles:number[][]=[]
 private cells=new Map<string,number[]>()
 add(vertices:number[]){
  for(let i=0;i<vertices.length;i+=9){
   const t=vertices.slice(i,i+9)
   const den=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8])
   if(Math.abs(den)<1e-8)continue // Vertical curb faces are not receiving surfaces.
   const id=this.triangles.length;this.triangles.push(t)
   for(let x=Math.floor(Math.min(t[0],t[3],t[6])/20);x<=Math.floor(Math.max(t[0],t[3],t[6])/20);x++)for(let z=Math.floor(Math.min(t[2],t[5],t[8])/20);z<=Math.floor(Math.max(t[2],t[5],t[8])/20);z++){
    const key=`${x},${z}`,list=this.cells.get(key)??[];list.push(id);this.cells.set(key,list)
   }
  }
 }
 heightAt(x:number,z:number,reference:number,fallback:number){
  let height=fallback,best=Infinity
  for(const id of this.cells.get(`${Math.floor(x/20)},${Math.floor(z/20)}`)??[]){
   const t=this.triangles[id],den=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8])
   const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/den
   const b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/den,c=1-a-b
   if(a<-.0001||b<-.0001||c<-.0001)continue
   const h=a*t[1]+b*t[4]+c*t[7],d=Math.abs(h-reference)
   if(d<best){height=h;best=d}
  }
  return height
 }
}
