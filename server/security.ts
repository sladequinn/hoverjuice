export class HttpError extends Error {constructor(public status:number,message:string){super(message)}}
export const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('')
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('')}
export async function challenge(value:string){return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
export function cookie(request:Request,name:string){return request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)??''}
export const sessionCookie='__Host-hg_session'
export const stateCookie='__Host-hg_oauth'
export const setCookie=(name:string,value:string,maxAge:number)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
export function sameOrigin(request:Request,origin:string){
 if(request.headers.get('Origin')!==origin||new URL(request.url).origin!==origin)throw new HttpError(403,'Origin rejected')
}
export async function readJson(request:Request){
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new HttpError(415,'JSON required')
 // Enforce actual streamed bytes, including requests without Content-Length.
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Missing body')
 const chunks:Uint8Array[]=[];let size=0
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>131072){await reader.cancel();throw new HttpError(413,'Save exceeds 128 KiB')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new HttpError(400,'Invalid JSON')}
}
export async function limit(db:D1Database,key:string,max:number){
 const now=Date.now(),window=Math.floor(now/60000)
 const row=await db.prepare(`INSERT INTO request_limits(bucket,count,expires_at) VALUES(?,1,?)
 ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(`${key}:${window}`,now+120000).first<{count:number}>()
 if(!row||row.count>max)throw new HttpError(429,'Too many requests; retry in one minute')
}
