import * as THREE from 'three'
import { ShapeUtils } from 'three'
import { pointInPoly, type CityData, type Pt } from './map'

const TINTS = [0x19ffe6, 0xff2bd6, 0x8a5cff, 0x4d8bff, 0x19ffe6, 0xff2bd6, 0xffb000]
const CELL = 40

function windowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  g.fillStyle = '#0a0b16'
  g.fillRect(0, 0, 512, 512)
  const cols = 16, rows = 16, cw = 512 / cols, rh = 512 / rows
  for (let y = 0; y < rows; y++) {
    const floorLit = Math.random() < 0.8
    for (let x = 0; x < cols; x++) {
      const lit = floorLit && Math.random() < 0.42
      const v = lit ? 150 + Math.random() * 105 : 18 + Math.random() * 16
      g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 20)})`
      g.fillRect(x * cw + 6, y * rh + 8, cw - 12, rh - 13)
    }
    g.fillStyle = 'rgba(255,255,255,0.05)'
    g.fillRect(0, y * rh, 512, 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

export interface Pump {
  node: number
  x: number
  z: number
}

export class World {
  group = new THREE.Group()
  city: CityData
  pumps: Pump[] = []
  private grid = new Map<string, number[]>()
  private ownedGroup = new THREE.Group()
  private pumpRings: THREE.Mesh[] = []
  private time = 0

  constructor(city: CityData) {
    this.city = city
    this.buildGround()
    this.buildBuildings()
    this.buildRoads()
    this.placePumps()
    this.group.add(this.ownedGroup)
    city.buildings.forEach((b, i) => {
      for (let gx = Math.floor(b.minX / CELL); gx <= Math.floor(b.maxX / CELL); gx++)
        for (let gz = Math.floor(b.minZ / CELL); gz <= Math.floor(b.maxZ / CELL); gz++) {
          const k = `${gx},${gz}`
          const list = this.grid.get(k)
          if (list) list.push(i)
          else this.grid.set(k, [i])
        }
    })
  }

  private buildGround() {
    const size = this.city.radius * 6
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ color: 0x05050c }),
    )
    ground.rotation.x = -Math.PI / 2
    this.group.add(ground)
    const grid = new THREE.GridHelper(size, size / 25, 0x2a1450, 0x140b2a)
    grid.position.y = 0.02
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.5
    this.group.add(grid)
  }

  private buildBuildings() {
    const wallPos: number[] = [], wallUv: number[] = [], wallCol: number[] = []
    const roofPos: number[] = [], roofCol: number[] = []
    const edgePos: number[] = [], edgeCol: number[] = []
    const col = new THREE.Color()
    const roofC = new THREE.Color()

    this.city.buildings.forEach((b, bi) => {
      const tint = TINTS[(bi * 2654435761) % TINTS.length >>> 0]
      col.set(tint).multiplyScalar(0.55 + ((bi * 97) % 40) / 100)
      roofC.set(tint).multiplyScalar(0.08)
      const h = b.height
      let d = 0
      const n = b.poly.length
      for (let i = 0; i < n; i++) {
        const [x1, z1] = b.poly[i]
        const [x2, z2] = b.poly[(i + 1) % n]
        const len = Math.hypot(x2 - x1, z2 - z1)
        const u1 = d / 48, u2 = (d + len) / 48, v = h / 48
        d += len
        wallPos.push(x1, 0, z1, x2, 0, z2, x2, h, z2, x1, 0, z1, x2, h, z2, x1, h, z1)
        wallUv.push(u1, 0, u2, 0, u2, v, u1, 0, u2, v, u1, v)
        for (let k = 0; k < 6; k++) wallCol.push(col.r, col.g, col.b)
        edgePos.push(x1, h, z1, x2, h, z2)
        edgeCol.push(col.r * 1.6, col.g * 1.6, col.b * 1.6, col.r * 1.6, col.g * 1.6, col.b * 1.6)
      }
      const contour = b.poly.map(([x, z]) => new THREE.Vector2(x, z))
      if (ShapeUtils.isClockWise(contour)) contour.reverse()
      const tris = ShapeUtils.triangulateShape(contour, [])
      for (const t of tris)
        for (const k of [t[0], t[2], t[1]]) {
          roofPos.push(contour[k].x, h, contour[k].y)
          roofCol.push(roofC.r, roofC.g, roofC.b)
        }
    })

    const wallGeo = new THREE.BufferGeometry()
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3))
    wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2))
    wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wallCol, 3))
    const walls = new THREE.Mesh(
      wallGeo,
      new THREE.MeshBasicMaterial({ map: windowTexture(), vertexColors: true, side: THREE.DoubleSide }),
    )
    this.group.add(walls)

    const roofGeo = new THREE.BufferGeometry()
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3))
    roofGeo.setAttribute('color', new THREE.Float32BufferAttribute(roofCol, 3))
    this.group.add(new THREE.Mesh(roofGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })))

    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))
    edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(edgeCol, 3))
    this.group.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ vertexColors: true })))
  }

  private buildRoads() {
    const pos: number[] = [], line: number[] = [], lineMajor: number[] = []
    for (const road of this.city.roads) {
      const w = road.width / 2
      for (let i = 0; i < road.pts.length - 1; i++) {
        const [x1, z1] = road.pts[i]
        const [x2, z2] = road.pts[i + 1]
        const len = Math.hypot(x2 - x1, z2 - z1) || 1
        const nx = (-(z2 - z1) / len) * w, nz = ((x2 - x1) / len) * w
        pos.push(x1 + nx, 0.05, z1 + nz, x2 + nx, 0.05, z2 + nz, x2 - nx, 0.05, z2 - nz)
        pos.push(x1 + nx, 0.05, z1 + nz, x2 - nx, 0.05, z2 - nz, x1 - nx, 0.05, z1 - nz)
        const target = road.major ? lineMajor : line
        target.push(x1, 0.12, z1, x2, 0.12, z2)
        if (road.major) {
          const e = w * 0.85
          const ex = (nx / w) * e, ez = (nz / w) * e
          line.push(x1 + ex, 0.1, z1 + ez, x2 + ex, 0.1, z2 + ez, x1 - ex, 0.1, z1 - ez, x2 - ex, 0.1, z2 - ez)
        }
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    this.group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0c0f22, side: THREE.DoubleSide })))
    const mk = (arr: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))
    }
    this.group.add(mk(line, 0x19ffe6, 0.55))
    this.group.add(mk(lineMajor, 0xff2bd6, 0.95))
  }

  private placePumps() {
    const main = this.city.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.main)
    if (!main.length) return
    const chosen: number[] = []
    let first = main[0]
    for (const m of main) if (Math.hypot(m.n.x, m.n.z) < Math.hypot(first.n.x, first.n.z)) first = m
    chosen.push(first.i)
    const count = 9
    while (chosen.length < count) {
      let best = -1, bestD = -1
      for (const { n, i } of main) {
        if (Math.hypot(n.x, n.z) > this.city.radius * 0.95) continue
        let d = Infinity
        for (const c of chosen) d = Math.min(d, Math.hypot(n.x - this.city.nodes[c].x, n.z - this.city.nodes[c].z))
        if (d > bestD) { bestD = d; best = i }
      }
      if (best < 0) break
      chosen.push(best)
    }
    const pillarGeo = new THREE.CylinderGeometry(1.2, 1.8, 7, 12)
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0x19ffe6 })
    const ringGeo = new THREE.TorusGeometry(9, 0.35, 8, 48)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x19ffe6, transparent: true, opacity: 0.8 })
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x19ffe6, transparent: true, opacity: 0.12, depthWrite: false })
    for (const i of chosen) {
      const n = this.city.nodes[i]
      this.pumps.push({ node: i, x: n.x, z: n.z })
      const g = new THREE.Group()
      g.position.set(n.x, 0, n.z)
      const pillar = new THREE.Mesh(pillarGeo, pillarMat)
      pillar.position.set(0, 3.5, 0)
      g.add(pillar)
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.5
      g.add(ring)
      this.pumpRings.push(ring)
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 140, 8, 1, true), beamMat)
      beam.position.y = 70
      g.add(beam)
      this.group.add(g)
    }
  }

  setOwned(buildingIdx: number[]) {
    this.ownedGroup.clear()
    const pos: number[] = []
    for (const bi of buildingIdx) {
      const b = this.city.buildings[bi]
      if (!b) continue
      const n = b.poly.length
      for (let i = 0; i < n; i++) {
        const [x1, z1] = b.poly[i], [x2, z2] = b.poly[(i + 1) % n]
        for (const y of [b.height + 0.4, b.height * 0.66, b.height * 0.33]) pos.push(x1, y, z1, x2, y, z2)
        pos.push(x1, 0, z1, x1, b.height + 0.4, z1)
      }
      const crown = new THREE.Mesh(
        new THREE.OctahedronGeometry(4),
        new THREE.MeshBasicMaterial({ color: 0xffc400 }),
      )
      crown.position.set(b.cx, b.height + 10, b.cz)
      crown.userData.spin = true
      this.ownedGroup.add(crown)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    this.ownedGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffc400 })))
  }

  update(dt: number) {
    this.time += dt
    const s = 1 + Math.sin(this.time * 3) * 0.08
    for (const r of this.pumpRings) r.scale.set(s, s, s)
    for (const c of this.ownedGroup.children) if (c.userData.spin) c.rotation.y += dt * 1.5
  }

  /** Returns the building index if (x,z) at altitude y is inside a building. */
  hitBuilding(x: number, z: number, y: number) {
    const list = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
    if (!list) return -1
    for (const i of list) {
      const b = this.city.buildings[i]
      if (y > b.height || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue
      if (pointInPoly(x, z, b.poly as Pt[])) return i
    }
    return -1
  }

  groundHeightAt(x: number, z: number, y: number) {
    const i = this.hitBuilding(x, z, Infinity)
    if (i < 0) return 0
    const h = this.city.buildings[i].height
    return h <= y + 1 ? h : 0
  }

  nearestPump(x: number, z: number) {
    let best: Pump | null = null, bd = Infinity
    for (const p of this.pumps) {
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < bd) { bd = d; best = p }
    }
    return { pump: best, dist: bd }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else if (mat) {
        ;(mat as THREE.MeshBasicMaterial).map?.dispose()
        mat.dispose()
      }
    })
  }
}
