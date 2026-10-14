/** SERVER-ONLY service. No public route accepts a delta, balance, reward or price.
 * Caller must derive delta/reason/operationId from a trusted, validated domain event.
 * Keep operation IDs for the lifetime of the ledger; retries return the original result.
 */
export async function transactWallet(db:D1Database, playerId:string, operationId:string, delta:number, reason:string) {
 if(!/^[a-zA-Z0-9:_-]{1,128}$/.test(operationId)||!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>9e12||!reason||reason.length>120)throw new Error('Invalid wallet operation')
 const results=await db.batch([
  db.prepare(`INSERT INTO wallet_ledger(player_id,operation_id,delta,reason,balance_after,version,created_at)
   SELECT player_id,?,?,?,balance+?,version+1,? FROM wallets WHERE player_id=?
   AND NOT EXISTS(SELECT 1 FROM wallet_ledger WHERE player_id=? AND operation_id=?)`)
   .bind(operationId,delta,reason,delta,Date.now(),playerId,playerId,operationId),
  db.prepare('SELECT delta,reason,balance_after,version FROM wallet_ledger WHERE player_id=? AND operation_id=?').bind(playerId,operationId)
 ])
 const row=results[1].results[0] as {delta:number;reason:string;balance_after:number;version:number}|undefined
 if(!row)throw new Error('Wallet not found')
 if(row.delta!==delta||row.reason!==reason)throw new Error('Idempotency key reused with different operation')
 return {balance:row.balance_after,version:row.version}
}
