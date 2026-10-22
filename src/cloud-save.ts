import {validPreferences} from '../shared/preferences'
export const LOCAL_SAVE_KEY='hoverghini.save.v1'
export interface CloudSnapshot {playerId:string;schemaVersion:1;mode:'preferences';revision:number;payload:Record<string,unknown>|null;updatedAt:number}
interface Pending {playerId:string;requestId:string;expectedRevision:number;schemaVersion:1;payload:Record<string,unknown>}
export class CloudError extends Error {status:number;constructor(message:string,status=0){super(message);this.status=status}}
/** Account snapshot transport with revision checks and a durable, account-scoped outbox. */
export class CloudSave {
 playerId:string|null=null
 snapshot:CloudSnapshot|null=null
 balance=0
 status='Your account keeps progress across devices.'
 busy=false
 private storage:Storage
 private transport:typeof fetch
 constructor(storage:Storage,transport:typeof fetch=fetch){this.storage=storage;this.transport=transport.bind(globalThis)}
 private async call(path:string,options:RequestInit={}){
  const res=await this.transport(path,{...options,credentials:'same-origin',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...options.headers}})
  let body:any;try{body=await res.json()}catch{throw new CloudError('Cloud accounts are unavailable on this host.',503)}
  if(!res.ok)throw new CloudError(body.error??'Cloud request failed',res.status)
  return body
 }
 private pendingKey(){if(!this.playerId)throw new CloudError('Connect your account first.');return `hoverghini.preferences.pending.${this.playerId}`}
 get pending(){return this.playerId?!!this.storage.getItem(this.pendingKey()):false}
 async prepareLogin(){
  // Probe before leaving the game: static-only hosts and disabled backends cannot admit players.
  try{await this.call('/api/me')}catch(error){if(!(error instanceof CloudError)||error.status!==401)throw error}
 }
 async refresh(){
  const me=await this.call('/api/me')
  if(typeof me.playerId!=='string')throw new CloudError('Invalid account response')
  // Do not retain a previous account's snapshot if a follow-up read fails.
  this.playerId=me.playerId;this.snapshot=null
  const [snapshot,wallet]=await Promise.all([this.call('/api/preferences'),this.call('/api/wallet')])
  if(snapshot.playerId!==me.playerId||wallet.playerId!==me.playerId||snapshot.schemaVersion!==1||snapshot.mode!=='preferences'||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||(snapshot.payload!==null&&!validPreferences(snapshot.payload))||!Number.isSafeInteger(wallet.balance)||wallet.balance<0)throw new CloudError('Invalid cloud response; local save untouched.')
  this.snapshot=snapshot;this.balance=wallet.balance
  this.status=`Account connected. Cloud revision ${snapshot.revision}. ${this.pending?'An interrupted upload can be retried.':'Automatic saves are active.'}`
 }
 async upload(payload:unknown){
  if(!this.playerId||!this.snapshot)throw new CloudError('Check account before uploading.')
  if(this.pending)throw new CloudError('Retry the interrupted upload before starting another.')
  if(!validPreferences(payload))throw new CloudError('Local save is not compatible; it has not been changed.')
  // Durable outbox BEFORE sending. Lost responses retry the exact same key and payload.
  const pending:Pending={playerId:this.playerId,requestId:crypto.randomUUID(),expectedRevision:this.snapshot.revision,schemaVersion:1,payload}
  this.storage.setItem(this.pendingKey(),JSON.stringify(pending))
  await this.retry()
 }
 async retry(){
  const key=this.pendingKey(),raw=this.storage.getItem(key)
  if(!raw)throw new CloudError('No interrupted upload.')
  const pending=JSON.parse(raw) as Pending
  const me=await this.call('/api/me')
  if(me.playerId!==pending.playerId||me.playerId!==this.playerId)throw new CloudError('Account changed. Check account before retrying.')
  const receipt=await this.call('/api/preferences',{method:'PUT',body:JSON.stringify(pending)})
  await this.refresh()
  if(this.playerId!==pending.playerId)throw new CloudError('Account changed during saving. Reload to continue.',409)
  if(this.snapshot?.revision!==receipt.revision)throw new CloudError('Progress changed on another device. Reload the latest account save.',409)
  this.storage.removeItem(key)
  this.status='Progress saved.'
 }
 discardPending(){this.storage.removeItem(this.pendingKey());this.snapshot=null;this.status='Pending upload discarded locally. Check cloud before another upload.'}
 async logout(all=false){await this.call(all?'/api/auth/logout-all':'/api/auth/logout',{method:'POST'});this.playerId=null;this.snapshot=null;this.balance=0;this.status='Signed out.'}
}
