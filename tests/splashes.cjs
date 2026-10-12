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
   const {HoverjuiceSpray}=await import('/src/hoverjuice.ts');
   const {buildVehicleMesh}=await import('/src/vehicle.ts');
   const {VEHICLES}=await import('/src/data.ts');
   const scene=new THREE.Scene();scene.background=new THREE.Color(0x080e16);
   const camera=new THREE.PerspectiveCamera(45,4/3,.1,100);camera.position.set(5,4,-8);camera.lookAt(0,.3,-1);
   const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(800,600);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;
   const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0x12151c,roughness:.8}));floor.rotation.x=-Math.PI/2;scene.add(floor);
   scene.add(new THREE.HemisphereLight(0xb8d9ee,0x34302b,2));
   const car=buildVehicleMesh(VEHICLES.find(v=>v.kind==='sedan')??VEHICLES[1]);car.position.y=1.3;scene.add(car);
   const spray=new HoverjuiceSpray();scene.add(spray.mesh);
   const pos=new THREE.Vector3(0,1.3,0);
   // Freeze a boosted moving trail with the vehicle at its final location.
   for(let i=0;i<180;i++){
    pos.z=(i-179)*.35;
    spray.emit(car,1/60,pos,0,35,car.userData.halfW,car.userData.halfL,0,true);
    spray.update(1/60);
   }
   renderer.render(scene,camera);
   const canvas=renderer.domElement;canvas.style.cssText='position:fixed;inset:0;z-index:99999';document.body.append(canvas);
   const stats={active:spray.activeCount,calls:renderer.info.render.calls};
   scene.remove(spray.mesh);renderer.render(scene,camera);const without=renderer.info.render.calls;
   scene.add(spray.mesh);renderer.render(scene,camera);return {...stats,addedCalls:stats.calls-without};
  });
  assert.ok(result.active>0);assert.equal(result.addedCalls,1);assert.deepEqual(errors,[]);
  mkdirSync('.test-artifacts',{recursive:true});await page.screenshot({path:'.test-artifacts/hoverjuice-spray.png'});
  console.log('Hoverjuice WebGL:',result);
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
