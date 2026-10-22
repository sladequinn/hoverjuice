import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {propertyView,quoteProperty,purchaseProperty} from '../server/property-registry'
import {issueSession} from '../server/auth'
import {transactWallet} from '../server/wallet'
import {streetAccount,streetBoard,streetQuote,streetTrade,streetCommand,streetMe} from '../server/street'
import {courierQuote} from '../server/courier'
import {admitFreight,settleFreight} from '../server/economy'
import {districtFor,districtBounds} from '../shared/crews'
import {exchange,cargoCount,vehiclePrice,streetPrice,GOODS} from '../shared/street'
import {neighbours} from '../shared/economy'
let mf:Miniflare,db:D1Database
const district=districtFor({lat:43.45,lon:-80.49}),position=exchange(district)
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'street',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-01',d1Databases:['DB']}]}));db=await mf.getD1Database('DB') as any
 for(const name of readdirSync('server/migrations').sort())for(const q of readFileSync('server/migrations/'+name,'utf8').replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|INSERT INTO (?:property_catalog_clock|freight_fund|street_fund)|$)/).map(s=>s.trim()).filter(Boolean))await db.prepare(q).run()
})
after(async()=>{await mf?.dispose()})
async function player(funds=1000000){const a=await issueSession(db,crypto.randomUUID());await streetAccount(db,a.playerId);if(funds)await transactWallet(db,a.playerId,'fixture-credit',funds,'test fixture');return a.playerId}
async function tradeInput(p:string,side='buy',quantity=1,d=district){const q=await streetQuote(db,p,{district:d,good:'cyanade',side,quantity},exchange(d));return {playerId:p,expectedRevision:(await streetAccount(db,p)).revision,requestId:crypto.randomUUID(),quoteId:q.id}}
async function command(p:string,action:string,item:string){return {playerId:p,requestId:crypto.randomUUID(),expectedRevision:(await streetAccount(db,p)).revision,action,item}}
test('street trades atomically exchange HG, stock and inventory; replay cannot duplicate either side',async()=>{
 const p=await player(),before=await streetMe(db,p),fund=await db.prepare('SELECT available FROM street_fund').first<any>(),b=await tradeInput(p,'buy',3),q=await db.prepare('SELECT * FROM street_quotes WHERE id=?').bind(b.quoteId).first<any>()
 const bought=await streetTrade(db,p,b,position);assert.equal(bought.state.cargo.cyanade,3);assert.equal((bought.wallet as any).balance,(before.wallet as any).balance-q.unit_price*3)
 await streetTrade(db,p,b,position);assert.equal((await streetMe(db,p)).revision,1)
 assert.equal((await db.prepare('SELECT available FROM street_fund').first<any>()).available,fund.available+q.unit_price*3)
 const sell=await tradeInput(p,'sell',2);const sold=await streetTrade(db,p,sell,position);await streetTrade(db,p,sell,position)
 assert.equal(sold.state.cargo.cyanade,1);assert.equal((await streetMe(db,p)).revision,2)
 assert.equal((await db.prepare("SELECT count(*) n FROM wallet_ledger WHERE player_id=? AND operation_id LIKE 'street:%'").bind(p).first<any>()).n,2)
 await assert.rejects(()=>streetTrade(db,p,{...b,quoteId:sell.quoteId},position),/different command/)
})
test('insufficient cash, capacity, stock, inventory and dealer funds roll back the whole trade',async()=>{
 const p=await player(0),b=await tradeInput(p);await assert.rejects(()=>streetTrade(db,p,b,position),/Balance/);assert.equal((await streetMe(db,p)).revision,0)
 const rich=await player(9000000),big=await tradeInput(rich,'buy',9);await assert.rejects(()=>streetTrade(db,rich,big,position),/full/)
 const naked=await tradeInput(rich,'sell',1);await assert.rejects(()=>streetTrade(db,rich,naked,position),/Not enough/)
 await streetTrade(db,rich,await tradeInput(rich),position)
 const sell=await tradeInput(rich,'sell',1),account=await streetMe(db,rich),fund=await db.prepare('SELECT available FROM street_fund').first<any>()
 await db.prepare('UPDATE street_fund SET available=0').run()
 await assert.rejects(()=>streetTrade(db,rich,sell,position),/Balance/);assert.deepEqual(await streetMe(db,rich),account)
 await db.prepare('UPDATE street_fund SET available=?').bind(fund.available).run()
 const stockDistrict=neighbours(district)[1];await streetBoard(db,stockDistrict);await db.prepare("UPDATE street_markets SET stock=0 WHERE district=? AND good='cyanade'").bind(stockDistrict).run()
 const dry=await tradeInput(p,'buy',1,stockDistrict);await assert.rejects(()=>streetTrade(db,p,dry,exchange(stockDistrict)),/Balance/)
})
test('concurrent last-stock buyers and simultaneous spending admit only one transaction',async()=>{
 const d=neighbours(district)[2],spot=exchange(d);await streetBoard(db,d);await db.prepare("UPDATE street_markets SET stock=1,revision=revision+1 WHERE district=? AND good='cyanade'").bind(d).run()
 const a=await player(),b=await player(),qa=await tradeInput(a,'buy',1,d),qb=await tradeInput(b,'buy',1,d)
 const results=await Promise.allSettled([streetTrade(db,a,qa,spot),streetTrade(db,b,qb,spot)])
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1)
 const p=await player(vehiclePrice('neonic')),one=await command(p,'buy-vehicle','neonic'),two={...one,requestId:crypto.randomUUID()}
 const buys=await Promise.allSettled([streetCommand(db,p,one,position),streetCommand(db,p,two,position)])
 assert.equal(buys.filter(x=>x.status==='fulfilled').length,1);assert.equal((await streetMe(db,p)).state.vehicles.filter(x=>x==='neonic').length,1)
})
test('garage purchases, equipped ownership, upgrades and capacity are authoritative',async()=>{
 const p=await player(10000000)
 await assert.rejects(()=>streetCommand(db,p,commandBad(p,'equip-vehicle','hoverghini',0),position),/Purchase/)
 const buy=await command(p,'buy-vehicle','neonic');await streetCommand(db,p,buy,position);await streetCommand(db,p,buy,position)
 await streetCommand(db,p,await command(p,'equip-vehicle','neonic'),position)
 for(let i=0;i<3;i++)await streetCommand(db,p,await command(p,'upgrade','drive'),position)
 await assert.rejects(()=>streetCommand(db,p,commandBad(p,'upgrade','drive',5),position),/maxed/)
 await streetCommand(db,p,await command(p,'buy-mask','oni'),position);await streetCommand(db,p,await command(p,'equip-mask','oni'),position)
 const v=await streetMe(db,p);assert.equal(v.state.current,'neonic');assert.equal(v.state.mask,'oni');assert.equal(v.state.builds.neonic.drive,3)
 await streetTrade(db,p,await tradeInput(p,'buy',9),position)
 await assert.rejects(()=>streetCommand(db,p,commandBad(p,'equip-vehicle','board',8),position),/smaller/)
 assert.equal(cargoCount((await streetMe(db,p)).state),9)
})
function commandBad(playerId:string,action:string,item:string,expectedRevision:number){return {playerId,action,item,expectedRevision,requestId:crypto.randomUUID()}}
test('quotes reject forged prices, remote trades, expired quotes, and instant city-hop cargo sales',async()=>{
 const p=await player(),q={district,good:'cyanade',side:'buy',quantity:1}
 await assert.rejects(()=>streetQuote(db,p,{...q,price:1},position),/Invalid/)
 await assert.rejects(()=>streetQuote(db,p,q,{lat:0,lon:0}),/exchange/)
 const expired=await tradeInput(p);await db.prepare('UPDATE street_quotes SET expires_at=0 WHERE id=?').bind(expired.quoteId).run();await assert.rejects(()=>streetTrade(db,p,expired,position),/expired/)
 await streetTrade(db,p,await tradeInput(p),position)
 const d=neighbours(district)[0];await assert.rejects(()=>streetQuote(db,p,{...q,district:d,side:'sell'},exchange(d)),/transit/)
 await assert.rejects(async()=>streetTrade(db,p,{...await tradeInput(p,'sell'),delta:999},position),/Invalid/)
 await assert.rejects(async()=>streetCommand(db,p,{...await command(p,'buy-vehicle','hoverghini'),cost:0},position),/Invalid/)
 const other=await player();await assert.rejects(()=>streetTrade(db,other,expired,position),/Invalid/)
})
test('failed inventory write rolls back wallet debit and receipt; exact retry succeeds',async()=>{
 const p=await player(),b=await tradeInput(p),before=await streetMe(db,p)
 await db.prepare("CREATE TRIGGER street_failure BEFORE UPDATE ON street_accounts BEGIN SELECT RAISE(ABORT,'injected'); END").run()
 try{await assert.rejects(()=>streetTrade(db,p,b,position));assert.deepEqual(await streetMe(db,p),before);assert.equal((await db.prepare('SELECT count(*) n FROM street_receipts WHERE player_id=?').bind(p).first<any>()).n,0)}finally{await db.prepare('DROP TRIGGER street_failure').run()}
 await streetTrade(db,p,b,position);assert.equal((await streetMe(db,p)).state.cargo.cyanade,1)
})
test('stash requires a real owned nearby property and never mints cargo',async()=>{
 const p=await player();await streetTrade(db,p,await tradeInput(p,'buy',2),position)
 await assert.rejects(()=>streetCommand(db,p,commandBad(p,'stash','',1),position),/owned property|your properties/)
 await db.prepare(`INSERT INTO global_properties(id,name,lat,lon,cell,geometry,fingerprint,area,levels,source_version,verified_at,price_minor,status,created_at) VALUES('osm:way:999','Stash fixture',?,?,?,'[]','test',200,1,1,?,100,'active',?)`).bind(position.lat,position.lon,district.slice(3),Date.now(),Date.now()).run()
 const title=await propertyView(db,'osm:way:999'),quote=await quoteProperty(db,p,title)
 await purchaseProperty(db,p,{playerId:p,quoteId:quote!.id,requestId:crypto.randomUUID()})
 const stash=await command(p,'stash','');await streetCommand(db,p,stash,position);await streetCommand(db,p,stash,position)
 assert.equal(cargoCount((await streetMe(db,p)).state),0);assert.equal((await streetMe(db,p)).state.vault.cyanade,2)
 const take=await command(p,'withdraw','');await streetCommand(db,p,take,position);await streetCommand(db,p,take,position)
 assert.equal((await streetMe(db,p)).state.cargo.cyanade,2);assert.equal((await streetMe(db,p)).state.vault.cyanade,0)
})
test('regional supply and hourly shocks create trade spreads without same-market round-trip profit',()=>{
 const d=neighbours(district)[0]
 assert.ok(GOODS.some(g=>streetPrice(d,g.id,80,0).ask!==streetPrice(district,g.id,80,0).ask))
 for(const g of GOODS)for(let hour=0;hour<24;hour++){const q=streetPrice(district,g.id,80,hour*3600000);assert.ok(q.bid<q.ask)}
})
test('courier quotes choose server cargo, reward and deadline; admission and settlement are idempotent',async()=>{
 const p=await player(0),bounds=districtBounds(district),destination=neighbours(district)[0],start={lat:bounds.north-.0016,lon:bounds.lon},end={lat:bounds.north+.0016,lon:bounds.lon}
 const env={DB:db,PROPERTY_SOURCE:{idFromName:(s:string)=>s,get:()=>({fetch:async()=>Response.json({data:{elements:[{type:'way',id:99,nodes:[1,2,3],tags:{highway:'residential'},geometry:[start,{lat:bounds.north,lon:bounds.lon},end]}]}})})}} as any
 const q=await courierQuote(env,p,{origin:district,destination,mission:'express'})
 const unused=await courierQuote(env,p,{origin:district,destination,mission:'parcel'});await db.prepare('DELETE FROM freight_quotes WHERE id=?').bind(unused.id).run();assert.equal(await db.prepare('SELECT * FROM courier_quotes WHERE quote_id=?').bind(unused.id).first(),null)
 assert.equal(q.commodity,'nightbloom');assert.equal(q.mission,'express');assert.ok(q.duration>=60000);assert.ok(q.net>0)
 await assert.rejects(()=>courierQuote(env,p,{origin:district,destination,mission:'express',reward:1000000}),/Invalid/)
 const b={playerId:p,quoteId:q.id,requestId:crypto.randomUUID()},run=await admitFreight(db,p,b,start)
 assert.equal(run.expires_at-run.created_at,q.duration);assert.equal((await admitFreight(db,p,b,start)).id,run.id)
 await settleFreight(db,run.id,'delivered',p);await settleFreight(db,run.id,'delivered',p)
 assert.equal(((await streetMe(db,p)).wallet as any).balance,q.net)
})

test('bulk buy and immediate resale cannot pump price to manufacture profit',async()=>{
 const p=await player(10000000),d=neighbours(district)[3],spot=exchange(d)
 await streetCommand(db,p,await command(p,'buy-vehicle','z150'),position);await streetCommand(db,p,await command(p,'equip-vehicle','z150'),position)
 await streetBoard(db,d);await db.prepare("UPDATE street_markets SET stock=120,revision=revision+1 WHERE district=? AND good='cyanade'").bind(d).run()
 const before=(await streetMe(db,p)).wallet as any
 await streetTrade(db,p,await tradeInput(p,'buy',70,d),spot);await streetTrade(db,p,await tradeInput(p,'sell',70,d),spot)
 const after=await streetMe(db,p);assert.ok((after.wallet as any).balance<before.balance);assert.equal(cargoCount(after.state),0)
})
