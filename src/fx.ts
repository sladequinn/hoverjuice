import * as THREE from 'three'

export function createSky() {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), new THREE.MeshBasicMaterial({ color: 0x18232f, side: THREE.BackSide, fog: false, depthWrite: false })))
  return g
}

export class Rain {
  mesh: THREE.LineSegments
  private pos: Float32Array
  private count = 500
  private span = 90
  private height = 60

  constructor() {
    this.pos = new Float32Array(this.count * 6)
    for (let i = 0; i < this.count; i++) this.reset(i, true)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.mesh = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.16, depthWrite: false }),
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
