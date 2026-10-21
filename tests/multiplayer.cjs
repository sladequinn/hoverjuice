const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','47292','--strictPort'],{stdio:'pipe'});let browser;
 try{
  await require('./vite-ready.cjs')(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
   await page.goto('http://127.0.0.1:47292');
   const result=await page.evaluate(async()=>{
    const {Multiplayer}=await import('/src/multiplayer.ts');const {PAINTS}=await import('/src/customization.ts');const {vehicleById}=await import('/src/data.ts');
    localStorage.setItem('hoverghini.multiplayer','off');
    const mp=new Multiplayer({lat:43.45,lon:-80.49,terrain:{datum:300}}),id='12345678-1234-1234-1234-123456789abc';
    const peer={type:'move',v:1,seq:1,lat:43.45,lon:-80.4899,y:311,clearance:1,yaw:.4,vx:0,vz:0,chassis:'hoverghini',mask:'oni',paint:'violet',boost:false,id,name:'Test Driver',epoch:1,at:Date.now()};
    mp.receive({type:'peer',peer});mp.receive({type:'peer',peer:{...peer,seq:2}});
    await new Promise(r=>setTimeout(r,90));
    const player={pos:{x:0,y:11,z:0},vel:{x:0,y:0},mode:'free',spec:vehicleById('board'),mask:'balaclava',heading:0,speed:0,boosting:false};
    const world={groundHeightAt:()=>10,hitBuilding:()=>-1};mp.update(.016,player,undefined,world);
    const remote=mp.peers.get(id),colors=[];remote.group.traverse(o=>{if(o.material?.color)colors.push(o.material.color.getHex())});
    const first={count:mp.count,x:remote.group.position.x,y:remote.group.position.y,visible:remote.group.visible,colors,label:remote.label.visible,history:remote.history.length,cap:mp.maxPeers};
    mp.receive({type:'peer',peer:{...peer,seq:1,lon:0}});if(remote.history.length!==first.history)throw Error('Accepted stale pose');
    mp.receive({type:'peer',peer:{...peer,seq:3,paint:'rust',chassis:'board'}});await new Promise(r=>setTimeout(r,90));mp.update(.016,player,undefined,world);
    const changed=remote.appearance;mp.setEnabled(false);const cleared=mp.count;mp.dispose();
    window.hoverghini.openModal('multiplayer');
    return {...first,changed,cleared,paint:PAINTS.find(p=>p.id==='violet').color,form:!!document.querySelector('#mp-code')};
   });
   assert.equal(result.count,1);assert.ok(result.visible);assert.ok(result.label);assert.ok(result.x>7&&result.x<9);assert.equal(result.y,11);assert.ok(result.colors.includes(result.paint));assert.ok(result.changed.startsWith('board:oni:rust'));assert.equal(result.cleared,0);assert.equal(result.cap,mobile?12:24);assert.ok(result.form);assert.deepEqual(errors,[]);
   await context.close();console.log(`Multiplayer ${mobile?'mobile':'desktop'}: customized mesh, terrain, deduplication, bounded peers, solo fallback and friends UI passed`);
  }
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
