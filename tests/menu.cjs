const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','47294','--strictPort'],{stdio:'pipe'});let browser;
 try{
  await require('./vite-ready.cjs')(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader']});
  const page=await browser.newPage({viewport:{width:430,height:932}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
  await page.goto('http://127.0.0.1:47294');await page.waitForFunction(()=>window.hoverghini);
  assert.equal(await page.locator('h1').textContent(),'HOVERGHINI');
  mkdirSync('.test-artifacts',{recursive:true});
  for(const [name,width,height] of [['mobile',430,932],['desktop',1440,900]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.screenshot({path:`.test-artifacts/menu-${name}.png`});
   const bounds=await page.locator('#btn-new').boundingBox();assert.ok(bounds.y+bounds.height<=height,'entry stays within viewport');
  }
  await page.evaluate(()=>{document.getElementById('loading').classList.add('show');document.getElementById('loading-city').textContent='Kitchener';document.getElementById('loading-fill').style.width='72%';document.getElementById('loading-percent').textContent='72%';document.getElementById('loading-status').textContent='Laying streets, sidewalks and lighting…'});
  await page.setViewportSize({width:430,height:932});await page.screenshot({path:'.test-artifacts/loading-mobile.png'});
  assert.deepEqual(errors,[]);console.log('Menu mobile/desktop framing and loading screenshots passed');
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
