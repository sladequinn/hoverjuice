const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','47291','--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Vite startup timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('Local:')){clearTimeout(timeout);resolve()}});server.on('error',reject);server.on('exit',code=>{if(code)reject(new Error('Vite exited '+code))})});
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('503 (Service Unavailable)'))errors.push(m.text())});
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({status:503,body:'offline fixture'}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
  await page.goto('http://127.0.0.1:47291');
  assert.ok(await page.locator('script[type="module"]').getAttribute('src').then(src=>src.startsWith('/assets/')&&src.endsWith('.js')),'Page must load compiled JavaScript');
  assert.ok(await page.locator('link[rel="stylesheet"]').count(),'Page must include compiled CSS');
  await page.evaluate(()=>{document.getElementById('title').classList.remove('show');return window.hoverghini.warp('Test City',43.45,-80.49)});
  await page.waitForTimeout(1000);
  const state=await page.evaluate(()=>{
   const g=window.hoverghini;g.introMessage=0;g.campaign.intro=0;
   const input={throttle:1,brake:0,steer:0,boost:false,up:false,down:false};
   for(let i=0;i<60;i++)g.update(1/60,input);
   const speed=g.player.groundSpeed;
   g.save.contraband.cyanade=2;g.overclock();const hull=g.run.hull;g.overclock();
   const cargo=g.save.contraband.cyanade;
   g.run.repair();g.save.money=500;g.player.placeAtNode(g.world,g.garageNode);g.stash();
   const banked=g.save.vaultCash;g.stash(true);
   return {speed,hull,cargo,banked,money:g.save.money,mask:g.save.mask,walking:typeof g.toggleVehicle};
  });
  assert.ok(state.speed>0);assert.equal(state.hull,75);assert.equal(state.cargo,1);assert.equal(state.banked,500);assert.equal(state.money,500);assert.equal(state.walking,'undefined');
  await page.keyboard.press('x');
  await page.evaluate(()=>window.hoverghini.openModal('masks'));await page.waitForTimeout(200);await page.evaluate(()=>window.hoverghini.closeModal());
  mkdirSync('.test-artifacts',{recursive:true});await page.screenshot({path:'.test-artifacts/noir-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);await page.screenshot({path:'.test-artifacts/noir-mobile.png'});
  assert.deepEqual(errors,[]);console.log('WebGL shaders, vehicle-only controls, overclock, vaults, mask UI and responsive layouts: passed.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
