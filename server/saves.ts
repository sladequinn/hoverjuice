import {validLegacySave} from '../shared/legacy-save'
import {hash,HttpError} from './security'
export async function readSave(db:D1Database,playerId:string){
 const row=await db.prepare('SELECT revision,payload,updated_at FROM legacy_saves WHERE player_id=?').bind(playerId).first<{revision:number;payload:string;updated_at:number}>()
 if(!row)throw new HttpError(404,'Save not found')
 return {playerId,schemaVersion:1,mode:'legacy-local',revision:row.revision,payload:JSON.parse(row.payload),updatedAt:row.updated_at}
}
export async function writeSave(db:D1Database,playerId:string,input:unknown){
 const b=input as Record<string,unknown>|null
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='expectedRevision,payload,playerId,requestId,schemaVersion'||b.playerId!==playerId||b.schemaVersion!==1||!Number.isSafeInteger(b.expectedRevision)||(b.expectedRevision as number)<0||typeof b.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(b.requestId)||!validLegacySave(b.payload))throw new HttpError(400,'Invalid legacy save')
 const payload=JSON.stringify(b.payload),fingerprint=await hash(JSON.stringify([b.expectedRevision,payload])),now=Date.now()
 // Receipt inserted only on matching revision, then update only for that receipt.
 // Duplicate receipts skip the mutation. Batch provides rollback on either failure.
 const results=await db.batch([
  db.prepare(`INSERT INTO save_receipts(player_id,request_id,request_hash,revision,created_at)
   SELECT player_id,?,?,revision+1,? FROM legacy_saves WHERE player_id=? AND revision=?
   ON CONFLICT(player_id,request_id) DO NOTHING`).bind(b.requestId,fingerprint,now,playerId,b.expectedRevision),
  db.prepare(`UPDATE legacy_saves SET payload=?,revision=revision+1,updated_at=? WHERE player_id=? AND revision=?
   AND EXISTS(SELECT 1 FROM save_receipts WHERE player_id=? AND request_id=? AND request_hash=? AND revision=legacy_saves.revision+1)`)
   .bind(payload,now,playerId,b.expectedRevision,playerId,b.requestId,fingerprint),
  db.prepare('SELECT request_hash,revision FROM save_receipts WHERE player_id=? AND request_id=?').bind(playerId,b.requestId)
 ])
 const row=results[2].results[0] as {request_hash:string;revision:number}|undefined
 if(!row)throw new HttpError(409,'Cloud save changed. Review it before replacing; local progress is safe.')
 if(row.request_hash!==fingerprint)throw new HttpError(409,'Request ID was already used for different data')
 return {revision:row.revision,mode:'legacy-local'}
}
