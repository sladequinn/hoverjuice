import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

/** VHS / Hotline Miami finish: chromatic fringe, scanlines, grain, magenta grade, vignette. */
export function createRetroPass() {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uAberration: { value: 0.0018 },
      uScan: { value: 0.07 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform vec2 uRes;
      uniform float uAberration;
      uniform float uScan;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 c = vUv - 0.5;
        float d = dot(c, c);
        vec2 off = c * uAberration * (1.0 + d * 6.0);
        float wob = sin(vUv.y * 180.0 + uTime * 3.0) * 0.0004;
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + off + vec2(wob, 0.0)).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off - vec2(wob, 0.0)).b;
        col = mix(col, col * vec3(1.08, 0.9, 1.12), 0.55);
        col += vec3(0.035, 0.0, 0.06) * (1.0 - col);
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(luma), col, 1.18);
        float scan = sin(vUv.y * uRes.y * 1.5708) * 0.5 + 0.5;
        col *= 1.0 - uScan * scan;
        col += (hash(vUv * uRes + uTime) - 0.5) * 0.045;
        col *= 1.0 - d * 1.15;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  return pass
}

export function createSky() {
  const g = new THREE.Group()
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 horizon = vec3(1.0, 0.18, 0.52);
          vec3 mid = vec3(0.36, 0.06, 0.46);
          vec3 top = vec3(0.03, 0.01, 0.09);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
          col = mix(col, top, smoothstep(0.15, 0.6, h));
          col = mix(vec3(0.16, 0.02, 0.2), col, smoothstep(-0.2, 0.0, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  )
  sky.renderOrder = -2
  g.add(sky)

  const c = document.createElement('canvas')
  c.width = c.height = 512
  const x = c.getContext('2d')!
  const grad = x.createLinearGradient(0, 0, 0, 512)
  grad.addColorStop(0, '#ffe45c')
  grad.addColorStop(0.5, '#ff6a3d')
  grad.addColorStop(1, '#ff1f8e')
  x.fillStyle = grad
  x.beginPath()
  x.arc(256, 256, 250, 0, Math.PI * 2)
  x.fill()
  x.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 9; i++) {
    const y = 300 + i * 24
    x.fillRect(0, y, 512, 4 + i * 1.6)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sun = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }),
  )
  sun.position.set(0, 180, 2600)
  sun.rotation.y = Math.PI
  sun.renderOrder = -1
  g.add(sun)
  return g
}

export class Rain {
  mesh: THREE.LineSegments
  private pos: Float32Array
  private count = 1400
  private span = 90
  private height = 60

  constructor() {
    this.pos = new Float32Array(this.count * 6)
    for (let i = 0; i < this.count; i++) this.reset(i, true)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.mesh = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.35, depthWrite: false }),
    )
    this.mesh.frustumCulled = false
  }

  private reset(i: number, anyHeight: boolean) {
    const x = (Math.random() - 0.5) * this.span * 2
    const z = (Math.random() - 0.5) * this.span * 2
    const y = anyHeight ? Math.random() * this.height : this.height
    const p = this.pos
    p.set([x, y, z, x + 0.12, y + 1.4, z + 0.05], i * 6)
  }

  update(dt: number, center: THREE.Vector3) {
    this.mesh.position.set(center.x, Math.max(0, center.y - 20), center.z)
    const p = this.pos
    const fall = 48 * dt
    for (let i = 0; i < this.count; i++) {
      const o = i * 6
      p[o + 1] -= fall
      p[o + 4] -= fall
      if (p[o + 1] < 0) this.reset(i, false)
    }
    this.mesh.geometry.attributes.position.needsUpdate = true
  }
}
