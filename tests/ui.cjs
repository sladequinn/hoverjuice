const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','47291','--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  await require('./vite-ready.cjs')(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('503 (Service Unavailable)'))errors.push(m.text())});
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({status:503,body:'offline fixture'}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
  await page.goto('http://127.0.0.1:47291');

  await page.evaluate(async()=>{const g=window.hoverghini;await g.warp('Test City',43.45,-80.49);document.getElementById('title').classList.remove('show');g.campaign.intro=0;g.introMessage=0;g.save.tutorial={stage:'skipped'};g.active=null;g.waypoint=null;g.updateHud();});
  await page.setViewportSize({width:390,height:844});
  await page.locator('.menu-btn').click();
  assert.equal(await page.locator('.tabs .tab').count(),4);
  assert.equal(await page.locator('#hud').isVisible(),false);
  assert.equal(await page.locator('#minimap').isVisible(),false);
  for(const view of ['market','holdings','gangs','masks','tutorial','help']){
   await page.locator('.tabs [data-arg="menu"]').click();
   await page.locator('.menu-links [data-arg="'+view+'"]').click();
   assert.equal(await page.locator('#modal').getAttribute('data-view'),view);
  }
  await page.locator('.tabs [data-arg="garage"]').click();
  assert.equal(await page.locator('details[data-fold][open]').count(),0);
  assert.equal(await page.locator('[data-act="cheat"]').count(),0);
  assert.ok(await page.locator('.tabs button').evaluateAll(bs=>bs.every(b=>{const r=b.getBoundingClientRect();return r.x>=0&&r.right<=390&&r.height>=40})));
  mkdirSync('.test-artifacts',{recursive:true});
  await page.screenshot({path:'.test-artifacts/lean-garage-mobile.png'});
  await page.locator('[data-fold="paint"] summary').click();
  await page.locator('[data-act="paint"][data-arg="rust"]').click();
  assert.ok(await page.locator('[data-fold="paint"]').evaluate(d=>d.open));
  assert.equal(await page.locator('[data-fold="upgrades"]').evaluate(d=>d.open),false);
  await page.locator('.tab-close').click();
  assert.ok(await page.locator('#hud').isVisible());
  assert.equal(await page.locator('#contract').isVisible(),false);
  assert.ok(await page.locator('#stick').isVisible());
  await page.evaluate(()=>{const g=window.hoverghini;g.toastTimer=0;document.getElementById('toast').classList.remove('show');g.waypoint={x:g.actor.x+100,z:g.actor.z,label:'Test destination'};g.updateHud()});
  assert.ok(await page.locator('#contract .client').isVisible());
  await page.screenshot({path:'.test-artifacts/lean-hud-mobile.png'});
  await page.evaluate(()=>window.hoverghini.toggleMap(true));
  assert.equal(await page.locator('.map-legend').evaluate(d=>d.open),false);
  await page.locator('.map-legend summary').click();
  assert.ok(await page.locator('.legend-items').isVisible());
  await page.locator('#map-close').click();
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>window.hoverghini.openModal('menu'));
  await page.screenshot({path:'.test-artifacts/lean-menu-desktop.png'});
  assert.deepEqual(errors,[]);
  console.log('Lean UI: navigation, mobile bounds, contextual HUD, garage folds, retained paint state and map key pass');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
