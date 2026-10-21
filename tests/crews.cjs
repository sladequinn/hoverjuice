const {chromium}=require('playwright');const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','47292','--strictPort'],{stdio:'pipe'});let browser;
 try{
  await require('./vite-ready.cjs')(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  for(const mobile of [false,true]){
   const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
   const player='11111111-1111-4111-8111-111111111111';let crew=null,commands=0;
   await page.route('**/api/**',async r=>{const req=r.request(),path=new URL(req.url()).pathname;let body={enabled:false};
    if(path==='/api/crews/status')body={enabled:true};else if(path==='/api/crews/me')body={player,crew};else if(path==='/api/crews/district')body={id:'d1:6672:3634',controller:null,name:null,contest:null,headquarters:[]};
    else if(path==='/api/crews/command'){const b=req.postDataJSON();assert.equal(b.playerId,player);assert.ok(b.requestId);commands++;crew={id:'crew',name:b.name,tag:b.tag,color:b.color,reputation:0,hq:null,role:'leader',membership:'membership',members:[{id:player,name:'Driver <safe>',role:'leader'}],invite:'a'.repeat(64),territories:[]};body={ok:true}}
    await r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   });
   await page.goto('http://127.0.0.1:47292');const money=await page.evaluate(()=>window.hoverghini.save.money);
   await page.evaluate(async()=>{const g=window.hoverghini;document.querySelector('#title').classList.remove('show');g.openModal('crews');await g.crews.activate()});
   await page.locator('#crew-name').fill('Night drivers');await page.locator('#crew-tag').fill('NITE');await page.locator('[data-act=crew-create]').click();await page.waitForSelector('[aria-label="Crew invitation code"]');
   assert.equal(commands,1);assert.ok((await page.locator('#modal-body').textContent()).includes('Night drivers'));assert.ok((await page.locator('#modal-body').textContent()).includes('Driver <safe>'));assert.equal(await page.locator('#modal-body safe').count(),0);
   assert.equal(await page.evaluate(()=>window.hoverghini.save.money),money);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.reload();await page.evaluate(async()=>{document.querySelector('#title').classList.remove('show');window.hoverghini.openModal('crews');await window.hoverghini.crews.activate()});await page.waitForSelector('[aria-label="Crew invitation code"]');assert.equal(commands,1);
   assert.deepEqual(errors,[]);await page.close();console.log(`Crews ${mobile?'mobile':'desktop'}: creation, invite, escaped affiliation, wallet isolation, reload and layout passed`);
  }
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
