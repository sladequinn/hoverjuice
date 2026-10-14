import {validLegacySave} from '../shared/legacy-save'
export const LOCAL_SAVE_KEY='hoverghini.save.v1'
export const LOCAL_BACKUP_KEY='hoverghini.save.before-cloud.v1'
export interface CloudSnapshot {playerId:string;schemaVersion:1;mode:'legacy-local';revision:number;payload:Record<string,unknown>|null;updatedAt:number}
interface Pending {playerId:string;requestId:string;expectedRevision:number;schemaVersion:1;payload:Record<string,unknown>}
export class CloudError extends Error {status:number;constructor(message:string,status=0){super(message);this.status=status}}
/** Manual, explicit synchronization. No startup network dependency or silent overwrite. */
export class CloudSave {
 playerId:string|null=null
 snapshot:CloudSnapshot|null=null
 balance=0
 status='Local play. Cloud backups keep legacy progress separate from the global wallet.'
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
 private pendingKey(){if(!this.playerId)throw new CloudError('Connect your account first.');return `hoverghini.cloud.pending.${this.playerId}`}
 get pending(){return this.playerId?!!this.storage.getItem(this.pendingKey()):false}
 async prepareLogin(){
  // Probe before leaving the game: static-only hosts and disabled backends stay playable.
  try{await this.call('/api/me')}catch(error){if(!(error instanceof CloudError)||error.status!==401)throw error}
 }
 async refresh(){
  const me=await this.call('/api/me')
  if(typeof me.playerId!=='string')throw new CloudError('Invalid account response')
  // Do not retain a previous account's snapshot if a follow-up read fails.
  this.playerId=me.playerId;this.snapshot=null
  const [snapshot,wallet]=await Promise.all([this.call('/api/save'),this.call('/api/wallet')])
  if(snapshot.playerId!==me.playerId||wallet.playerId!==me.playerId||snapshot.schemaVersion!==1||snapshot.mode!=='legacy-local'||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||(snapshot.payload!==null&&!validLegacySave(snapshot.payload))||!Number.isSafeInteger(wallet.balance)||wallet.balance<0)throw new CloudError('Invalid cloud response; local save untouched.')
  this.snapshot=snapshot;this.balance=wallet.balance
  this.status=`Account connected. Cloud revision ${snapshot.revision}. ${this.pending?'An interrupted upload can be retried.':'Choose backup or restore.'}`
 }
 async upload(payload:unknown){
  if(!this.playerId||!this.snapshot)throw new CloudError('Check account before uploading.')
  if(this.pending)throw new CloudError('Retry the interrupted upload before starting another.')
  if(!validLegacySave(payload))throw new CloudError('Local save is not compatible; it has not been changed.')
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
  await this.call('/api/save',{method:'PUT',body:JSON.stringify(pending)})
  this.storage.removeItem(key)
  await this.refresh()
  this.status='Legacy progress backed up. Global wallet unchanged.'
 }
 discardPending(){this.storage.removeItem(this.pendingKey());this.snapshot=null;this.status='Pending upload discarded locally. Check cloud before another upload.'}
 async restore(){
  if(this.pending)throw new CloudError('Resolve the interrupted upload before restoring.')
  const account=this.playerId,revision=this.snapshot?.revision
  await this.refresh()
  if(account!==this.playerId||revision!==this.snapshot?.revision)throw new CloudError('Cloud save changed. Review it and confirm restore again.')
  const payload=this.snapshot?.payload
  if(!payload||!validLegacySave(payload))throw new CloudError('No compatible cloud backup to restore.')
  const old=this.storage.getItem(LOCAL_SAVE_KEY)
  // If backup storage fails, abort before replacing the active save.
  if(old!==null)this.storage.setItem(LOCAL_BACKUP_KEY,old)
  this.storage.setItem(LOCAL_SAVE_KEY,JSON.stringify(payload))
 }
 restoreLocalBackup(){
  const backup=this.storage.getItem(LOCAL_BACKUP_KEY)
  if(!backup||!validLegacySave(JSON.parse(backup)))throw new CloudError('No compatible pre-restore backup on this device.')
  // Keep the recovery copy intact; no second write can fail after replacement.
  this.storage.setItem(LOCAL_SAVE_KEY,backup)
 }
 async logout(all=false){await this.call(all?'/api/auth/logout-all':'/api/auth/logout',{method:'POST'});this.playerId=null;this.snapshot=null;this.balance=0;this.status='Signed out. Local progress and pending backups are retained.'}
}
