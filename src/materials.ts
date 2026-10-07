import * as THREE from 'three'
import {grain} from './art'

const hashGLSL = `float hjHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float hjNoise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hjHash(i),hjHash(i+vec2(1,0)),f.x),mix(hjHash(i+vec2(0,1)),hjHash(i+vec2(1,1)),f.x),f.y); }`

function worldVarying(shader: {vertexShader: string; fragmentShader: string}) {
  shader.vertexShader = 'varying vec3 vHJWorld; varying vec3 vHJNormal;\n' + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHJWorld=(modelMatrix*vec4(position,1.0)).xyz; vHJNormal=normalize(mat3(modelMatrix)*normal);')
  shader.fragmentShader = 'varying vec3 vHJWorld; varying vec3 vHJNormal;\n' + hashGLSL + '\n' + shader.fragmentShader
}

/** Flat window bands: no room atlas, raymarching or per-building textures. */
export function facadeMaterial(style=0) {
  const mat = new THREE.MeshStandardMaterial({color:0xb0b5b8,vertexColors:true,roughness:0.9,metalness:0.02,side:THREE.DoubleSide})
  mat.onBeforeCompile = shader => {
    worldVarying(shader)
    shader.uniforms.hjGrain={value:grain};shader.fragmentShader='uniform sampler2D hjGrain;\n'+shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
      #include <map_fragment>
      vec2 wall=vec2(abs(vHJNormal.x)>0.5?vHJWorld.z:vHJWorld.x,vHJWorld.y);
      vec2 grid=wall/vec2(${style?5.4:3.0},${style?4.1:3.5});
      float grit=texture2D(hjGrain,wall*0.18).r;
      float seam=1.0-smoothstep(0.015,0.045,abs(fract(wall.y/3.5)-0.5));
      diffuseColor.rgb*=mix(0.65,1.22,grit)*(1.0-seam*0.18)*mix(0.48,1.0,smoothstep(0.0,5.0,vHJWorld.y));
      vec2 cell=fract(grid), aa=max(fwidth(grid),vec2(0.001));
      vec2 paneEdge=smoothstep(vec2(0.18,0.24),vec2(0.18,0.24)+aa,cell)*(1.0-smoothstep(vec2(0.8,0.82)-aa,vec2(0.8,0.82),cell));
      float pane=paneEdge.x*paneEdge.y*step(4.3,vHJWorld.y);
      float seed=hjHash(floor(grid));
      float lit=step(0.88,seed);
      vec3 lightColor=mix(vec3(1.0,0.58,0.24),vec3(0.63,0.77,0.82),step(0.97,seed));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.022,0.035,0.046),pane);
      float shop=step(0.18,fract(wall.x/12.0))*step(fract(wall.x/12.0),0.85)*step(0.25,wall.y)*step(wall.y,3.35);
      float rib=smoothstep(0.35,0.65,fract(wall.y*6.0));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.065,0.078,0.085)*(0.75+rib*0.25),shop);
    `)
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=pane*lit*lightColor*0.65;')
  }
  mat.customProgramCacheKey=()=> 'hj-facade-art-v5-'+style
  return mat
}
export function asphaltMaterial(color = 0x08090c) {
  const mat=new THREE.MeshStandardMaterial({color,roughness:0.86,metalness:0.05,side:THREE.DoubleSide})
  mat.onBeforeCompile=shader=>{
    worldVarying(shader)
    shader.uniforms.hjGrain={value:grain};shader.fragmentShader='uniform sampler2D hjGrain;\n'+shader.fragmentShader
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nfloat puddle=smoothstep(0.48,0.7,hjNoise(vHJWorld.xz*0.065)); diffuseColor.rgb*=mix(1.0,0.58,puddle)*(0.7+texture2D(hjGrain,vHJWorld.xz*0.45).r*0.7);')
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(0.86,0.08,puddle);')
  }
  mat.customProgramCacheKey=()=> 'hj-asphalt-art-v2'
  return mat
}
