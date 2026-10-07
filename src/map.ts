import { buildingId, criminalEligible, protectedVenue, syndicate, type Tags, type Gang } from './filter'
import { LANDMARK_NAMES } from './data'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'

export type Pt = [number, number]

export interface Building {
  id?: string
  tile?: string
  tags?: Tags
  eligible?: boolean
  gang?: Gang
  clipped?: boolean
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
  y?: number
  tunnel?: boolean
  width?: number
  x: number
  z: number
  adj: number[]
  main: boolean
}

export interface Road {
  requestedWidth?: number
  sidewalkWidth?: number
  heights?: number[]
  bridge?: boolean
  tunnel?: boolean
  name?: string
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

export interface Venue { x: number; z: number; tags: Tags; name: string }
export interface Zone { poly: Pt[]; tags: Tags; gang: Gang }
export interface Water { poly: Pt[]; holes: Pt[][] }
export interface CityData {
  venues: Venue[]
  zones: Zone[]
  waters: Water[]
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

const bldId = (b: Building) => b.id!
const RADIUS = 750
// OpenFreeMap's planet archive currently tops out at z14; requesting z15 returns valid but empty tiles.
const TILE_ZOOM = 14
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'

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

export function makeBuilding(poly: Pt[], height: number, name?: string): Building | null {
  if (poly.length < 3) return null
  const area = Math.abs(polyArea(poly))
  if (area < 12) return null
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, cx = 0, cz = 0
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
    cx += x; cz += z
  }
  let signed=0,weightedX=0,weightedZ=0
  for(let i=0;i<poly.length;i++){const [x,z]=poly[i],[a,b]=poly[(i+1)%poly.length];const cross=x*b-a*z;signed+=cross;weightedX+=(x+a)*cross;weightedZ+=(z+b)*cross}
  return {poly,height,name,area,cx:Math.abs(signed)>0.001?weightedX/(3*signed):cx/poly.length,cz:Math.abs(signed)>0.001?weightedZ/(3*signed):cz/poly.length,minX,maxX,minZ,maxZ}
}

function pickLandmarks(_key: string, buildings: Building[]): Landmark[] {
  const score = (b: Building) => b.height * Math.sqrt(b.area)
  const idx = buildings.map((_, i) => i).filter((i) => buildings[i].area > 150 && buildings[i].eligible)
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
      return { id: bldId(buildings[i]), name, building: i, price, income: Math.round(price * 0.012) }
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

const DB_NAME = 'hoverghini-cache'
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('osm')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function cacheGet(key: string): Promise<unknown> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const req = db.transaction('osm').objectStore('osm').get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(undefined)
    })
  } catch {
    return undefined
  }
}
async function cachePut(key: string, value: unknown) {
  try {
    const db = await openDb()
    db.transaction('osm', 'readwrite').objectStore('osm').put(value, key)
  } catch {
    /* private browsing or quota: caching is optional */
  }
}

export interface MapDelta {
  buildingsFrom: number
  roadsFrom: number
  tiles: number
}

type LngLat = [number, number]
type GeoGeometry =
  | { type: 'Point'; coordinates: LngLat }
  | { type: 'Polygon'; coordinates: LngLat[][] }
  | { type: 'MultiPolygon'; coordinates: LngLat[][][] }
  | { type: 'LineString'; coordinates: LngLat[] }
  | { type: 'MultiLineString'; coordinates: LngLat[][] }

const ROAD_CLASS: Record<string, { width: number; major: boolean }> = {
  motorway: { width: 8, major: true },
  trunk: { width: 7, major: true },
  primary: { width: 6.5, major: true },
  secondary: { width: 6, major: true },
  tertiary: { width: 5.5, major: false },
  minor: { width: 5, major: false },
  service: { width: 3.5, major: false },
  track: { width: 3, major: false },
}

export function tileFor(lat: number, lon: number, z: number) {
  const n = 2 ** z
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
  }
}

export function worldToLatLon(city: CityData, x: number, z: number) {
  const kx = 111320 * Math.cos((city.lat * Math.PI) / 180)
  return { lat: city.lat - z / 110540, lon: city.lon + x / kx }
}

async function fetchWithTimeout(url: string, signal: AbortSignal | undefined, timeout = 12000) {
  const ctrl = new AbortController()
  const stop = () => ctrl.abort()
  signal?.addEventListener('abort', stop)
  const timer = setTimeout(stop, timeout)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`)
    return res
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
  }
}

async function tileTemplate(signal: AbortSignal) {
  const cached = localStorage.getItem('hoverghini.tile-template')
  try {
    const json = await (await fetchWithTimeout(TILEJSON_URL, signal, 8000)).json() as { tiles?: string[] }
    const template = json.tiles?.[0]
    if (!template) throw new Error('Tile catalog has no tile URL')
    localStorage.setItem('hoverghini.tile-template', template)
    return template
  } catch (e) {
    if (signal.aborted || !cached) throw e
    return cached
  }
}

async function downloadTile(url: string, signal?: AbortSignal) {
  const key = `mvt:${url}`
  const hit = await cacheGet(key)
  if (hit instanceof ArrayBuffer) return new Uint8Array(hit)
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await (await fetchWithTimeout(url, signal, 14000 + attempt * 5000)).arrayBuffer()
      void cachePut(key, data)
      return new Uint8Array(data)
    } catch (e) {
      last = e
      if (signal?.aborted) throw e
    }
  }
  throw last
}

/**
 * Incrementally turns OpenFreeMap's OpenStreetMap vector tiles into game geometry.
 * Node and segment keys are global, so roads connect cleanly across tile seams.
 */
export class MapStreamer {
  private city: CityData
  private template: string
  private loaded = new Set<string>()
  private pending = new Map<string, Promise<Uint8Array>>()
  private nodeIndex = new Map<string, number>()
  private roadSegments = new Set<string>()
  private busy = false

  constructor(city: CityData, template: string) {
    this.city = city
    this.template = template
  }

  private project([lon, lat]: LngLat): Pt {
    const kx = 111320 * Math.cos((this.city.lat * Math.PI) / 180)
    return [(lon - this.city.lon) * kx, -(lat - this.city.lat) * 110540]
  }

  private node(pt: Pt, y = 0, tunnel = false, width = 5) {
    const key = `${Math.round(pt[0] * 4)},${Math.round(pt[1] * 4)},${Math.round(y * 10)}`
    let i = this.nodeIndex.get(key)
    if (i === undefined) {
      i = this.city.nodes.length
      this.city.nodes.push({ x: pt[0], z: pt[1], y, tunnel, width, adj: [], main: true })
      this.nodeIndex.set(key, i)
    }
    return i
  }

  private addRoad(line: LngLat[], width: number, major: boolean, tags: Tags) {
    let pts = line.map((p) => this.project(p))
    if (tags.brunnel || tags.bridge === 'yes' || tags.tunnel === 'yes') {
      const dense: Pt[] = [pts[0]]
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        const steps = Math.max(6, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10))
        for (let j = 1; j <= steps; j++) dense.push([a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps])
      }
      pts = dense
    }
    if (pts.length < 2) return
    const kept: Pt[] = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const a = kept[kept.length - 1], b = pts[i]
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.3) kept.push(b)
    }
    if (kept.length < 2) return
    const bridge = tags.bridge === 'yes' || tags.brunnel === 'bridge'
    const tunnel = tags.tunnel === 'yes' || tags.brunnel === 'tunnel'
    const deck = bridge ? Math.max(1, Number(tags.layer) || 1) * 5 : tunnel ? -4 : 0
    const heights = kept.map((_, i) => {
      const t = Math.min(1, i / 3, (kept.length - 1 - i) / 3)
      return deck * t * t * (3 - 2 * t)
    })
    this.city.roads.push({ pts: kept, heights, width, major, bridge, tunnel, name: String(tags.name || '') })
    let prev = this.node(kept[0], heights[0], tunnel, width)
    for (let i = 1; i < kept.length; i++) {
      const next = this.node(kept[i], heights[i], tunnel, width)
      const edge = prev < next ? `${prev}:${next}` : `${next}:${prev}`
      if (!this.roadSegments.has(edge)) {
        this.roadSegments.add(edge)
        this.city.nodes[prev].adj.push(next)
        this.city.nodes[next].adj.push(prev)
      }
      prev = next
    }
  }

  private async parse(data: Uint8Array, x: number, y: number) {
    const tile = new VectorTile(new PbfReader(data))
    const sourceTile = `${TILE_ZOOM}_${x}_${y}`
    for (const layerName of ['poi', 'landuse', 'water']) {
      const layer = tile.layers[layerName]
      if (!layer) continue
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i), tags = { ...f.properties } as Tags
        const geo = f.toGeoJSON(x, y, TILE_ZOOM).geometry as GeoGeometry
        if (layerName === 'poi' && geo.type === 'Point') {
          const [vx, vz] = this.project(geo.coordinates)
          // OpenMapTiles encodes amenities in class/subclass, not necessarily amenity.
          tags.amenity ||= tags.subclass || tags.class || ''
          this.city.venues.push({ x: vx, z: vz, tags, name: String(tags.name || tags.brand || tags.amenity || '') })
        }
        const polygons = geo.type === 'Polygon' ? [geo.coordinates] : geo.type === 'MultiPolygon' ? geo.coordinates : []
        for (const rings of polygons) {
          const poly = rings[0].slice(0, -1).map(p => this.project(p))
          if (layerName === 'water') this.city.waters.push({ poly, holes: rings.slice(1).map(r => r.slice(0, -1).map(p => this.project(p))) })
          else { tags.landuse ||= tags.class || ''; this.city.zones.push({ poly, tags, gang: syndicate(tags) }) }
        }
      }
    }
    // Index POIs once per tile, instead of testing every city POI against every building.
    const venueCells = new Map<string, typeof this.city.venues>()
    for (const venue of this.city.venues) {
      const key = `${Math.floor(venue.x/128)},${Math.floor(venue.z/128)}`
      const list = venueCells.get(key) ?? []; list.push(venue); venueCells.set(key,list)
    }
    const zones = this.city.zones.map(zone => {
      let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity
      for(const [px,pz] of zone.poly){minX=Math.min(minX,px);maxX=Math.max(maxX,px);minZ=Math.min(minZ,pz);maxZ=Math.max(maxZ,pz)}
      return {zone,minX,maxX,minZ,maxZ}
    })
    const bLayer = tile.layers.building
    if (bLayer) for (let i = 0; i < bLayer.length; i++) {
      if(i && i%128===0) await new Promise<void>(resolve=>setTimeout(resolve,0))
      const f = bLayer.feature(i)
      const geo = f.toGeoJSON(x, y, TILE_ZOOM).geometry as GeoGeometry
      const props = f.properties as Record<string, string | number | boolean>
      const polygons = geo.type === 'Polygon' ? [geo.coordinates] : geo.type === 'MultiPolygon' ? geo.coordinates : []
      let h = Number(props.render_height) || Number(props.height) || Number(props['building:levels']) * 3.4
      if (!h) {
        const seed = Number(f.id ?? i) + x * 97 + y * 193
        h = 7 + Math.pow(((seed * 16807) % 1000) / 1000, 0.55) * 24
      }
      for (const rings of polygons) {
        const outer = rings[0]
        if (!outer) continue
        const pts = outer.slice(0, -1).map((p) => this.project(p))
        const b = makeBuilding(pts, Math.min(Math.max(h, 4), 700), String(props.name ?? '') || undefined)
        if (b) {
          const ll = worldToLatLon(this.city, b.cx, b.cz)
          b.id = buildingId(ll.lat, ll.lon); b.tile = sourceTile; b.tags = { ...props }
          // Clipped footprints do not have canonical centroids: never persist claims against them.
          b.clipped = f.loadGeometry().some(r => r.some(p => p.x <= 0 || p.y <= 0 || p.x >= f.extent || p.y >= f.extent))
          for (const {zone,minX,maxX,minZ,maxZ} of zones) if (b.cx>=minX && b.cx<=maxX && b.cz>=minZ && b.cz<=maxZ && pointInPoly(b.cx, b.cz, zone.poly)) {
            b.gang = zone.gang
            if (zone.tags.landuse === 'residential' || protectedVenue(zone.tags)) b.tags.landuse = String(zone.tags.landuse || zone.tags.class)
          }
          for(let gx=Math.floor(b.minX/128);gx<=Math.floor(b.maxX/128);gx++)
          for(let gz=Math.floor(b.minZ/128);gz<=Math.floor(b.maxZ/128);gz++)
          for (const venue of venueCells.get(`${gx},${gz}`) ?? []) if (pointInPoly(venue.x, venue.z, b.poly)) {
            if (protectedVenue(venue.tags)) b.tags.amenity = String(venue.tags.amenity)
            else if (!protectedVenue(b.tags)) Object.assign(b.tags, venue.tags)
          }
          b.eligible = !b.clipped && ['commercial','industrial','retail','warehouse'].includes(String(b.tags.building)) && criminalEligible(b.tags)
          this.city.buildings.push(b)
        }
      }
    }

    const rLayer = tile.layers.transportation
    if (rLayer) for (let i = 0; i < rLayer.length; i++) {
      const f = rLayer.feature(i)
      const cls = ROAD_CLASS[String(f.properties.class)]
      if (!cls) continue
      const geo = f.toGeoJSON(x, y, TILE_ZOOM).geometry as GeoGeometry
      const lines = geo.type === 'LineString' ? [geo.coordinates] : geo.type === 'MultiLineString' ? geo.coordinates : []
      for (const line of lines) this.addRoad(line, cls.width, cls.major, f.properties as Tags)
    }
  }

  async loadAround(x: number, z: number, ring = 1, signal?: AbortSignal): Promise<MapDelta | null> {
    if (this.busy) return null
    this.busy = true
    const beforeB = this.city.buildings.length, beforeR = this.city.roads.length
    try {
      const ll = worldToLatLon(this.city, x, z)
      const center = tileFor(ll.lat, ll.lon, TILE_ZOOM)
      const jobs: { key: string; x: number; y: number; data: Promise<Uint8Array> }[] = []
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
        const tx = center.x + dx, ty = center.y + dy, key = `${TILE_ZOOM}/${tx}/${ty}`
        if (this.loaded.has(key)) continue
        let data = this.pending.get(key)
        if (!data) {
          data = downloadTile(this.template.replace('{z}', String(TILE_ZOOM)).replace('{x}', String(tx)).replace('{y}', String(ty)), signal)
          this.pending.set(key, data)
        }
        jobs.push({ key, x: tx, y: ty, data })
      }
      if (!jobs.length) return null
      const settled = await Promise.allSettled(jobs.map((j) => j.data))
      let tiles = 0
      for (const [i,result] of settled.entries()) {
        const job = jobs[i]
        this.pending.delete(job.key)
        if (result.status === 'fulfilled') {
          await this.parse(result.value, job.x, job.y)
          this.loaded.add(job.key)
          tiles++
        }
      }
      if (!tiles) throw new Error('Map tile network unavailable')
      finalizeGraph(this.city.nodes)
      this.city.landmarks=pickLandmarks(this.city.key,this.city.buildings)
      let extent = RADIUS
      for (const n of this.city.nodes) extent = Math.max(extent, Math.abs(n.x), Math.abs(n.z))
      this.city.radius = extent + 300
      return { buildingsFrom: beforeB, roadsFrom: beforeR, tiles }
    } finally {
      this.busy = false
    }
  }

  get tileCount() { return this.loaded.size }
}

const streamers = new WeakMap<CityData, MapStreamer>()
export const streamerFor = (city: CityData) => streamers.get(city)

export async function fetchCity(
  name: string,
  lat: number,
  lon: number,
  onStatus: (s: string) => void,
  signal: AbortSignal,
): Promise<CityData> {
  const key = cityKey(lat, lon)
  const city: CityData = { key, name, lat, lon, radius: RADIUS, buildings: [], roads: [], nodes: [], landmarks: [], venues: [], zones: [], waters: [], procedural: false }
  onStatus('Connecting to the global OpenStreetMap tile network…')
  const streamer = new MapStreamer(city, await tileTemplate(signal))
  streamers.set(city, streamer)
  onStatus('Streaming the first map sector…')
  await streamer.loadAround(0, 0, 0, signal)
  if (city.nodes.length < 20) throw new Error('No driveable streets found here')
  city.landmarks = pickLandmarks(key, city.buildings)
  onStatus(`Loaded ${streamer.tileCount} sectors · ${city.buildings.length.toLocaleString()} real buildings`)
  return city
}

/** Explicit offline simulation; never published to global persistence. */
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
    nodes[a].width = Math.max(nodes[a].width ?? 0, major ? 6.5 : 5)
    nodes[b].width = Math.max(nodes[b].width ?? 0, major ? 6.5 : 5)
    nodes[a].adj.push(b)
    nodes[b].adj.push(a)
    roads.push({ pts: [[nodes[a].x, nodes[a].z], [nodes[b].x, nodes[b].z]], width: major ? 6.5 : 5, major })
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
          const h = 10 + r() * r() * (220 * Math.max(0, 1 - dist) + 30)
          const bld = makeBuilding([[x, z], [x + w, z], [x + w, z + d], [x, z + d]], h)
          if (bld) buildings.push(bld)
        }
    }
  for (const b of buildings) {
    b.id = `sim_${buildingId(lat - b.cz / 110540, lon + b.cx / (111320 * Math.cos(lat * Math.PI / 180)))}`
    b.tags = { building: 'commercial' }; b.eligible = true; b.gang = 'SHINOBI'
  }
  finalizeGraph(nodes)
  const key = cityKey(lat, lon) + ':sim'
  return { key, name, lat, lon, radius: RADIUS, buildings, roads, nodes, venues: [], zones: [], waters: [], landmarks: pickLandmarks(key, buildings), procedural: true }
}

export interface GeoResult { name: string; area: string; lat: number; lon: number }

let geocoderConfig:Promise<{geocoder?:string}>|undefined
export async function geocode(q: string): Promise<GeoResult[]> {
  geocoderConfig??=fetch('/config.json').then(r=>r.ok?r.json():{}).catch(()=>({}))
  const config=await geocoderConfig
  const endpoint=config.geocoder??'/api/geocode'
  const url = `${endpoint}${endpoint.includes('?')?'&':'?'}q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Place search unavailable (${res.status}). Choose a preset or use your location.`)
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
