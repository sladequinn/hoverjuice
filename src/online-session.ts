import {CloudSave,CloudError} from './cloud-save'

/** Account-scoped, serialized autosave. Never imports this device's old local save. */
export class OnlineSession {
 ready=false
 status='Connecting to your account…'
 signedOut=false
 conflict=false
 displayName=''
 providers:string[]=[]
 private account=''
 private queued:Record<string,unknown>|null=null
 private running:Promise<void>|null=null
 private timer:ReturnType<typeof setTimeout>|null=null
 readonly cloud:CloudSave
 private transport:typeof fetch
 constructor(cloud:CloudSave,transport:typeof fetch=fetch.bind(globalThis)){this.cloud=cloud;this.transport=transport}
 private async identity(){
  const response=await this.transport('/api/me',{credentials:'same-origin',signal:AbortSignal.timeout(8000),cache:'no-store'})
  if(!response.ok)throw new CloudError(response.status===401?'Sign in to enter HOVERGHINI.':'Connection lost. Reconnecting…',response.status)
  const me=await response.json()
  if(typeof me.playerId!=='string')throw new CloudError('The online game server is unavailable.')
  if(this.account&&this.account!==me.playerId)throw new CloudError('Account changed in another tab. Reload to continue.',409)
  this.displayName=me.displayName??'';this.providers=me.providers??[]
  return me
 }
 private fail(error:unknown){
  this.ready=false;this.signedOut=error instanceof CloudError&&error.status===401
  this.conflict=error instanceof CloudError&&error.status===409
  this.status=this.conflict?'Progress changed on another device. Reload to use the latest account save.':error instanceof Error?error.message:'Connection lost. Reconnecting…'
 }
 async start(){
  if(this.running)return
  try{
   const me=await this.identity();this.account=me.playerId
   await this.cloud.refresh()
   if(this.cloud.playerId!==this.account)throw new CloudError('Account changed. Reload to continue.',409)
   if(this.cloud.pending)await this.cloud.retry()
   this.ready=true;this.signedOut=false;this.conflict=false;this.status='Saved to your account'
  }catch(error){this.fail(error)}
 }
 async heartbeat(){
  if(this.running||this.signedOut||this.conflict||!this.account)return
  try{
   await this.identity()
   if(!this.cloud.snapshot&&!this.cloud.pending){await this.start();return}
   if(this.cloud.pending){await this.flush();if(!this.ready)return}
   if(this.conflict||this.signedOut)return
   this.ready=true;this.status=this.queued?'Saving…':'Saved to your account'
   if(this.queued)void this.flush()
  }catch(error){this.fail(error)}
 }
 offline(){this.ready=false;this.status='Connection lost. Reconnecting…'}
 get dirty(){return !!(this.queued||this.running||this.cloud.pending)}
 save(payload:unknown){
  if(!this.ready||!this.account)return
  this.queued=JSON.parse(JSON.stringify(payload));this.status='Saving…'
  if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;void this.flush()},1000)
 }
 async flush():Promise<void>{
  if(this.timer){clearTimeout(this.timer);this.timer=null}
  if(this.running)return this.running
  this.running=(async()=>{
   try{
    await this.identity()
    if(this.cloud.pending)await this.cloud.retry()
    while(this.queued){
     const payload=this.queued;this.queued=null
     try{await this.cloud.upload(payload)}catch(error){if(!this.cloud.pending)this.queued=payload;throw error}
    }
    this.ready=true;this.signedOut=false;this.status='Saved to your account'
   }catch(error){this.fail(error)}
  })()
  try{await this.running}finally{this.running=null}
 }
 async logout(all=false){
  await this.flush()
  if(!this.ready||this.dirty)throw new Error('Wait for your progress to save before signing out.')
  await this.cloud.logout(all);this.ready=false;this.account=''
 }
}
