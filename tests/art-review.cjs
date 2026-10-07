// Repeatable offline art-review frames; this is not a hardware FPS benchmark.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync,writeFileSync,readFileSync,existsSync}=require('node:fs');
const path=require('node:path');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','47292','--strictPort'],{stdio:'pipe'});let browser;
 try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Vite timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('Local:')){clearTimeout(t);resolve()}});server.on('error',reject)});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('503 (Service Unavailable)'))errors.push(m.text())});
 await page.route('https://tiles.openfreemap.org/**',r=>{
  const folder=process.env.TILE_FIXTURE,url=r.request().url(),match=url.match(/\/(14)\/(\d+)\/(\d+)\.pbf/);
  const file=folder&&path.join(folder,match?match.slice(1).join('_')+'.pbf':'tilejson.json');
  return file&&existsSync(file)?r.fulfill({body:readFileSync(file),contentType:match?'application/x-protobuf':'application/json'}):r.fulfill({status:503,body:'offline fixture'});
 });await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
 const dir='.test-artifacts/art-'+(process.env.ART_ROUND||'baseline');mkdirSync(dir,{recursive:true});
 await page.goto('http://127.0.0.1:47292');await page.screenshot({path:dir+'/home.png'});
 await page.evaluate(async real=>{document.getElementById('title').classList.remove('show');const g=window.hoverghini;await g.warp(real?'Kitchener':'Test City',real?43.4516:43.45,real?-80.4925:-80.49);g.introMessage=0;g.campaign.intro=0;g.run.repair();g.save.cam='chase';g.save.money=1840;if(g.boss)g.boss.visible=false;const ns=g.world.city.nodes;let best=0,d=Infinity;ns.forEach((n,i)=>{if(n.adj.length>1&&n.x*n.x+n.z*n.z<d){best=i;d=n.x*n.x+n.z*n.z}});g.player.placeAtNode(g.world,best);const a=ns[g.player.edgeA],b=ns[g.player.edgeB];g.player.edgeS=Math.hypot(a.x-b.x,a.z-b.z)*.45;g.toastTimer=0;document.getElementById('toast').classList.remove('show')},!!process.env.TILE_FIXTURE);
 const settle=()=>page.evaluate(async()=>{for(let i=0;i<30;i++)await new Promise(requestAnimationFrame)});
 await settle();await page.screenshot({path:dir+'/board.png'});
 await page.evaluate(()=>{const g=window.hoverghini;g.save.owned.push('neonic');g.selectVehicle('neonic');g.closeModal();g.toastTimer=0;document.getElementById('toast').classList.remove('show')});await settle();await page.screenshot({path:dir+'/car.png'});
 await page.setViewportSize({width:390,height:844});await settle();await page.screenshot({path:dir+'/mobile.png'});
 const stats=await page.evaluate(()=>({...window.hoverjuiceRenderStats(),procedural:window.hoverghini.world.city.procedural,roads:window.hoverghini.world.city.roads.length,lamps:window.hoverghini.world.group.getObjectByName('streetlight-poles')?.count}));
 if(process.env.TILE_FIXTURE){
  if(stats.procedural)throw Error('Real tile fixture fell back to procedural city');
  await page.evaluate(()=>{const g=window.hoverghini,ns=g.world.city.nodes;const near=ns.map((n,i)=>({n,i})).filter(({n})=>n.adj.length>2).sort((a,b)=>Math.hypot(a.n.x,a.n.z)-Math.hypot(b.n.x,b.n.z))[0];g.player.placeAtNode(g.world,near.i);g.save.cam='top'});
  await settle();await page.screenshot({path:dir+'/junction-mobile.png'});
 }writeFileSync(dir+'/metrics.json',JSON.stringify({errors,stats},null,2));console.log(JSON.stringify({dir,errors,stats}));if(errors.length)throw Error(errors.join('\n'));
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
