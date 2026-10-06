import * as THREE from 'three'

/** Bounded exponential height fog. Integrate density only through the 0–15m slab. */
export function installHeightFog() {
  THREE.ShaderChunk.fog_pars_vertex += '\nvarying vec3 vFogWorld;\n'
  THREE.ShaderChunk.fog_vertex += '\nvec4 hjFogPosition=vec4(position,1.0);\n#ifdef USE_INSTANCING\nhjFogPosition=instanceMatrix*hjFogPosition;\n#endif\nvFogWorld=(modelMatrix*hjFogPosition).xyz;\n'
  THREE.ShaderChunk.fog_pars_fragment += '\nvarying vec3 vFogWorld;\n'
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
{
  vec3 ray = vFogWorld - cameraPosition;
  float dy = ray.y;
  float lo = 0.0, hi = 1.0;
  if (abs(dy) > 0.0001) {
    float a = (0.0 - cameraPosition.y) / dy;
    float b = (15.0 - cameraPosition.y) / dy;
    lo = max(0.0, min(a,b)); hi = min(1.0, max(a,b));
  } else if (cameraPosition.y < 0.0 || cameraPosition.y > 15.0) { hi = 0.0; }
  float span = max(0.0, hi - lo);
  float h0 = clamp(cameraPosition.y + dy * lo, 0.0, 15.0);
  float h1 = clamp(cameraPosition.y + dy * hi, 0.0, 15.0);
  float density = abs(h1-h0) < 0.001 ? exp(-h0 * 0.2) : (exp(-h0 * 0.2)-exp(-h1 * 0.2)) / ((h1-h0)*0.2);
  float fogFactor = 1.0 - exp(-length(ray) * span * density * 0.025);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(fogFactor,0.0,1.0));
}
#endif`
}
const hashGLSL = `float hjHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float hjNoise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hjHash(i),hjHash(i+vec2(1,0)),f.x),mix(hjHash(i+vec2(0,1)),hjHash(i+vec2(1,1)),f.x),f.y); }`

function worldVarying(shader: {vertexShader: string; fragmentShader: string}) {
  shader.vertexShader = 'varying vec3 vHJWorld; varying vec3 vHJNormal;\n' + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHJWorld=(modelMatrix*vec4(position,1.0)).xyz; vHJNormal=normalize(mat3(modelMatrix)*normal);')
  shader.fragmentShader = 'varying vec3 vHJWorld; varying vec3 vHJNormal;\n' + hashGLSL + '\n' + shader.fragmentShader
}

/** One shared, procedural 3×2 room-cube atlas; no building-specific textures. */
function roomAtlas() {
  const side = 32, w = side*3, h = side*2, data = new Uint8Array(w*h*4)
  for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const face = Math.floor(x/side)+Math.floor(y/side)*3
    const u=x%side,v=y%side
    const trim=u<2||v<2||u>29||v>29
    const furniture=face===4 && u>7&&u<24&&v>16&&v<27
    const tone=trim?45:furniture?65:face===3?95:face===2?190:140
    const o=(y*w+x)*4; data[o]=tone; data[o+1]=tone*0.9; data[o+2]=tone*0.78; data[o+3]=255
  }
  const t = new THREE.DataTexture(data,w,h); t.needsUpdate=true; return t
}
export function facadeMaterial() {
  const atlas=roomAtlas()
  const mat=new THREE.MeshStandardMaterial({color:0x727674,roughness:0.9,metalness:0.08,side:THREE.DoubleSide})
  mat.userData.atlas=atlas
  mat.onBeforeCompile=shader=>{
    worldVarying(shader); shader.uniforms.hjAtlas={value:atlas}
    shader.fragmentShader='uniform sampler2D hjAtlas;\n'+shader.fragmentShader
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
      #include <map_fragment>
      vec3 axis=pow(abs(normalize(vHJNormal)),vec3(8.0)); axis/=max(dot(axis,vec3(1.0)),0.001);
      vec2 gridX=vec2(vHJWorld.z/3.0,vHJWorld.y/3.5), gridZ=vec2(vHJWorld.x/3.0,vHJWorld.y/3.5);
      vec2 grid=mix(gridZ,gridX,axis.x/max(axis.x+axis.z,0.001));
      vec2 cell=fract(grid); float pane=step(0.17,cell.x)*step(cell.x,0.83)*step(0.22,cell.y)*step(cell.y,0.84)*(1.0-axis.y);
      float seed=hjHash(floor(grid)); float lit=step(0.8,seed);
      vec3 view=normalize(vHJWorld-cameraPosition);
      vec3 n=normalize(vHJNormal); vec3 tangent=normalize(cross(vec3(0,1,0),n)+vec3(0.00001,0,0));
      vec3 ray=vec3(dot(view,tangent),view.y,max(0.12,abs(dot(view,n))));
      vec3 room=vec3((cell-0.5)*2.0,0.0);
      // Twelve fixed ray steps through a unit room, no additional geometry.
      for(int i=0;i<12;i++){ vec3 next=room+ray*0.16; if(abs(next.x)>1.0||abs(next.y)>1.0||next.z>1.0) break; room=next; }
      vec2 roomUV=room.xy*0.5+0.5; float face=4.0;
      if(abs(room.x)>0.8){ face=room.x>0.0?1.0:0.0; roomUV=vec2(room.z,room.y*0.5+0.5); }
      if(abs(room.y)>0.8){ face=room.y>0.0?2.0:3.0; roomUV=vec2(room.x*0.5+0.5,room.z); }
      vec2 atlasUV=(clamp(roomUV,0.03,0.97)+vec2(mod(face,3.0),floor(face/3.0)))/vec2(3.0,2.0);
      vec3 interior=texture2D(hjAtlas,atlasUV).rgb;
      vec3 lightColor=mix(vec3(1.0,0.49,0.12),vec3(0.68,0.8,0.77),step(0.93,seed));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.025,0.035,0.045),pane);
    `)
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(0.9,0.1,pane);')
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=pane*lit*interior*lightColor*2.5;')
  }
  mat.customProgramCacheKey=()=> 'hj-facade-v1'
  return mat
}
export function asphaltMaterial() {
  const mat=new THREE.MeshStandardMaterial({color:0x08090c,roughness:0.86,metalness:0.05,side:THREE.DoubleSide})
  mat.onBeforeCompile=shader=>{
    worldVarying(shader)
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nfloat puddle=smoothstep(0.48,0.7,hjNoise(vHJWorld.xz*0.065)); diffuseColor.rgb*=mix(1.0,0.38,puddle);')
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(0.86,0.08,puddle);')
  }
  mat.customProgramCacheKey=()=> 'hj-asphalt-v1'
  return mat
}
