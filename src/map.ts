import { LANDMARK_NAMES } from './data'

export type Pt = [number, number]

export interface Building {
  poly: Pt[]
  height: number
  name?: string
  area: number
  cx: number
  cz: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface RoadNode {
  x: number
  z: number
  adj: number[]
  main: boolean
}

export interface Road {
  pts: Pt[]
  width: number
  major: boolean
}

export interface Landmark {
  id: string
  name: string
  building: number
  price: number
  income: number
}

export interface CityData {
  key: string
  name: string
  lat: number
  lon: number
  radius: number
  buildings: Building[]
  roads: Road[]
  nodes: RoadNode[]
  landmarks: Landmark[]
  procedural: boolean
}

const RADIUS = 750
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

const ROAD_WIDTH: Record<string, number> = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 9,
  unclassified: 7,
  residential: 7,
  living_street: 6,
  pedestrian: 6,
}

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

function polyArea(poly: Pt[]) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]
    const [x2, z2] = poly[(i + 1) % poly.length]
    a += x1 * z2 - x2 * z1
  }
  return a / 2
}

function makeBuilding(poly: Pt[], height: number, name?: string): Building | null {
  if (poly.length < 3) return null
  const area = Math.abs(polyArea(poly))
  if (area < 12) return null
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, cx = 0, cz = 0
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
    cx += x; cz += z
  }
  return { poly, height, name, area, cx: cx / poly.length, cz: cz / poly.length, minX, maxX, minZ, maxZ }
}

function pickLandmarks(key: string, buildings: Building[]): Landmark[] {
  const score = (b: Building) => b.height * Math.sqrt(b.area)
  const idx = buildings.map((_, i) => i).filter((i) => buildings[i].area > 150)
  const named = idx.filter((i) => buildings[i].name).sort((a, b) => score(buildings[b]) - score(buildings[a]))
  const chosen = named.slice(0, 10)
  if (chosen.length < 10) {
    const rest = idx.filter((i) => !chosen.includes(i)).sort((a, b) => score(buildings[b]) - score(buildings[a]))
    for (const i of rest) {
      if (chosen.length >= 10) break
      const b = buildings[i]
      if (chosen.some((c) => Math.hypot(buildings[c].cx - b.cx, buildings[c].cz - b.cz) < 120)) continue
      chosen.push(i)
    }
  }
  let generic = 0
  const raw = chosen.map((i) => {
    const b = buildings[i]
    const name = b.name ?? LANDMARK_NAMES[generic++ % LANDMARK_NAMES.length]
    return { i, name, s: score(b) }
  })
  const maxS = Math.max(...raw.map((r) => r.s), 1)
  return raw
    .map(({ i, name, s }) => {
      const t = Math.sqrt(s / maxS)
      const price = Math.round((3000 + t * t * 600000) / 100) * 100
      return { id: `${key}:${i}`, name, building: i, price, income: Math.round(price * 0.012) }
    })
    .sort((a, b) => a.price - b.price)
}

function finalizeGraph(nodes: RoadNode[]) {
  const comp = new Int32Array(nodes.length).fill(-1)
  let best = -1, bestSize = 0, c = 0
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] >= 0 || nodes[i].adj.length === 0) continue
    const stack = [i]
    comp[i] = c
    let size = 0
    while (stack.length) {
      const n = stack.pop()!
      size++
      for (const m of nodes[n].adj) if (comp[m] < 0) { comp[m] = c; stack.push(m) }
    }
    if (size > bestSize) { bestSize = size; best = c }
    c++
  }
  nodes.forEach((n, i) => (n.main = comp[i] === best))
}

export function cityKey(lat: number, lon: number) {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

interface OsmGeom { lat: number; lon: number }
interface OsmElement {
  type: string
  id: number
  tags?: Record<string, string>
  nodes?: number[]
  geometry?: OsmGeom[]
  members?: { role: string; geometry?: OsmGeom[] }[]
}

export async function fetchCity(name: string, lat: number, lon: number, onStatus: (s: string) => void): Promise<CityData> {
  const dLat = RADIUS / 110540
  const dLon = RADIUS / (111320 * Math.cos((lat * Math.PI) / 180))
  const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`
  const hw = Object.keys(ROAD_WIDTH).concat(['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']).join('|')
  const query = `[out:json][timeout:90];(way["building"](${bbox});relation["building"](${bbox});way["highway"~"^(${hw})$"](${bbox}););out geom;`

  let json: { elements: OsmElement[] } | null = null
  let lastErr: unknown
  for (const url of ENDPOINTS) {
    try {
      onStatus(`Uplinking to ${new URL(url).host}…`)
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onStatus('Decoding city grid…')
      json = await res.json()
      break
    } catch (e) {
      lastErr = e
    }
  }
  if (!json) throw lastErr ?? new Error('No map data')

  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const proj = (g: OsmGeom): Pt => [(g.lon - lon) * kx, -(g.lat - lat) * 110540]
  const r = rng(Math.floor(Math.abs(lat * 1000 + lon * 7000)))

  const buildings: Building[] = []
  const roads: Road[] = []
  const nodes: RoadNode[] = []
  const nodeIndex = new Map<number, number>()

  const heightOf = (tags: Record<string, string>) => {
    const h = parseFloat(tags.height ?? '')
    if (h > 0) return h
    const lv = parseFloat(tags['building:levels'] ?? '')
    if (lv > 0) return lv * 3.4 + 2
    return 8 + r() * r() * 34
  }

  for (const el of json.elements) {
    const tags = el.tags ?? {}
    if (tags.building) {
      const rings: OsmGeom[][] = []
      if (el.type === 'way' && el.geometry) rings.push(el.geometry)
      if (el.type === 'relation' && el.members) {
        for (const m of el.members) if (m.role === 'outer' && m.geometry) rings.push(m.geometry)
      }
      for (const ring of rings) {
        const pts = ring.map(proj)
        if (pts.length > 1) {
          const [a, b] = [pts[0], pts[pts.length - 1]]
          if (a[0] === b[0] && a[1] === b[1]) pts.pop()
        }
        const bld = makeBuilding(pts, Math.min(Math.max(heightOf(tags), 4), 700), tags.name)
        if (bld) buildings.push(bld)
      }
    } else if (tags.highway && el.geometry && el.nodes) {
      const base = tags.highway.replace('_link', '')
      const width = ROAD_WIDTH[base] ?? 7
      const pts = el.geometry.map(proj)
      roads.push({ pts, width, major: width >= 10 })
      let prev = -1
      el.nodes.forEach((osmId, i) => {
        let idx = nodeIndex.get(osmId)
        if (idx === undefined) {
          idx = nodes.length
          nodes.push({ x: pts[i][0], z: pts[i][1], adj: [], main: false })
          nodeIndex.set(osmId, idx)
        }
        if (prev >= 0 && prev !== idx) {
          if (!nodes[prev].adj.includes(idx)) nodes[prev].adj.push(idx)
          if (!nodes[idx].adj.includes(prev)) nodes[idx].adj.push(prev)
        }
        prev = idx
      })
    }
  }

  if (buildings.length < 20 || nodes.length < 20) throw new Error('Not enough map data here')
  finalizeGraph(nodes)
  const key = cityKey(lat, lon)
  return { key, name, lat, lon, radius: RADIUS, buildings, roads, nodes, landmarks: pickLandmarks(key, buildings), procedural: false }
}

/** Offline fallback: a synthetic neon grid city. */
export function proceduralCity(name: string, lat: number, lon: number): CityData {
  const r = rng(Math.floor(Math.abs(lat * 1000 + lon * 7000)) + 17)
  const step = 110
  const n = Math.floor((RADIUS * 2) / step)
  const off = -RADIUS
  const nodes: RoadNode[] = []
  const roads: Road[] = []
  const id = (i: number, j: number) => i * (n + 1) + j
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) nodes.push({ x: off + i * step, z: off + j * step, adj: [], main: true })
  const link = (a: number, b: number, major: boolean) => {
    nodes[a].adj.push(b)
    nodes[b].adj.push(a)
    roads.push({ pts: [[nodes[a].x, nodes[a].z], [nodes[b].x, nodes[b].z]], width: major ? 12 : 8, major })
  }
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      if (i < n) link(id(i, j), id(i + 1, j), j % 4 === 0)
      if (j < n) link(id(i, j), id(i, j + 1), i % 4 === 0)
    }
  const buildings: Building[] = []
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x0 = off + i * step + 12, z0 = off + j * step + 12, size = step - 24
      const dist = Math.hypot(x0, z0) / RADIUS
      const split = r() < 0.5 ? 1 : 2
      const cell = size / split
      for (let a = 0; a < split; a++)
        for (let b = 0; b < split; b++) {
          const pad = 3 + r() * 6
          const x = x0 + a * cell + pad, z = z0 + b * cell + pad, w = cell - pad * 2, d = cell - pad * 2
          const h = 10 + r() * r() * (220 * (1 - dist) + 30)
          const bld = makeBuilding([[x, z], [x + w, z], [x + w, z + d], [x, z + d]], h)
          if (bld) buildings.push(bld)
        }
    }
  finalizeGraph(nodes)
  const key = cityKey(lat, lon) + ':sim'
  return { key, name, lat, lon, radius: RADIUS, buildings, roads, nodes, landmarks: pickLandmarks(key, buildings), procedural: true }
}

export interface GeoResult { name: string; area: string; lat: number; lon: number }

export async function geocode(q: string): Promise<GeoResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data: { display_name: string; lat: string; lon: string; name?: string }[] = await res.json()
  return data.map((d) => {
    const parts = d.display_name.split(',').map((s) => s.trim())
    return { name: d.name || parts[0], area: parts.slice(1, 3).join(', '), lat: parseFloat(d.lat), lon: parseFloat(d.lon) }
  })
}

export function pointInPoly(x: number, z: number, poly: Pt[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
