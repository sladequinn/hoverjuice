import type {CityData,Road} from './map'
/** One physical ramp per connected bridge/tunnel span, not per vector-tile feature. */
export function gradeStructures(city:CityData){
 const roads=city.roads.filter(r=>(r.bridge||r.tunnel)&&r.nodeIds),byNode=new Map<number,Road[]>()
 for(const road of roads)for(const id of road.nodeIds!){const list=byNode.get(id)??[];list.push(road);byNode.set(id,list)}
 const seen=new Set<Road>()
 for(const first of roads){
  if(seen.has(first))continue
  const group:Road[]=[],pending=[first],edges=new Map<number,Set<number>>()
  while(pending.length){const road=pending.pop()!;if(seen.has(road))continue;seen.add(road);group.push(road)
   const ids=road.nodeIds!
   for(let i=0;i<ids.length;i++){
    const adj=edges.get(ids[i])??new Set<number>();if(i)adj.add(ids[i-1]);if(i+1<ids.length)adj.add(ids[i+1]);edges.set(ids[i],adj)
    for(const next of byNode.get(ids[i])??[])if(!seen.has(next)&&next.bridge===first.bridge&&next.tunnel===first.tunnel&&next.deck===first.deck)pending.push(next)
   }
  }
  const ends=[...edges].filter(([,adj])=>adj.size===1).map(([id])=>id),nodes=city.nodes
  const dist=new Map<number,number>(),queue=ends.map(id=>({id,d:0}));for(const id of ends)dist.set(id,0)
  // Spans are small; this runs only on map ingestion, never per frame.
  while(queue.length){queue.sort((a,b)=>b.d-a.d);const {id,d}=queue.pop()!;if(d!==dist.get(id))continue
   for(const next of edges.get(id)??[]){const nd=d+Math.hypot(nodes[id].x-nodes[next].x,nodes[id].z-nodes[next].z);if(nd<(dist.get(next)??Infinity)){dist.set(next,nd);queue.push({id:next,d:nd})}}
  }
  let start=ends[0],end=ends[1],longest=0
  for(const a of ends)for(const b of ends){const d=Math.hypot(nodes[a].x-nodes[b].x,nodes[a].z-nodes[b].z);if(d>longest){start=a;end=b;longest=d}}
  const ground=(id:number)=>city.terrain?.heightAt(nodes[id].x,nodes[id].z)??0
  for(const [id] of edges){
   const g=ground(id),t=Math.min(1,(dist.get(id)??80)/80),blend=t*t*(3-2*t)
   let bed=g
   if(start!==undefined&&end!==undefined&&longest>0){const a=nodes[start],b=nodes[end],n=nodes[id],u=Math.max(0,Math.min(1,((n.x-a.x)*(b.x-a.x)+(n.z-a.z)*(b.z-a.z))/(longest*longest)));bed=ground(start)+(ground(end)-ground(start))*u}
   nodes[id].y=g+(bed-g+(first.deck??(first.bridge?5:-4)))*blend
  }
  for(const road of group)road.heights=road.nodeIds!.map(id=>nodes[id].y??0)
 }
}
