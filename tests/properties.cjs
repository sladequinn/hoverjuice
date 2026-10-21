const {chromium}=require('playwright');const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','47292','--strictPort'],{stdio:'pipe'});let browser;
 try{
  await require('./vite-ready.cjs')(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  for(const mobile of [false,true]){
   const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
   const playerId='11111111-1111-4111-8111-111111111111',quoteId='22222222-2222-4222-8222-222222222222';let balance=1000000,buys=0;
   const property={id:'osm:way:123',name:'Test building <safe>',lat:43.45,lon:-80.49,priceMinor:500000,ownerId:null,ownerName:null,status:'active',revision:1,area:100,levels:1,sourceVersion:1,acquiredAt:null};
   await page.route('**/api/**',async r=>{const req=r.request(),path=new URL(req.url()).pathname;let body={enabled:false};
    if(path==='/api/properties/status')body={enabled:true};else if(path==='/api/me')body={playerId};else if(path==='/api/wallet')body={playerId,balance};
    else if(path==='/api/properties/inspect'||path==='/api/properties/quote')body={playerId,property,quote:{id:quoteId,playerId,propertyId:property.id,priceMinor:property.priceMinor,revision:1,expiresAt:Date.now()+300000}};
    else if(path==='/api/properties/purchase'){const request=req.postDataJSON();assert.deepEqual(Object.keys(request).sort(),['playerId','quoteId','requestId']);buys++;balance-=property.priceMinor;property.ownerId=playerId;property.revision++;body={property,receipt:{...request,propertyId:property.id,priceMinor:property.priceMinor,balance,walletVersion:1,createdAt:Date.now()}}}
    else if(path==='/api/properties/item')body={playerId,property};else if(path==='/api/properties/portfolio'||path==='/api/properties/area')body={items:property.ownerId?[property]:[],next:null};
    await r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   });
   await page.goto('http://127.0.0.1:47292');
   const localMoney=await page.evaluate(()=>window.hoverghini.save.money);
   await page.evaluate(async()=>{const g=window.hoverghini;document.querySelector('#title').classList.remove('show');g.openModal('property');await g.properties.inspect({lat:43.45,lon:-80.49})});
   assert.ok((await page.locator('#modal-body').textContent()).includes('Test building <safe>'));assert.equal(await page.locator('#modal-body safe').count(),0);
   await page.locator('[data-act=global-buy]').click();await page.waitForFunction(()=>window.hoverghini.properties.selected.ownerId!==null);
   assert.equal(buys,1);assert.equal(balance,500000);assert.equal(await page.evaluate(()=>window.hoverghini.save.money),localMoney);assert.ok((await page.locator('#modal-body').textContent()).includes('Owner: You'));
   await page.locator('[data-act=global-portfolio]').click();await page.waitForSelector('[data-act=global-item]');assert.ok((await page.locator('#modal-body').textContent()).includes('osm:way:123'));
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
   await page.reload();await page.evaluate(()=>{document.querySelector('#title').classList.remove('show');window.hoverghini.onAction('global-portfolio','')});await page.waitForSelector('[data-act=global-item]');assert.equal(await page.evaluate(()=>window.hoverghini.properties.items[0].ownerId),playerId);
   assert.deepEqual(errors,[]);await page.close();console.log(`Global property ${mobile?'mobile':'desktop'}: inspection, escaped source name, purchase, wallet isolation, portfolio and reload passed`);
  }
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
