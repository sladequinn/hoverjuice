'use strict';
module.exports=async function waitForVite(server,url='http://127.0.0.1:47291/',timeoutMs=60000){
 let output='',closed=false,exitCode;
 const collect=d=>{output=(output+d.toString()).slice(-4000)};
 server.stdout?.on('data',collect);
 server.stderr?.on('data',collect);
 server.on('exit',code=>{closed=true;exitCode=code});
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){
  if(closed)throw new Error('Vite exited '+exitCode+'\n'+output);
  try{const response=await fetch(url,{signal:AbortSignal.timeout(1500)});if(response.ok)return}catch{}
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 throw new Error('Vite startup timeout after '+timeoutMs+'ms\n'+output);
};
