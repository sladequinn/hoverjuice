/** Validation for untrusted backup data, NOT evidence of money, ownership or progress. */
type Obj=Record<string,unknown>
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v)
const num=(v:unknown,min=0,max=1e12)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max
const text=(v:unknown)=>typeof v==='string'&&v.length<=512&&!/[<>\u0000-\u001f]/.test(v)
const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.:,/-]{1,160}$/.test(v)
const array=(v:unknown,check:(v:unknown)=>boolean,max=2000)=>Array.isArray(v)&&v.length<=max&&v.every(check)
const coords=(v:unknown)=>object(v)&&num(v.lat,-90,90)&&num(v.lon,-180,180)
const place=(v:unknown)=>coords(v)&&text((v as Obj).name)
const quantities=(v:unknown)=>object(v)&&Object.keys(v).length<=100&&Object.entries(v).every(([k,q])=>id(k)&&num(q))
const gangs=['SHINOBI','LIARS','HYENAS','JESTERS']
const optional=(o:Obj,key:string,check:(v:unknown)=>boolean)=>o[key]===undefined||check(o[key])
export function validLegacySave(v:unknown):v is Obj {
 if(!object(v))return false
 // Bound nesting and reject prototype keys even in ignored fields.
 let nodes=0
 function safe(x:unknown,depth=0):boolean{
  if(++nodes>25000||depth>8)return false
  if(x===null||typeof x==='boolean')return true
  if(typeof x==='number')return num(x,-1e12,1e12)
  if(typeof x==='string')return text(x)
  if(Array.isArray(x))return x.length<=2000&&x.every(a=>safe(a,depth+1))
  return object(x)&&Object.entries(x).every(([k,a])=>!['__proto__','constructor','prototype'].includes(k)&&safe(a,depth+1))
 }
 if(!safe(v))return false
 if(!num(v.money)||!array(v.owned,id,100)||!id(v.current)||!array(v.masks,id,100)||!id(v.mask))return false
 if(!array(v.holdings,h=>object(h)&&id(h.id)&&text(h.name)&&text(h.city)&&text(h.cityKey)&&num(h.building)&&num(h.income)))return false
 if(v.city!==null&&!place(v.city))return false
 for(const k of ['deliveries','earned','vaultCash','hull','heat','notoriety'])if(!optional(v,k,x=>num(x)))return false
 for(const k of ['won','coldOpenDone'])if(!optional(v,k,x=>typeof x==='boolean'))return false
 if(!optional(v,'cam',x=>x==='chase'||x==='top')||!optional(v,'allegiance',x=>gangs.includes(String(x))))return false
 if(!optional(v,'gangRep',x=>object(x)&&gangs.every(k=>num(x[k],-1e12))))return false
 if(!optional(v,'safehouse',x=>x===null||place(x))||!optional(v,'homes',x=>array(x,h=>place(h)&&id((h as Obj).id)&&num((h as Obj).price))))return false
 if(!optional(v,'contraband',quantities)||!optional(v,'vaultCargo',quantities))return false
 if(!optional(v,'builds',x=>object(x)&&Object.keys(x).length<=100&&Object.entries(x).every(([k,b])=>id(k)&&object(b)&&['drive','handling','efficiency'].every(t=>num(b[t],0,3))&&optional(b,'paint',id))))return false
 if(!optional(v,'tutorial',x=>object(x)&&['ready','pickup','dropoff','deal','done','skipped'].includes(String(x.stage))&&optional(x,'city',coords)&&['from','to'].every(k=>optional(x,k,p=>object(p)&&num(p.x,-1e8,1e8)&&num(p.z,-1e8,1e8)))))return false
 const allowed=new Set(['builds','tutorial','allegiance','gangRep','money','owned','current','holdings','city','homes','safehouse','deliveries','earned','won','masks','mask','cam','coldOpenDone','hull','heat','notoriety','vaultCash','vaultCargo','contraband'])
 return Object.keys(v).every(k=>allowed.has(k))
}
