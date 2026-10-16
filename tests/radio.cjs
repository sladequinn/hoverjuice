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


  const wav=Buffer.alloc(44+8000*2*5);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  await page.route('https://radio.test/**',r=>r.fulfill({contentType:'audio/wav',body:wav}));
  await page.route('**/radio.json',r=>r.fulfill({json:{shinobi:[{title:'Test broadcast',url:'https://radio.test/one.wav'},{title:'Next broadcast',url:'https://radio.test/two.wav'}],talk:[{title:'Talk episode',url:'https://radio.test/talk.wav'}]}}));
  await page.evaluate(async()=>{const g=window.hoverghini;await g.radio.load();await g.warp('Test City',43.45,-80.49);document.getElementById('title').classList.remove('show');g.campaign.intro=0;g.openModal('radio')});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.radio-stations button').count(),6);
  await page.locator('[data-act="radio-station"][data-arg="shinobi"]').click();
  await page.waitForFunction(()=>window.hoverghini.radio.playing);
  assert.match(await page.evaluate(()=>window.hoverghini.radio.audio.currentSrc),/one.wav/);
  await page.locator('[data-act="radio-next"]').click();
  await page.waitForFunction(()=>window.hoverghini.radio.audio.currentSrc.includes('two.wav'));
  await page.locator('#radio-volume').fill('25');
  assert.equal(await page.evaluate(()=>window.hoverghini.radio.audio.volume),.25);
  await page.locator('[data-act="radio-station"][data-arg="police"]').click();
  await page.waitForFunction(()=>window.hoverghini.radio.station==='police'&&window.hoverghini.radio.playing);
  assert.equal(await page.evaluate(()=>window.hoverghini.radio.audio.paused),true);
  await page.evaluate(()=>{const g=window.hoverghini;g.run.heat=3;g.radio.sequence=0});
  await page.locator('[data-act="radio-next"]').click();
  await page.waitForFunction(()=>window.hoverghini.radio.status.includes('no active pursuit'));
  await page.evaluate(()=>{window.hoverghini.police={message:'Active pursuit. Units following the suspect.'}});
  await page.locator('[data-act="radio-next"]').click();
  await page.waitForFunction(()=>window.hoverghini.radio.status.startsWith('Active pursuit.'));
  await page.locator('[data-act="radio-station"][data-arg="liars"]').click();
  await page.waitForFunction(()=>window.hoverghini.radio.status==='No broadcast configured');
  assert.equal(await page.evaluate(()=>window.hoverghini.radio.playing),false);
  await page.locator('[data-act="radio-station"][data-arg="talk"]').click();
  await page.waitForFunction(()=>window.hoverghini.radio.playing);
  await page.locator('[data-act="radio-play"]').click();
  assert.equal(await page.evaluate(()=>window.hoverghini.radio.audio.paused),true);
  mkdirSync('.test-artifacts',{recursive:true});await page.screenshot({path:'.test-artifacts/radio-mobile.png'});
  await page.locator('[data-act="radio-station"][data-arg="off"]').click();
  await page.waitForFunction(()=>window.hoverghini.radio.station==='off');
  assert.deepEqual(errors,[]);
  console.log('Radio: six stations, direct WAV playback, next, volume, scanner, empty channels, pause/off pass');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
