import {VEHICLES} from '../src/data'
import {PAINTS} from '../src/customization'
export type Place={name:string;lat:number;lon:number}
/** Only freely selectable presentation and navigation preferences. No economic state. */
export type Preferences={current:string;mask:string;paint:string;allegiance:'SHINOBI'|'LIARS'|'HYENAS'|'JESTERS';city:Place|null;safehouse:Place|null;cam:'chase'|'top'}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const place=(v:unknown)=>v===null||object(v)&&Object.keys(v).sort().join(',')==='lat,lon,name'&&typeof v.name==='string'&&v.name.length<=512&&!/[<>\u0000-\u001f]/.test(v.name)&&typeof v.lat==='number'&&Number.isFinite(v.lat)&&Math.abs(v.lat)<=90&&typeof v.lon==='number'&&Number.isFinite(v.lon)&&Math.abs(v.lon)<=180
export function validPreferences(v:unknown):v is Preferences {
 return object(v)&&Object.keys(v).sort().join(',')==='allegiance,cam,city,current,mask,paint,safehouse'&&VEHICLES.some(x=>x.id===v.current)&&['balaclava','glitcher','respirator','oni','liar','jester'].includes(v.mask as string)&&(v.paint==='factory'||PAINTS.some(x=>x.id===v.paint))&&['SHINOBI','LIARS','HYENAS','JESTERS'].includes(v.allegiance as string)&&(v.cam==='chase'||v.cam==='top')&&place(v.city)&&place(v.safehouse)
}
