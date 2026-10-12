const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','47292','--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Vite startup timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('Local:')){clearTimeout(timeout);resolve()}});server.on('error',reject)});
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({body:''}));
  await page.goto('http://127.0.0.1:47292');
  const result=await page.evaluate(async()=>{
   const THREE=await import('/node_modules/three/build/three.module.js');
   const {TerrainField}=await import('/src/terrain.ts');
   const {World}=await import('/src/world.ts');
   const {proceduralCity,MapStreamer,makeBuilding}=await import('/src/map.ts');
   const {HoverjuiceSpray}=await import('/src/hoverjuice.ts');
   const {buildVehicleMesh}=await import('/src/vehicle.ts');
   const {VEHICLES}=await import('/src/data.ts');
   const originalFetch=window.fetch;
   window.fetch=async(url,options)=>{
    if(!String(url).includes('elevation-tiles-prod'))return originalFetch(url,options);
    const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),pixels=ctx.createImageData(256,256);
    for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=129;pixels.data[i+1]=44;pixels.data[i+2]=64;pixels.data[i+3]=255}ctx.putImageData(pixels,0,0);
    return new Response(await new Promise(resolve=>c.toBlob(resolve,'image/png')));
   };
   const dem=new TerrainField(43.45,-80.49);await dem.ensure(-500,-500,500,500);
   if(!dem.enabled)throw Error('Terrarium decoding failed');
   window.fetch=originalFetch;
   const datum=dem.datum,range=[dem.heightAt(-500,-500),dem.heightAt(500,500)];
   // Deterministic steep slope exercises actual World receivers and road depth bias.
   const terrain=new TerrainField(43.45,-80.49);
   for(let px=-1;px<=0;px++)for(let pz=-1;pz<=0;pz++){
    const data=new Float32Array(4225);for(let z=0;z<65;z++)for(let x=0;x<65;x++)data[z*65+x]=(pz*2048+z*32)*.12;
    terrain.patches.set(`${px},${pz}`,data);
   }
   const city=proceduralCity('Slope test',43.45,-80.49);city.procedural=false;city.terrain=terrain;city.buildings=[];city.roads=[];city.nodes=[];city.waters=[];city.venues=[];
   const stream=new MapStreamer(city,'unused');stream.addRoad([[-80.49,43.4504],[-80.49,43.4496]],6,true,{});
   city.buildings.push(makeBuilding([[10,5],[17,5],[17,18],[10,18]],10));
   const world=new World(city),scene=new THREE.Scene();scene.background=new THREE.Color(0x080e16);scene.add(world.group,new THREE.HemisphereLight(0xb8d9ee,0x34302b,2));
   const camera=new THREE.PerspectiveCamera(45,4/3,.1,500);camera.position.set(7,6,-11);camera.lookAt(0,0,3);
   const car=buildVehicleMesh(VEHICLES.find(v=>v.kind==='sedan')??VEHICLES[1]);car.position.set(0,1.3,0);scene.add(car);
   const spray=new HoverjuiceSpray();spray.surfaceHeight=(x,z,y)=>world.surfaceHeightAt(x,z,y);scene.add(spray.mesh);
   const pos=new THREE.Vector3();for(let i=0;i<120;i++){const z=(i-119)*.09,y=world.groundHeightAt(0,z,z*.12);pos.set(0,y+1.3,z);spray.emit(car,1/60,pos,0,6,car.userData.halfW,car.userData.halfL,y);spray.update(1/60)}
   const parked={};for(let i=0;i<20;i++){spray.emit(parked,1/60,new THREE.Vector3(3.5,-.48+1.5,-4),0,0,.4,.8,-.28);spray.update(1/60)}
   const renderer=new THREE.WebGLRenderer({antialias:true,stencil:true,preserveDrawingBuffer:true});renderer.setSize(800,600);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;renderer.render(scene,camera);
   renderer.domElement.style.cssText='position:fixed;inset:0;z-index:99999';document.body.append(renderer.domElement);
   return {datum,range,active:spray.activeCount,terrain:world.group.children.filter(o=>o.name==='terrain-elevation').length,calls:renderer.info.render.calls};
  });
  assert.equal(result.datum,300.25);assert.ok(result.active>0);assert.equal(result.terrain,4);assert.deepEqual(errors,[]);
  mkdirSync('.test-artifacts',{recursive:true});await page.screenshot({path:'.test-artifacts/terrain-juice.png'});
  console.log('Terrain and Hoverjuice WebGL:',result);
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
