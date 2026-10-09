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
  const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('503 (Service Unavailable)'))errors.push(m.text())});
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({status:503,body:'offline fixture'}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
  await page.goto('http://127.0.0.1:47291');

  await page.evaluate(()=>{document.getElementById('title').classList.remove('show');return window.hoverghini.warp('Map test',43.45,-80.49)});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{const g=window.hoverghini;g.campaign.intro=0;g.introMessage=0;g.toggleMap(true)});
  const markers=await page.evaluate(()=>window.hoverghini.mapMarkers().map(m=>m.symbol));
  assert.ok(markers.includes('D'));assert.ok(markers.includes('C'));assert.ok(markers.includes('H'));
  mkdirSync('.test-artifacts',{recursive:true});
  await page.screenshot({path:'.test-artifacts/living-map.png'});
  const center=await page.evaluate(()=>({...window.hoverghini.mapCenter}));
  await page.mouse.move(250,420);await page.mouse.down();await page.mouse.move(290,470,{steps:4});await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(()=>window.hoverghini.mapCenter),center);
  await page.locator('#map-center').click();
  assert.deepEqual(await page.evaluate(()=>window.hoverghini.mapCenter),center);

  await page.evaluate(()=>{const g=window.hoverghini,c=g.offers[0],n=g.world.city.nodes[c.from];g.mapCenter={x:n.x,z:n.z};g.drawFullMap()});
  await page.locator('#full-map').click({position:{x:195,y:422}});
  await page.locator('[data-act=accept]').click();
  assert.ok(await page.evaluate(()=>!!window.hoverghini.active));
  await page.evaluate(()=>window.hoverghini.toggleMap(true));
  const activeMarkers=await page.evaluate(()=>window.hoverghini.mapMarkers().map(m=>m.symbol));
  assert.ok(activeMarkers.includes('P'));assert.ok(activeMarkers.includes('X'));
  await page.evaluate(()=>{const g=window.hoverghini;g.active=null;g.mapCenter={x:5000,z:5000};g.drawFullMap()});
  await page.locator('#full-map').click({position:{x:195,y:422}});
  assert.equal(await page.evaluate(()=>window.hoverghini.waypoint.label),'Map waypoint');
  const house=await page.evaluate(()=>{
    const g=window.hoverghini,b=g.world.city.buildings[0];b.tags={building:'house'};b.eligible=false;b.clipped=false;
    g.buildMinimap();g.mapCenter={x:b.cx,z:b.cz};g.zoomMap(12);
    return {x:b.cx,z:b.cz,minX:b.minX};
  });
  await page.locator('#full-map').click({position:{x:195,y:422}});
  assert.ok(await page.locator('[data-act=buy-home]').isDisabled());
  await page.evaluate(()=>{const g=window.hoverghini;g.save.money=3000000;g.showMapBuilding(0)});
  await page.locator('[data-act=buy-home]').click();
  const purchased=await page.evaluate(()=>({home:window.hoverghini.save.homes[0],money:window.hoverghini.save.money}));
  assert.equal(await page.evaluate(()=>window.hoverghini.save.homes.length),1);
  assert.equal(purchased.money,3000000-purchased.home.price);
  await page.evaluate(()=>window.hoverghini.buyHome(0));
  assert.equal(await page.evaluate(()=>window.hoverghini.save.money),purchased.money);
  await page.screenshot({path:'.test-artifacts/safehouse-map.png'});
  await page.evaluate(h=>{
    const g=window.hoverghini;g.toggleMap(false);g.player.unsnap();g.player.pos.set(h.minX-2,1.3,h.z);g.player.vel.set(0,0);g.player.speed=0;
    g.run.heat=3;g.save.contraband.cyanade=2;g.stash();
  },house);
  assert.equal(await page.evaluate(()=>window.hoverghini.save.vaultCargo.cyanade),2);
  assert.equal(await page.evaluate(()=>window.hoverghini.run.heat),0);
  await page.reload();assert.equal(await page.evaluate(()=>window.hoverghini.save.homes[0].id),purchased.home.id);
  assert.deepEqual(errors,[]);console.log('Map markers, pan/recenter, residential selection, purchase guards, stash, Heat and persistence passed.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
