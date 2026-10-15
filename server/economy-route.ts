import {distance,validGeo,type Geo} from '../shared/multiplayer'
import {districtBounds,districtFor} from '../shared/crews'
/** Bounded Dijkstra over trusted OSM node identities; geometric crossings do not create junctions. */
export function freightRoute(data:any,origin:string,destination:string):Geo[]{
 if(data?.remark||!Array.isArray(data?.elements)||data.elements.length>4000)throw Error('Incomplete road snapshot')
 const nodes=new Map<number,Geo>(),edges=new Map<number,{to:number;cost:number}[]>()
 for(const w of data.elements){if(w.type!=='way'||!['residential','unclassified','tertiary','secondary','living_street','service'].includes(w.tags?.highway)||['private','no'].includes(w.tags?.access)||['yes','1','-1'].includes(w.tags?.oneway)||w.tags?.junction==='roundabout'||!Array.isArray(w.nodes)||w.nodes.length!==w.geometry?.length||w.nodes.length>1500||!w.nodes.every((n:any)=>Number.isSafeInteger(n)&&n>0)||!w.geometry.every(validGeo))continue
  w.nodes.forEach((id:number,i:number)=>{nodes.set(id,w.geometry[i]);if(!edges.has(id))edges.set(id,[])})
  for(let i=1;i<w.nodes.length;i++){const a=w.nodes[i-1],b=w.nodes[i],cost=distance(nodes.get(a)!,nodes.get(b)!);if(cost>.5&&cost<500){edges.get(a)!.push({to:b,cost});edges.get(b)!.push({to:a,cost})}}
 }
 if(nodes.size>12000)throw Error('Road area too complex')
 const nearest=(district:string)=>[...nodes].filter(([,p])=>districtFor(p)===district).sort((a,b)=>distance(a[1],districtBounds(district))-distance(b[1],districtBounds(district))||a[0]-b[0])[0]?.[0]
 const start=nearest(origin),end=nearest(destination);if(!start||!end)throw Error('No road depots in both districts')
 const dist=new Map([[start,0]]),prev=new Map<number,number>(),heap:{id:number;d:number}[]=[]
 const push=(v:{id:number;d:number})=>{heap.push(v);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p].d<=v.d)break;heap[i]=heap[p];i=p}heap[i]=v}
 const pop=()=>{const v=heap[0],last=heap.pop()!;if(heap.length){let i=0;heap[0]=last;for(;;){let j=i*2+1;if(j>=heap.length)break;if(j+1<heap.length&&heap[j+1].d<heap[j].d)j++;if(heap[j].d>=last.d)break;heap[i]=heap[j];i=j}heap[i]=last}return v}
 push({id:start,d:0});while(heap.length){const v=pop();if(v.d!==dist.get(v.id))continue;if(v.id===end)break;for(const e of edges.get(v.id)??[]){const d=v.d+e.cost;if(d<=6000&&d<(dist.get(e.to)??Infinity)){dist.set(e.to,d);prev.set(e.to,v.id);push({id:e.to,d})}}}
 if(!prev.has(end)||(dist.get(end)??0)<300)throw Error('No supported connected freight road; try another district')
 const ids=[end];while(ids[0]!==start){ids.unshift(prev.get(ids[0])!);if(ids.length>256)throw Error('Freight route too complex')}
 return ids.map(id=>nodes.get(id)!)
}
