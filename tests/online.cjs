const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','47297','--strictPort'],{stdio:'pipe'});let browser;
 try{
  await require('./vite-ready.cjs')(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader']});
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  const state={signedIn:false,available:true,google:true,name:'',revision:0,payload:null},writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({status:503,body:'map unavailable'}));
  await page.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(path==='/api/radio')return reply({});
   if(!state.available)return reply({error:'Unavailable'},503);
   if(path==='/api/auth/providers')return reply({google:state.google,github:true,onlineOnly:true});
   if(path==='/api/auth/google/login')return route.fulfill({contentType:'text/html',body:'Google redirect reached'});
   if(!state.signedIn)return reply({error:'Sign in required'},401);
   if(path==='/api/me')return reply({playerId:'test-player',displayName:state.name,providers:['google']});
   if(path==='/api/wallet')return reply({playerId:'test-player',balance:0});
   if(path==='/api/economy/street/me')return reply({player:'test-player',revision:0,state:{vehicles:['board'],masks:['balaclava'],current:'board',mask:'balaclava',builds:{},cargo:{},vault:{},travel:null},wallet:{balance:0}});
   if(path==='/api/multiplayer/profile'){state.name=request.postDataJSON().name;return reply({name:state.name})}
   if(path==='/api/preferences'){
    if(request.method()==='PUT'){
     const body=request.postDataJSON();writes.push(body);
     if(body.expectedRevision!==state.revision)return reply({error:'Changed on another device'},409);
     state.revision++;state.payload=body.payload;return reply({revision:state.revision});
    }
    return reply({playerId:'test-player',mode:'preferences',schemaVersion:1,revision:state.revision,payload:state.payload,updatedAt:1});
   }
   return reply({enabled:false});
  });
  await page.addInitScript(()=>localStorage.setItem('hoverghini.save.v1',JSON.stringify({money:9999999,current:'hoverghini',city:{name:'Old local save',lat:43.45,lon:-80.49}})));
  const url='http://127.0.0.1:47297';
  await page.goto(url);await page.waitForFunction(()=>window.hoverghini?.online.signedOut);
  assert.equal(await page.locator('#btn-new').textContent(),'Continue with Google');
  assert.equal(await page.locator('#btn-continue').isVisible(),false);
  await page.evaluate(()=>window.hoverghini.warp('Unauthenticated',43.45,-80.49));
  assert.equal(await page.evaluate(()=>window.hoverghini.world),null);
  assert.equal(await page.evaluate(()=>window.hoverghini.save.money),undefined);
  mkdirSync('.test-artifacts',{recursive:true});
  await page.screenshot({path:'.test-artifacts/google-signin-mobile.png'});
  await page.locator('#btn-new').click();await page.waitForURL('**/api/auth/google/login');
  state.signedIn=true;await page.goto(url);await page.waitForFunction(()=>window.hoverghini?.online.ready&&window.hoverghini?.street.ready);
  await page.locator('#driver-profile').waitFor({state:'visible'});
  await page.locator('#driver-name').fill('Night Driver');await page.locator('#btn-new').click();
  await page.waitForFunction(()=>window.hoverghini.online.displayName==='Night Driver');assert.equal(state.name,'Night Driver');
  // Deliberately unavailable maps must not turn into a playable offline grid.
  await page.evaluate(()=>window.hoverghini.warp('Map outage',43.45,-80.49));
  assert.equal(await page.evaluate(()=>window.hoverghini.world),null);
  assert.equal(await page.locator('#btn-load-sim').isVisible(),false);
  // Retired campaign actions and screens cannot create balances, inventory or claims.
  const economyUI=await page.evaluate(()=>{
   const g=window.hoverghini;
   for(const action of ['cheat','buy-landmark','buy-home','buy-good','sell-good','upgrade','test-hoverghini','challenge','stash','withdraw','accept','tutorial-sale'])g.onAction(action,'hoverghini');
   const html=['menu','garage','market','contracts','help','tutorial','properties'].map(view=>g.renderView(view)).join('');
   return {keys:Object.keys(g.save).sort(),html};
  });
  assert.deepEqual(economyUI.keys,['allegiance','cam','city','current','mask','paint','safehouse']);
  assert.doesNotMatch(economyUI.html,/data-act="(?:cheat|buy-home|buy-landmark|buy-vehicle|upgrade|buy-good|sell-good|stash|withdraw|challenge)"/);
  assert.match(economyUI.html,/No starting cash is required/);
  assert.match(economyUI.html,/Night Market/);assert.match(economyUI.html,/Cyan-ade/);assert.match(economyUI.html,/Buy vehicle/);assert.match(economyUI.html,/Organ express/);assert.match(economyUI.html,/upgrade\|drive/);
  // Account progress automatically persists without writing the retired local-save key.
  await page.evaluate(async()=>{const g=window.hoverghini;g.save.paint='steel';g.save.city={name:'Kitchener',lat:43.45,lon:-80.49};g.persist();await g.online.flush()});
  assert.equal(state.payload.paint,'steel');assert.equal(state.revision,1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hoverghini.save.v1')).money),9999999);
  await page.reload();await page.waitForFunction(()=>window.hoverghini?.online.ready&&window.hoverghini?.street.ready);
  assert.equal(await page.evaluate(()=>window.hoverghini.save.paint),'factory','Appearance preferences cannot grant equipment');
  await page.locator('#btn-continue').waitFor({state:'visible'});
  for(const [name,width,height] of [['mobile',390,844],['desktop',1440,900]]){
   await page.setViewportSize({width,height});await page.screenshot({path:`.test-artifacts/online-account-${name}.png`});
   const bounds=await page.locator('#btn-new').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=height,'account controls fit viewport');
  }
  state.available=false;await page.evaluate(()=>window.hoverghini.online.heartbeat());assert.equal(await page.evaluate(()=>window.hoverghini.online.ready),false);
  const previous=writes.length;await page.evaluate(()=>{const g=window.hoverghini;g.save.paint='rust';g.persist()});assert.equal(writes.length,previous);
  state.available=true;await page.evaluate(()=>window.hoverghini.online.heartbeat());assert.equal(await page.evaluate(()=>window.hoverghini.online.ready),true);
  state.revision++;state.payload.paint='bone';
  await page.evaluate(async()=>{const g=window.hoverghini;g.save.paint='olive';g.persist();await g.online.flush()});
  assert.equal(await page.evaluate(()=>window.hoverghini.online.conflict),true);assert.equal(state.payload.paint,'bone');
  // Independently test simulation suspension. Keep the title visible so rendering cannot access the sentinel world.
  const stopped=await page.evaluate(()=>{const g=window.hoverghini;let updates=0;g.world={};g.multiplayer={connection:{connected:false},update(){updates++}};g.player.pos.set(10,2,10);g.update(1,{throttle:1,brake:0,steer:0,boost:false,up:false,down:false});g.world=null;g.multiplayer=null;return {updates,x:g.player.pos.x}});
  assert.equal(stopped.x,10);assert.equal(stopped.updates,1);
  await page.evaluate(()=>window.hoverghini.cloud.discardPending());
  state.signedIn=false;state.google=false;await page.reload();await page.waitForFunction(()=>window.hoverghini?.online.signedOut);
  assert.equal(await page.locator('#btn-new').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log('Online admission, Google entry, profiles, autosave, disconnect, conflicts and no offline fallback passed');
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
