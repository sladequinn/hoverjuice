const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','47292','--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  await require('./vite-ready.cjs')(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
  let enabled=false,revision=0,payload=null;
  await page.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   let body,status=200;
   if(!enabled){status=503;body={error:'Cloud accounts are not enabled on this host'}}
   else if(path==='/api/me')body={playerId:'browser-player'};
   else if(path==='/api/wallet')body={playerId:'browser-player',balance:123,version:1};
   else if(path==='/api/save'&&request.method()==='PUT'){
    const write=request.postDataJSON();assert.equal(write.playerId,'browser-player');assert.equal(write.expectedRevision,revision);
    payload=write.payload;revision++;body={revision};
   }else body={playerId:'browser-player',schemaVersion:1,mode:'legacy-local',revision,payload,updatedAt:Date.now()};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:47292');
  await page.locator('#btn-cloud').click();
  await page.locator('[data-act="cloud-refresh"]').click();
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('not enabled')).catch(async error=>{console.error(await page.evaluate(()=>({status:window.hoverghini.cloud.status,busy:window.hoverghini.cloud.busy})));throw error});
  await page.locator('[data-act="cloud-login"]').click();
  await page.waitForFunction(()=>!window.hoverghini.cloud.busy);assert.equal(new URL(page.url()).pathname,'/');
  await page.locator('[data-act="cloud-title"]').click();assert.ok(await page.locator('#btn-new').isVisible());
  enabled=true;await page.locator('#btn-cloud').click();await page.locator('[data-act="cloud-refresh"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-act="cloud-upload"]')&&!document.querySelector('[data-act="cloud-upload"]').disabled);
  assert.ok((await page.locator('#modal').textContent()).includes('1.23 HG'));
  await page.locator('[data-act="cloud-upload"]').click();
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('backed up'));
  assert.equal(payload.money,150);assert.equal(payload.current,'board');assert.equal(revision,1);
  payload={...payload,money:500};revision++;
  await page.locator('[data-act="cloud-refresh"]').click();
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('revision 2'));
  await Promise.all([page.waitForEvent('load'),page.locator('[data-act="cloud-restore"]').click()]);
  assert.equal(await page.evaluate(()=>window.hoverghini.save.money),500);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hoverghini.save.before-cloud.v1')).money),150);
  await page.locator('#btn-cloud').click();
  await Promise.all([page.waitForEvent('load'),page.locator('[data-act="cloud-local-restore"]').click()]);
  assert.equal(await page.evaluate(()=>window.hoverghini.save.money),150);
  assert.deepEqual(errors,[]);
  console.log('Cloud account UI: title navigation, disabled backend, full save upload, wallet units, restore and local recovery passed');
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
