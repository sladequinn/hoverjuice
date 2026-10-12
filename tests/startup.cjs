const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','47291','--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Vite startup timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('Local:')){clearTimeout(timeout);resolve()}});server.on('error',reject);server.on('exit',code=>{if(code)reject(new Error('Vite exited '+code))})});
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('503 (Service Unavailable)'))errors.push(m.text())});
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({status:503,body:'offline fixture'}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
  await page.goto('http://127.0.0.1:47291');

  await page.evaluate(()=>{
   const g=window.hoverghini,prepare=g.prepareRender;
   g.prepareRender=async()=>{window.warmEntered=true;await new Promise(resolve=>window.releaseWarm=resolve);await prepare()};
   window.startPromise=g.warp('Test City',43.45,-80.49);
  });
  await page.waitForFunction(()=>window.warmEntered,{},{timeout:60000});
  const before=await page.evaluate(()=>({loading:window.hoverghini.loading,paused:window.hoverghini.paused,overlay:document.getElementById('loading').classList.contains('show'),intro:window.hoverghini.campaign.intro}));
  assert.equal(before.loading,true);assert.equal(before.paused,true);assert.equal(before.overlay,true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>window.hoverghini.campaign.intro),before.intro);
  await page.evaluate(async()=>{window.releaseWarm();await window.startPromise;document.getElementById('title').classList.remove('show');window.hoverghini.openModal('help')});
  assert.equal(await page.evaluate(()=>window.hoverghini.loading),false);assert.equal(await page.locator('#loading').evaluate(e=>e.classList.contains('show')),false);
  await page.locator('[data-fold="testing"] summary').click();
  const buy=page.locator('[data-act="test-hoverghini"]');assert.equal(await buy.isDisabled(),true);
  await page.locator('[data-act="cheat"]').click();
  assert.equal(await buy.isDisabled(),false);await buy.click();
  const purchased=await page.evaluate(()=>{const g=window.hoverghini;return {money:g.save.money,id:g.save.current,owned:g.save.owned.filter(id=>id==='hoverghini').length,won:g.save.won,fuel:g.juice,tank:g.player.spec.tank}});
  assert.equal(purchased.money,4000150);assert.equal(purchased.id,'hoverghini');assert.equal(purchased.owned,1);assert.equal(purchased.won,false);assert.equal(purchased.fuel,purchased.tank);
  await buy.click();assert.equal(await page.evaluate(()=>window.hoverghini.save.money),purchased.money);
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('hoverghini.save.v1'))).current,'hoverghini');
  assert.deepEqual(errors,[]);console.log('Startup gate, frozen intro, GPU warm-up, and test purchase pass',purchased);
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
