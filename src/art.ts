import * as THREE from 'three'
export function surfaceGrain(){
 const size=128,data=new Uint8Array(size*size*4);let seed=8317
 for(let i=0;i<size*size;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=120+(seed>>>25);data.set([v,v,v,255],i*4)}
 const t=new THREE.DataTexture(data,size,size);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t
}
export function radialTexture(){
 const size=64,data=new Uint8Array(size*size*4)
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const r=Math.hypot((x+.5)/size*2-1,(y+.5)/size*2-1);data.set([255,255,255,Math.pow(Math.max(0,1-r),2)*255],(y*size+x)*4)}
 const t=new THREE.DataTexture(data,size,size);t.needsUpdate=true;return t
}
export const grain=surfaceGrain(),softDisc=radialTexture()
