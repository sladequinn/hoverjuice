const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','47291','--strictPort'],{stdio:'pipe'});
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
  const stats=await page.evaluate(()=>{const g=window.hoverghini;g.paused=true;return {cars:g.traffic.agents.length,sites:g.traffic.sites.length,parked:g.traffic.agents.filter(c=>c.phase==='park').length,fleets:g.traffic.group.children.length}});
  assert.ok(stats.cars>=72&&stats.cars<=192);assert.equal(stats.fleets,3);assert.ok(stats.sites>0);assert.ok(stats.parked>0);
  await page.evaluate(()=>window.hoverghini.openModal('help'));
  const sound=page.locator('[data-act="traffic-sound"]');await sound.click();
  assert.match(await sound.textContent(),/OFF/);assert.equal(await page.evaluate(()=>localStorage.getItem('hoverjuice.traffic-sound')),'off');
  await sound.click();assert.match(await sound.textContent(),/ON/);
  await page.locator('.tab-close').click();
  await page.evaluate(async()=>{
   const g=window.hoverghini;g.paused=true;
   const THREE=await import('/node_modules/three/build/three.module.js');
   const scene=g.scene.clone();
   const car=g.traffic.agents.find(c=>c.phase==='park');
   const camera=new THREE.PerspectiveCamera(45,1440/900,.1,1000);camera.position.set(car.pos.x+18,car.pos.y+15,car.pos.z-24);camera.lookAt(car.pos);
   const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1440,900);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;renderer.render(scene,camera);
   renderer.domElement.style.cssText='position:fixed;inset:0;z-index:99999';document.body.append(renderer.domElement);
  });
  mkdirSync('.test-artifacts',{recursive:true});await page.screenshot({path:'.test-artifacts/city-life.png'});
  assert.deepEqual(errors,[]);console.log('City life browser checks:',stats);
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
