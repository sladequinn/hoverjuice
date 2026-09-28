import * as THREE from 'three'
import { ShapeUtils } from 'three'
import { pointInPoly, type CityData, type Pt } from './map'

const TINTS = [0xff2e88, 0x00f0ff, 0x9d4dff, 0xff2e88, 0x00f0ff, 0xff6a1a, 0xc13cff, 0xffd400]
const SIGN_WORDS = ['CYAN-ADE', 'HJ-77', 'HOVERGHINI', 'NEONIC', 'RAMEN 24H', 'KIROSHI', 'MOTEL', 'SYNTH BAR', 'OKABE', 'NO SLEEP', 'DATA DEN', 'VIDEO', 'MIDNIGHT', 'REPULS']
const SIGN_COLORS = ['#ff2e88', '#00f0ff', '#ffd400', '#b04dff', '#ff6a1a', '#39ff6a']
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

function bandTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  g.fillStyle = '#07050f'
  g.fillRect(0, 0, 512, 512)
  const rows = 16, rh = 512 / rows
  for (let y = 0; y < rows; y++) {
    const on = Math.random() < 0.75
    const v = on ? 170 + Math.random() * 85 : 30
    g.fillStyle = `rgb(${v},${v},${v})`
    g.fillRect(0, y * rh + rh * 0.62, 512, rh * 0.16)
    if (on && Math.random() < 0.5) {
      g.fillStyle = 'rgba(255,255,255,0.18)'
      g.fillRect(0, y * rh + rh * 0.2, 512, rh * 0.36)
    }
  }
  for (let x = 0; x < 512; x += 128) {
    g.fillStyle = 'rgba(255,255,255,0.25)'
    g.fillRect(x, 0, 3, 512)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function groundTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#0d0718' : '#120a22'
      g.fillRect(x * 32, y * 32, 32, 32)
    }
  g.strokeStyle = 'rgba(255,46,136,0.25)'
  g.lineWidth = 2
  g.strokeRect(1, 1, 254, 254)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function signTexture(word: string, color: string) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 160
  const g = c.getContext('2d')!
  g.fillStyle = '#05020a'
  g.fillRect(0, 0, 512, 160)
  g.strokeStyle = color
  g.lineWidth = 8
  g.shadowColor = color
  g.shadowBlur = 18
  g.strokeRect(10, 10, 492, 140)
  g.font = 'italic 900 82px Orbitron, Impact, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  let size = 82
  while (g.measureText(word).width > 450 && size > 30) {
    size -= 4
    g.font = `italic 900 ${size}px Orbitron, Impact, sans-serif`
  }
  g.fillStyle = '#ffffff'
  g.shadowBlur = 24
  g.fillText(word, 256, 84)
  g.fillStyle = color
  g.globalAlpha = 0.55
  g.fillText(word, 256, 84)
  const t = new THREE.CanvasTexture(c)
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
  private signMats: THREE.MeshBasicMaterial[] = []

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
    const tex = groundTexture()
    tex.repeat.set(size / 40, size / 40)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex }))
    ground.rotation.x = -Math.PI / 2
    this.group.add(ground)
  }

  private buildBuildings() {
    const buckets = [0, 1].map(() => ({ pos: [] as number[], uv: [] as number[], col: [] as number[] }))
    const roofPos: number[] = [], roofCol: number[] = []
    const edgePos: number[] = [], edgeCol: number[] = []
    const col = new THREE.Color()
    const roofC = new THREE.Color()

    this.city.buildings.forEach((b, bi) => {
      const tint = TINTS[(bi * 7 + (bi >> 2)) % TINTS.length]
      col.set(tint).multiplyScalar(0.6 + ((bi * 97) % 40) / 100)
      roofC.set(tint).multiplyScalar(0.1)
      const bk = buckets[bi % 3 === 0 ? 1 : 0]
      const tall = b.height > 45
      const h = b.height
      let d = 0
      const n = b.poly.length
      for (let i = 0; i < n; i++) {
        const [x1, z1] = b.poly[i]
        const [x2, z2] = b.poly[(i + 1) % n]
        const len = Math.hypot(x2 - x1, z2 - z1)
        const u1 = d / 48, u2 = (d + len) / 48, v = h / 48
        d += len
        bk.pos.push(x1, 0, z1, x2, 0, z2, x2, h, z2, x1, 0, z1, x2, h, z2, x1, h, z1)
        bk.uv.push(u1, 0, u2, 0, u2, v, u1, 0, u2, v, u1, v)
        for (let k = 0; k < 6; k++) bk.col.push(col.r, col.g, col.b)
        const e = 1.7
        edgePos.push(x1, h, z1, x2, h, z2)
        edgeCol.push(col.r * e, col.g * e, col.b * e, col.r * e, col.g * e, col.b * e)
        if (tall && len > 6) {
          edgePos.push(x1, 0, z1, x1, h, z1)
          edgeCol.push(col.r * 0.4, col.g * 0.4, col.b * 0.4, col.r * e, col.g * e, col.b * e)
        }
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

    const textures = [windowTexture(), bandTexture()]
    buckets.forEach((bk, i) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3))
      this.group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: textures[i], vertexColors: true, side: THREE.DoubleSide })))
    })
    this.buildSigns()

    const roofGeo = new THREE.BufferGeometry()
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3))
    roofGeo.setAttribute('color', new THREE.Float32BufferAttribute(roofCol, 3))
    this.group.add(new THREE.Mesh(roofGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })))

    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))
    edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(edgeCol, 3))
    this.group.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ vertexColors: true })))
  }

  private buildSigns() {
    const textures = SIGN_WORDS.map((w, i) => signTexture(w, SIGN_COLORS[i % SIGN_COLORS.length]))
    const materials = textures.map((map) => new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, transparent: true }))
    const cands = this.city.buildings
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.height > 22 && b.area > 200)
      .sort((p, q) => ((p.i * 7919) % 101) - ((q.i * 7919) % 101))
      .slice(0, 70)
    for (const { b, i } of cands) {
      let best = 0, bestLen = 0
      for (let k = 0; k < b.poly.length; k++) {
        const [x1, z1] = b.poly[k], [x2, z2] = b.poly[(k + 1) % b.poly.length]
        const l = Math.hypot(x2 - x1, z2 - z1)
        if (l > bestLen) { bestLen = l; best = k }
      }
      if (bestLen < 8) continue
      const [x1, z1] = b.poly[best], [x2, z2] = b.poly[(best + 1) % b.poly.length]
      let nx = -(z2 - z1) / bestLen, nz = (x2 - x1) / bestLen
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2
      if (pointInPoly(mx + nx * 0.5, mz + nz * 0.5, b.poly)) { nx = -nx; nz = -nz }
      const w = Math.min(bestLen * 0.8, 26)
      const h = w * 0.3125
      const y = Math.min(b.height - h * 0.6 - 1, b.height * (0.55 + ((i * 13) % 30) / 100))
      if (y < h) continue
      const m = materials[(i * 31) % materials.length]
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m)
      sign.position.set(mx + nx * 0.6, y, mz + nz * 0.6)
      sign.rotation.y = Math.atan2(nx, nz)
      this.group.add(sign)
    }
    this.signMats = materials
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
    this.group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x07040e, side: THREE.DoubleSide })))
    const mk = (arr: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))
    }
    this.group.add(mk(line, 0x00f0ff, 0.6))
    this.group.add(mk(lineMajor, 0xff2e88, 1))
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
      const m = this.city.nodes[n.adj[0] ?? i]
      const len = Math.hypot(m.x - n.x, m.z - n.z) || 1
      const pillar = new THREE.Mesh(pillarGeo, pillarMat)
      pillar.position.set(((m.z - n.z) / len) * 10, 3.5, (-(m.x - n.x) / len) * 10)
      g.add(pillar)
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.5
      g.add(ring)
      this.pumpRings.push(ring)
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 140, 8, 1, true), beamMat)
      beam.position.set(pillar.position.x, 70, pillar.position.z)
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
    this.signMats.forEach((m, i) => {
      const flick = i % 4 === 0 && Math.sin(this.time * (7 + i) + i * 3) > 0.93
      m.opacity = flick ? 0.25 : 1
    })
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
