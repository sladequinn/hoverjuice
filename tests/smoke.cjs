const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','47291','--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{
   let settled=false,output='';
   const deadline=Date.now()+60000;
   const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve()};
   server.stdout.on('data',d=>{output+=d.toString().slice(-2000)});
   server.stderr.on('data',d=>{output+=d.toString().slice(-2000)});
   server.on('error',finish);
   server.on('exit',code=>finish(new Error('Vite exited '+code+'\\n'+output.slice(-4000))));
   const check=async()=>{
    if(settled)return;
    try{const response=await fetch('http://127.0.0.1:47291/');if(response.ok)return finish()}catch{}
    if(Date.now()>=deadline)return finish(new Error('Vite startup timeout after 60s\\n'+output.slice(-4000)));
    timer=setTimeout(check,250);
   };
   let timer=setTimeout(check,250);
  });
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('503 (Service Unavailable)'))errors.push(m.text())});
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({status:503,body:'offline fixture'}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
  await page.goto('http://127.0.0.1:47291');
  assert.ok(await page.locator('script[type="module"]').getAttribute('src').then(src=>src.startsWith('/assets/')&&src.endsWith('.js')),'Page must load compiled JavaScript');
  assert.ok(await page.locator('link[rel="stylesheet"]').count(),'Page must include compiled CSS');
  mkdirSync('.test-artifacts',{recursive:true});
  await page.screenshot({path:'.test-artifacts/home-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.test-artifacts/home-mobile.png'});
  await page.setViewportSize({width:1440,height:900});
  assert.equal(await page.locator('#venue-label').count(),0);
  await page.evaluate(()=>{document.getElementById('title').classList.remove('show');return window.hoverghini.warp('Test City',43.45,-80.49)});
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>window.hoverghini.player.mode),'free');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('#stick').isVisible());
  await page.evaluate(()=>{const g=window.hoverghini;g.save.contraband.cyanade=0;g.updateHud()});
  assert.equal(await page.locator('#touch-burn').isVisible(),false);
  await page.locator('#touch-mode').click();
  assert.equal(await page.evaluate(()=>window.hoverghini.player.mode),'mag');
  assert.ok(await page.locator('#stick').isVisible());
  await page.locator('#touch-mode').click();
  assert.equal(await page.evaluate(()=>window.hoverghini.player.mode),'free');
  await page.evaluate(()=>{const g=window.hoverghini;g.save.contraband.cyanade=1;g.updateHud()});
  assert.ok(await page.locator('#touch-burn').isVisible());
  await page.screenshot({path:'.test-artifacts/touch-driving.png'});
  await page.setViewportSize({width:1440,height:900});
  if(process.env.BENCHMARK){
    const timing=await page.evaluate(async()=>{
      const samples=[];let previous=performance.now();
      for(let i=0;i<90;i++)await new Promise(resolve=>requestAnimationFrame(now=>{samples.push(now-previous);previous=now;resolve()}));
      samples.sort((a,b)=>a-b);return {medianMs:samples[45],p95Ms:samples[85],buildings:window.hoverghini.world.city.buildings.length};
    });console.log('Software WebGL frame timing:',JSON.stringify(timing));
  }
  const state=await page.evaluate(()=>{
   const g=window.hoverghini;g.introMessage=0;g.campaign.intro=0;
   const input={throttle:1,brake:0,steer:0,boost:false,up:false,down:false};
   for(let i=0;i<60;i++)g.update(1/60,input);
   const speed=g.player.groundSpeed;
   if(!g.spray.activeCount)throw new Error('Moving vehicle must emit Hoverjuice');
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
  await page.setViewportSize({width:1440,height:900});
  await page.keyboard.press('y');
  assert.equal(await page.evaluate(()=>window.hoverghini.player.testFlight),true);
  const startY=await page.evaluate(()=>window.hoverghini.player.pos.y);
  await page.keyboard.down(' ');
  await page.waitForFunction(y=>window.hoverghini.player.pos.y>y+2,startY,{timeout:15000});
  await page.keyboard.up(' ');
  const highY=await page.evaluate(()=>window.hoverghini.player.pos.y);
  await page.keyboard.down('c');
  await page.waitForFunction(y=>window.hoverghini.player.pos.y<y-1,highY,{timeout:15000});
  await page.keyboard.up('c');await page.keyboard.press('y');
  assert.equal(await page.evaluate(()=>window.hoverghini.player.testFlight),false);
  await page.evaluate(()=>{
    const g=window.hoverghini;g.save.owned.push('neonic');g.selectVehicle('neonic');g.closeModal();
    const dealer=g.dealers.dealers[0];g.player.placeAtNode(g.world,dealer.node);
    g.player.mode='free';g.player.vel.set(0,0);g.save.cam='top';
    g.toastTimer=0;document.getElementById('toast').classList.remove('show');
  });
  await page.evaluate(async()=>{for(let i=0;i<30;i++)await new Promise(resolve=>requestAnimationFrame(resolve))});
  assert.equal(await page.evaluate(()=>!!window.hoverghini.player.mesh.getObjectByName('cockpit-mask')),false);
  await page.screenshot({path:'.test-artifacts/gang-dealer-car.png'});
  await page.evaluate(()=>window.hoverghini.openDealer());
  assert.ok((await page.locator('#modal-body').innerText()).includes('SLADE'));
  assert.ok((await page.locator('#modal-body').innerText()).includes('SHINOBI'));
  await page.evaluate(()=>{const g=window.hoverghini;g.save.money=100000;g.openModal('garage')});
  await page.locator('[data-fold="paint"] summary').click();
  await page.locator('[data-act="paint"][data-arg="rust"]').click();
  const beforeUpgrade=await page.evaluate(()=>({fuel:window.hoverghini.juice,tank:window.hoverghini.player.spec.tank}));
  await page.locator('[data-fold="upgrades"] summary').click();
  await page.locator('[data-act="upgrade"][data-arg="efficiency"]').click();
  const customized=await page.evaluate(()=>{const g=window.hoverghini;return {paint:g.save.builds.neonic.paint,level:g.save.builds.neonic.efficiency,tank:g.player.spec.tank,fuel:g.juice,body:g.player.spec.body}});
  assert.equal(customized.paint,'rust');assert.equal(customized.level,1);assert.ok(customized.tank>beforeUpgrade.tank);assert.equal(customized.fuel,beforeUpgrade.fuel);assert.equal(customized.body,0x874c3f);
  await page.evaluate(()=>{const g=window.hoverghini;g.selectVehicle('board');g.selectVehicle('neonic')});
  assert.equal(await page.evaluate(()=>window.hoverghini.player.spec.body),0x874c3f);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.test-artifacts/garage-upgrades-mobile.png'});
  assert.ok(await page.locator('.paint-options button').evaluateAll(bs=>bs.length===9&&bs.every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=390})));
  const limits=await page.evaluate(()=>{
   const g=window.hoverghini;g.customizeVehicle('upgrade','drive');g.customizeVehicle('upgrade','drive');g.customizeVehicle('upgrade','drive');
   const money=g.save.money;g.customizeVehicle('upgrade','drive');const afterMax=g.save.money;
   g.save.money=0;g.customizeVehicle('upgrade','handling');
   const stored=JSON.parse(localStorage.getItem('hoverghini.save.v1'));
   return {money,afterMax,handling:g.save.builds.neonic.handling,saved:stored.builds.neonic};
  });
  assert.equal(limits.money,limits.afterMax);assert.equal(limits.handling,0);assert.equal(limits.saved.paint,'rust');assert.equal(limits.saved.drive,3);

  assert.deepEqual(errors,[]);console.log('WebGL shaders, vehicle-only controls, overclock, vaults, mask UI, test-flight keyboard controls, gang dealer cars and responsive layouts: passed.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
