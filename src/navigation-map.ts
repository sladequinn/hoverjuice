import {Territories,GANG_INFO} from './gangs'
import type {CityData,Pt} from './map'
import {residential} from './housing'
export interface MapView {x:number;z:number;scale:number;width:number;height:number}
export interface MapMarker {id:string;x:number;z:number;label:string;symbol:string;color:string}
type Feature={order:number;poly:Pt[];holes?:Pt[][];color:string;border?:string;line?:number;name?:string;minX:number;maxX:number;minZ:number;maxZ:number}
const CELL=256
/** Vector features indexed once per streamed batch; viewport caches never shrink with world extent. */
export class NavigationMap {
 private labelBoxes:{x:number;y:number;w:number;h:number}[]=[]
 private cells=new Map<string,Feature[]>()
 private caches=new Map<string,{key:string;canvas:HTMLCanvasElement}>()
 constructor(city:CityData){
  let order=0
  const add=(poly:Pt[],color:string,line?:number,name?:string,holes?:Pt[][],border?:string)=>{
   const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1])
   const f={order:order++,poly,color,border,line,name,holes,minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)}
   for(let x=Math.floor(f.minX/CELL);x<=Math.floor(f.maxX/CELL);x++)for(let z=Math.floor(f.minZ/CELL);z<=Math.floor(f.maxZ/CELL);z++){
    const k=`${x},${z}`,list=this.cells.get(k)??[];list.push(f);this.cells.set(k,list)
   }
  }
  for(const z of new Territories(city).regions())add(z.poly,GANG_INFO[z.gang].fill,undefined,z.gang,undefined,GANG_INFO[z.gang].color)
  for(const w of city.waters)add(w.poly,'#163e50',undefined,undefined,w.holes)
  for(const b of city.buildings)add(b.poly,residential(b,city)?'#4c7372':'#37434e')
  for(const r of city.roads)for(let i=1;i<r.pts.length;i++)add([r.pts[i-1],r.pts[i]],r.major?'#b9975b':'#73818b',r.width,r.name)
 }
 project(v:MapView,x:number,z:number){return {x:v.width/2+(x-v.x)*v.scale,y:v.height/2+(z-v.z)*v.scale}}
 unproject(v:MapView,x:number,y:number){return {x:v.x+(x-v.width/2)/v.scale,z:v.z+(y-v.height/2)/v.scale}}
 draw(g:CanvasRenderingContext2D,v:MapView,slot:string,dpr=1){
  this.labelBoxes=[]
  const key=[v.x,v.z,v.scale,v.width,v.height].join(':')
  let cached=this.caches.get(slot)
  if(cached?.key!==key){
   const canvas=cached?.canvas??document.createElement('canvas');canvas.width=v.width;canvas.height=v.height
   const c=canvas.getContext('2d')!,rx=v.width/v.scale/2,rz=v.height/v.scale/2
   c.fillStyle='#0b141c';c.fillRect(0,0,v.width,v.height)
   const features=new Set<Feature>()
   for(let x=Math.floor((v.x-rx)/CELL);x<=Math.floor((v.x+rx)/CELL);x++)for(let z=Math.floor((v.z-rz)/CELL);z<=Math.floor((v.z+rz)/CELL);z++)
    for(const f of this.cells.get(`${x},${z}`)??[])features.add(f)
   const sorted=[...features].filter(f=>f.maxX>=v.x-rx&&f.minX<=v.x+rx&&f.maxZ>=v.z-rz&&f.minZ<=v.z+rz)
   // Insertion order is restored after spatial lookup: zones, water, buildings, roads.
   sorted.sort((a,b)=>a.order-b.order)
   const labels=new Set<string>()
   const turfLabels:{name:string;x:number;y:number;color:string}[]=[]
   for(const f of sorted){
    c.beginPath()
    for(const ring of [f.poly,...(f.holes??[])]){
     ring.forEach(([x,z],i)=>{const p=this.project(v,x,z);if(i)c.lineTo(p.x,p.y);else c.moveTo(p.x,p.y)})
     if(!f.line)c.closePath()
    }
    if(f.line){c.strokeStyle=f.color;c.lineWidth=Math.max(1,f.line*v.scale);c.lineCap='round';c.stroke()}
    else {c.fillStyle=f.color;c.fill('evenodd');if(f.border){c.strokeStyle=f.border;c.lineWidth=1.5*dpr;c.stroke()}}
    if(f.border&&slot==='full'&&f.name&&!labels.has(f.name)){
      const x=Math.max(8*dpr,(f.minX-v.x)*v.scale+v.width/2+12*dpr),y=Math.max(110*dpr,(f.minZ-v.z)*v.scale+v.height/2+18*dpr)
      if(x<v.width-100*dpr&&y<v.height-100*dpr){labels.add(f.name);turfLabels.push({name:f.name,x,y,color:f.border})}
    }
    if(f.line&&slot==='full'&&v.scale/dpr>.12&&f.name&&!labels.has(f.name)){
     const a=f.poly[0],b=f.poly[1],p=this.project(v,(a[0]+b[0])/2,(a[1]+b[1])/2)
     if(Math.hypot(a[0]-b[0],a[1]-b[1])*v.scale>80*dpr){
      labels.add(f.name);c.font=`${12*dpr}px sans-serif`;c.lineWidth=3*dpr;c.strokeStyle='#0b141c';c.strokeText(f.name,p.x,p.y);c.fillStyle='#d5dce1';c.fillText(f.name,p.x,p.y)
     }
    }
   }
   for(const t of turfLabels){c.font=`bold ${13*dpr}px sans-serif`;c.strokeStyle='#0b141c';c.lineWidth=3*dpr;c.strokeText(t.name,t.x,t.y);c.fillStyle=t.color;c.fillText(t.name,t.x,t.y)}
   cached={key,canvas};this.caches.set(slot,cached)
  }
  g.drawImage(cached.canvas,0,0)
 }
 marker(g:CanvasRenderingContext2D,v:MapView,m:MapMarker,dpr:number,labels:boolean){
  const p=this.project(v,m.x,m.z),pad=12*dpr
  const off=p.x<pad||p.x>v.width-pad||p.y<pad||p.y>v.height-pad
  if(off&&labels)return
  if(off){const dx=p.x-v.width/2,dy=p.y-v.height/2,t=Math.min((v.width/2-pad)/Math.max(Math.abs(dx),1),(v.height/2-pad)/Math.max(Math.abs(dy),1));p.x=v.width/2+dx*t;p.y=v.height/2+dy*t}
  const r=(labels?10:7)*dpr
  g.fillStyle='#0a141e';g.strokeStyle=m.color;g.lineWidth=2*dpr;g.beginPath();g.arc(p.x,p.y,r,0,Math.PI*2);g.fill();g.stroke()
  g.font=`bold ${10*dpr}px sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillStyle=m.color;g.fillText(m.symbol,p.x,p.y)
  if(labels && m.symbol!=='F'){
   g.font=`${11*dpr}px sans-serif`;g.textAlign='left'
   const w=g.measureText(m.label).width,x=p.x+r+4*dpr+w<v.width?p.x+r+4*dpr:p.x-r-4*dpr-w
   const box={x,y:p.y-8*dpr,w,h:16*dpr}
   if(x>=0&&!this.labelBoxes.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y)){
    this.labelBoxes.push(box);g.strokeStyle='#081018';g.lineWidth=3*dpr;g.strokeText(m.label,x,p.y);g.fillText(m.label,x,p.y)
   }
  }
 }
}
