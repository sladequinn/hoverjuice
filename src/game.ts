import * as THREE from 'three'
import { CITIES, CONTRACT_TYPES, JUICE_PRICE, VEHICLES, vehicleById, type ContractType } from './data'
import { fetchCity, geocode, proceduralCity, streamerFor, type CityData } from './map'
import { Player, type Input } from './vehicle'
import { Character, MASKS, buildMask, type FootInput } from './character'
import { World } from './world'
import { TrafficSystem } from './traffic'
import { CombatSystem } from './combat'

const SAVE_KEY = 'hoverghini.save.v1'

interface Holding {
  id: string
  name: string
  city: string
  cityKey: string
  building: number
  income: number
}

interface SaveData {
  money: number
  owned: string[]
  current: string
  holdings: Holding[]
  city: { name: string; lat: number; lon: number } | null
  deliveries: number
  earned: number
  won: boolean
  masks: string[]
  mask: string
  cam: 'chase' | 'top'
}

interface Contract {
  id: number
  type: ContractType
  client: string
  from: number
  to: number
  dist: number
  pay: number
  time: number
  stage: 'pickup' | 'dropoff'
  remaining: number
}

const CLIENTS = [
  'Mama Zhu’s Noodle Cartel', 'Kiroshi Optics', 'Dr. Vex (unlicensed)', 'Halo Pharma', 'Byte Street Fixers',
  'The Chrome Saints', 'Nightline Radio', 'Okabe Heavy Industries', 'Solstice Hotels', 'Rust Alley Co-op',
  'Mx. Arcadia', 'Velvet Circuit Club',
]

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
export const money = (n: number) => '$' + Math.floor(n).toLocaleString('en-US')

function defaultSave(): SaveData {
  return { money: 150, owned: ['board'], current: 'board', holdings: [], city: null, deliveries: 0, earned: 0, won: false, masks: ['none', 'rooster', 'pig'], mask: 'rooster', cam: 'chase' }
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) return { ...defaultSave(), ...JSON.parse(raw) }
  } catch {
    /* corrupted save: start fresh */
  }
  return defaultSave()
}

class Heap {
  private a: [number, number][] = []
  get size() { return this.a.length }
  push(v: number, p: number) {
    const a = this.a
    a.push([p, v])
    let i = a.length - 1
    while (i > 0) {
      const j = (i - 1) >> 1
      if (a[j][0] <= a[i][0]) break
      ;[a[i], a[j]] = [a[j], a[i]]
      i = j
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1, r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[i], a[m]] = [a[m], a[i]]
        i = m
      }
    }
    return top[1]
  }
}

export class Game {
  save = loadSave()
  world: World | null = null
  traffic: TrafficSystem | null = null
  combat: CombatSystem | null = null
  player: Player
  character: Character
  onFoot = false
  juice = 0
  scene: THREE.Scene
  paused = true
  loading = false
  offers: Contract[] = []
  active: Contract | null = null
  waypoint: { x: number; z: number; label: string } | null = null
  private nextId = 1
  private offerTimer = 0
  private incomeTimer = 0
  private saveTimer = 0
  private routeTimer = 0
  private route: number[] = []
  private routeLine: THREE.Line | null = null
  private beacon: THREE.Group
  private arrow: THREE.Mesh
  private minimapBase: HTMLCanvasElement | null = null
  private mmScale = 0.2
  private pityTimer = 0
  private toastTimer = 0
  private thumbs = new Map<string, string>()
  private streamTimer = 0
  private streamBusy = false
  private mapOpen = false
  private mapZoom = 1

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.player = new Player(vehicleById(this.save.current), this.save.mask)
    this.juice = this.player.spec.tank
    scene.add(this.player.mesh)
    this.character = new Character(this.save.mask)
    scene.add(this.character.mesh)

    this.beacon = new THREE.Group()
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 400, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    )
    beam.position.y = 200
    beam.name = 'beam'
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.5, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffe14d }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.6
    ring.name = 'ring'
    this.beacon.add(beam, ring)
    this.beacon.visible = false
    scene.add(this.beacon)

    this.arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 1.1, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }),
    )
    this.arrow.geometry.rotateX(Math.PI / 2)
    this.arrow.visible = false
    scene.add(this.arrow)
  }

  get actor() {
    return this.onFoot ? this.character.pos : this.player.pos
  }

  get actorHeading() {
    return this.onFoot ? this.character.heading : this.player.heading
  }

  get hasSave() {
    return this.save.city !== null
  }

  persist() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.save))
  }

  resetSave() {
    localStorage.removeItem(SAVE_KEY)
    location.reload()
  }

  toast(msg: string, kind: 'good' | 'bad' | 'info' = 'info') {
    const t = $('toast')
    t.textContent = msg
    t.className = `toast show ${kind}`
    this.toastTimer = 3.2
  }

  earn(amount: number) {
    this.save.money += amount
    this.save.earned += amount
  }

  // ---------- cities ----------

  async warp(name: string, lat: number, lon: number) {
    if (this.loading) return
    this.loading = true
    this.paused = true
    const overlay = $('loading')
    overlay.classList.add('show')
    $('loading-city').textContent = name
    $('loading-status').textContent = 'Opening warp gate…'
    $('btn-load-cancel').style.display = this.world ? '' : 'none'
    const ctrl = new AbortController()
    let choice: 'sim' | 'cancel' | null = null
    const onSim = () => { choice = 'sim'; ctrl.abort() }
    const onCancel = () => { choice = 'cancel'; ctrl.abort() }
    $('btn-load-sim').addEventListener('click', onSim)
    $('btn-load-cancel').addEventListener('click', onCancel)
    const started = performance.now()
    const tick = setInterval(() => ($('loading-time').textContent = `${Math.floor((performance.now() - started) / 1000)}s`), 250)
    $('loading-time').textContent = '0s'

    let city: CityData | null = null
    try {
      city = await fetchCity(name, lat, lon, (s) => ($('loading-status').textContent = s), ctrl.signal)
    } catch (e) {
      if (choice !== 'cancel') {
        if (choice !== 'sim') {
          console.warn('Map fetch failed, using simulation grid', e)
          $('loading-status').textContent = 'Map servers unreachable. Compiling a simulation grid…'
          await new Promise((r) => setTimeout(r, 900))
        }
        city = proceduralCity(name, lat, lon)
      }
    } finally {
      clearInterval(tick)
      $('btn-load-sim').removeEventListener('click', onSim)
      $('btn-load-cancel').removeEventListener('click', onCancel)
    }
    if (!city) {
      overlay.classList.remove('show')
      this.loading = false
      this.toast('Warp cancelled', 'info')
      return
    }
    $('loading-status').textContent = `Extruding ${city.buildings.length.toLocaleString()} towers…`
    await new Promise((r) => setTimeout(r, 30))

    if (this.world) {
      if (this.traffic) {
        this.scene.remove(this.traffic.group)
        this.traffic.dispose()
        this.traffic = null
      }
      if (this.combat) {
        this.scene.remove(this.combat.group)
        this.combat.dispose()
        this.combat = null
      }
      this.scene.remove(this.world.group)
      this.world.dispose()
    }
    this.world = new World(city)
    this.scene.add(this.world.group)
    this.traffic = new TrafficSystem(this.world)
    this.scene.add(this.traffic.group)
    this.combat = new CombatSystem(this.world)
    this.scene.add(this.combat.group)
    this.refreshOwned()

    const main = city.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.main && n.adj.length > 0)
    main.sort((a, b) => Math.hypot(a.n.x, a.n.z) - Math.hypot(b.n.x, b.n.z))
    const pumps = this.world.pumps
    const spawn = main.find(({ n }) => pumps.every((p) => Math.hypot(p.x - n.x, p.z - n.z) > 40)) ?? main[0]
    this.player.placeAtNode(this.world, spawn?.i ?? 0)
    this.juice = Math.max(this.juice, this.player.spec.tank * 0.6)
    this.active = null
    this.waypoint = null
    this.offers = []
    this.generateOffers()
    this.buildMinimap()
    this.save.city = { name, lat, lon }
    this.persist()

    overlay.classList.remove('show')
    $('hud').classList.add('show')
    $('city-name').textContent = city.name
    $('city-tag').textContent = city.procedural ? 'SIM GRID' : `OSM · ${streamerFor(city)?.tileCount ?? 0} SECTORS`
    this.loading = false
    this.closeModal()
    this.toast(
      city.procedural
        ? `Warped to ${name} (simulation grid, real map data unavailable)`
        : `Warped to ${name}. ${city.landmarks.length} landmarks are on the market.`,
      city.procedural ? 'bad' : 'good',
    )
  }

  // ---------- contracts ----------

  private mainNodes() {
    const w = this.world!
    const out: number[] = []
    w.city.nodes.forEach((n, i) => n.main && Math.hypot(n.x, n.z) < w.city.radius * 0.92 && out.push(i))
    return out
  }

  generateOffers() {
    const w = this.world
    if (!w) return
    const pool = this.mainNodes()
    if (pool.length < 2) return
    const p = this.actor
    const near = pool.filter((i) => Math.hypot(w.city.nodes[i].x - p.x, w.city.nodes[i].z - p.z) < 450)
    const spec = this.player.spec
    this.offers = []
    for (let k = 0; k < 4; k++) {
      const type = k === 3 || Math.random() < 0.18 ? CONTRACT_TYPES[2] : Math.random() < 0.35 ? CONTRACT_TYPES[1] : CONTRACT_TYPES[0]
      const src = near.length ? near : pool
      const from = src[Math.floor(Math.random() * src.length)]
      let to = from, dist = 0
      for (let tries = 0; tries < 40; tries++) {
        const cand = pool[Math.floor(Math.random() * pool.length)]
        const d = Math.hypot(w.city.nodes[cand].x - w.city.nodes[from].x, w.city.nodes[cand].z - w.city.nodes[from].z)
        if (d > 350 && d < 1300) { to = cand; dist = d; break }
        if (d > dist) { to = cand; dist = d }
      }
      const pathDist = dist * 1.3
      const pay = Math.round(((40 + pathDist * 0.13) * spec.payMult * type.payMult) / 5) * 5
      const time = Math.round((pathDist / (spec.maxSpeed * 0.62) + 25) * type.timeMult)
      this.offers.push({
        id: this.nextId++,
        type,
        client: CLIENTS[Math.floor(Math.random() * CLIENTS.length)],
        from,
        to,
        dist: pathDist,
        pay,
        time,
        stage: 'pickup',
        remaining: time,
      })
    }
    this.offerTimer = 75
    if ($('modal').dataset.view === 'contracts') this.openModal('contracts')
  }

  accept(id: number) {
    const c = this.offers.find((o) => o.id === id)
    if (!c) return
    this.active = c
    this.offers = this.offers.filter((o) => o.id !== id)
    this.waypoint = null
    this.routeTimer = 0
    this.closeModal()
    this.toast(`Contract accepted: head to the pickup for ${c.client}`, 'info')
  }

  abandon() {
    if (!this.active) return
    this.toast('Contract abandoned. The client will remember that.', 'bad')
    this.active = null
    this.closeModal()
  }

  private target() {
    const w = this.world
    if (!w) return null
    if (this.active) {
      const n = w.city.nodes[this.active.stage === 'pickup' ? this.active.from : this.active.to]
      return { x: n.x, z: n.z, node: this.active.stage === 'pickup' ? this.active.from : this.active.to }
    }
    if (this.waypoint) return { ...this.waypoint, node: -1 }
    return null
  }

  private updateContract(dt: number) {
    const c = this.active
    const w = this.world!
    if (!c) return
    const tgt = w.city.nodes[c.stage === 'pickup' ? c.from : c.to]
    const d = Math.hypot(tgt.x - this.actor.x, tgt.z - this.actor.z)
    if (c.stage === 'dropoff') c.remaining -= dt
    if (d < 16 && this.actor.y < 30) {
      if (c.stage === 'pickup') {
        c.stage = 'dropoff'
        c.remaining = c.time
        this.routeTimer = 0
        this.toast(`Package secured. ${c.time}s on the clock.`, 'info')
      } else {
        const late = c.remaining < 0
        const pay = Math.round(late ? c.pay * 0.4 : c.pay + Math.max(0, c.remaining) * c.pay * 0.004)
        this.earn(pay)
        this.save.deliveries++
        this.active = null
        this.persist()
        this.toast(late ? `Late delivery. Client docked you: +${money(pay)}` : `Delivered! +${money(pay)} (incl. speed tip)`, late ? 'bad' : 'good')
        this.generateOffers()
      }
    }
  }

  // ---------- routing ----------

  private computeRoute() {
    const w = this.world
    const tgt = this.target()
    if (!w || !tgt) { this.route = []; return }
    let goal = tgt.node
    const nodes = w.city.nodes
    if (goal < 0) {
      let bd = Infinity
      nodes.forEach((n, i) => {
        if (!n.main) return
        const d = Math.hypot(n.x - tgt.x, n.z - tgt.z)
        if (d < bd) { bd = d; goal = i }
      })
    }
    let start = -1
    if (this.player.mode === 'mag' && !this.onFoot) start = this.player.edgeB
    else {
      let bd = Infinity
      nodes.forEach((n, i) => {
        if (!n.main) return
        const d = Math.hypot(n.x - this.actor.x, n.z - this.actor.z)
        if (d < bd) { bd = d; start = i }
      })
    }
    if (start < 0 || goal < 0) { this.route = []; return }
    const g = new Float64Array(nodes.length).fill(Infinity)
    const prev = new Int32Array(nodes.length).fill(-1)
    const heap = new Heap()
    g[start] = 0
    heap.push(start, 0)
    const gx = nodes[goal].x, gz = nodes[goal].z
    let found = false
    while (heap.size) {
      const u = heap.pop()
      if (u === goal) { found = true; break }
      const nu = nodes[u]
      for (const v of nu.adj) {
        const nv = nodes[v]
        const cost = g[u] + Math.hypot(nv.x - nu.x, nv.z - nu.z)
        if (cost < g[v]) {
          g[v] = cost
          prev[v] = u
          heap.push(v, cost + Math.hypot(nv.x - gx, nv.z - gz))
        }
      }
    }
    const path: number[] = []
    if (found) for (let u = goal; u >= 0; u = prev[u]) path.unshift(u)
    this.route = path
  }

  private drawRoute() {
    if (this.routeLine) {
      this.scene.remove(this.routeLine)
      this.routeLine.geometry.dispose()
      this.routeLine = null
    }
    const w = this.world
    if (!w || this.route.length < 2) return
    const pts: THREE.Vector3[] = []
    for (const i of this.route) pts.push(new THREE.Vector3(w.city.nodes[i].x, 0.35, w.city.nodes[i].z))
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    this.routeLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9 }))
    this.scene.add(this.routeLine)
  }

  /** Which way the route wants the player to go at the upcoming junction. */
  routeHint(): number | null {
    const w = this.world
    if (!w || this.player.mode !== 'mag' || this.route.length < 2) return null
    const nodes = w.city.nodes
    const b = this.player.edgeB
    const idx = this.route.indexOf(b)
    if (idx < 0 || idx + 1 >= this.route.length) return null
    if (nodes[b].adj.length <= 2) return null
    const a = nodes[this.player.edgeA], bn = nodes[b], c = nodes[this.route[idx + 1]]
    const inA = Math.atan2(bn.x - a.x, bn.z - a.z)
    const out = Math.atan2(c.x - bn.x, c.z - bn.z)
    const rel = Math.atan2(Math.sin(out - inA), Math.cos(out - inA))
    return rel > 0.45 ? 1 : rel < -0.45 ? -1 : 0
  }

  // ---------- fuel ----------

  refuel() {
    const w = this.world
    if (!w || this.paused) return
    const { dist } = w.nearestPump(this.player.pos.x, this.player.pos.z)
    if (dist > 18) return
    const need = this.player.spec.tank - this.juice
    if (need < 0.5) { this.toast('Tank is already full.'); return }
    const afford = Math.min(need, this.save.money / JUICE_PRICE)
    if (afford < 1) {
      if (this.pityTimer > 0) { this.toast('You’re broke. The attendant already helped you once, come back later.', 'bad'); return }
      const free = this.player.spec.tank * 0.3
      this.juice = Math.min(this.player.spec.tank, this.juice + free)
      this.pityTimer = 90
      this.toast('Broke? The attendant slips you a free splash of HJ-77.', 'info')
      return
    }
    this.juice += afford
    this.save.money -= afford * JUICE_PRICE
    this.toast(`Pumped ${afford.toFixed(1)} L of HJ-77 for ${money(afford * JUICE_PRICE)}`, 'good')
  }

  promptAction() {
    const w = this.world
    if (!w || this.paused) return
    if (this.onFoot) { this.toggleVehicle(); return }
    if (w.nearestPump(this.player.pos.x, this.player.pos.z).dist <= 18) this.refuel()
    else if (this.juice <= 0) this.tow()
  }

  toggleVehicle() {
    const w = this.world
    if (!w || this.paused) return
    const p = this.player, c = this.character
    if (this.onFoot) {
      if (c.pos.distanceTo(p.pos) > 5.5) { this.toast('Walk back to your ride to hop on', 'info'); return }
      this.onFoot = false
      c.mesh.visible = false
      p.showRider(true)
      this.routeTimer = 0
      return
    }
    if (!p.parked) { this.toast('Slow down and drop low to hop off', 'bad'); return }
    const side = p.spec.kind === 'board' ? 1.3 : 2.6
    const rx = -Math.cos(p.heading), rz = Math.sin(p.heading)
    let x = p.pos.x + rx * side, z = p.pos.z + rz * side
    if (w.hitBuilding(x, z, 0.5) >= 0) { x = p.pos.x - rx * side; z = p.pos.z - rz * side }
    p.speed = 0
    p.vel.set(0, 0)
    c.pos.set(x, w.groundHeightAt(x, z, p.pos.y), z)
    c.vel.set(0, 0)
    c.heading = p.heading
    c.mesh.visible = true
    c.update(0, { moveX: 0, moveY: 0, sprint: false, jump: false }, w, p.heading)
    p.showRider(false)
    this.onFoot = true
    this.routeTimer = 0
    this.toast(`On foot. ${isTouch() ? 'Stick to run, JUMP to leap' : 'WASD to run, Space to jump, X to hop back on'}`, 'info')
  }

  cycleCamera() {
    this.save.cam = this.save.cam === 'chase' ? 'top' : 'chase'
    this.persist()
    this.toast(this.save.cam === 'top' ? 'Camera: TOP-DOWN' : 'Camera: CHASE', 'info')
  }

  fireWeapon() {
    if (this.paused || !this.world || this.juice <= 0) return
    if (this.combat?.fire(this.actor, this.actorHeading, this.onFoot)) {
      this.juice = Math.max(0, this.juice - (this.onFoot ? 0.025 : 0.06))
    }
  }

  toggleMap(force?: boolean) {
    if (!this.world) return
    this.mapOpen = force ?? !this.mapOpen
    $('map-overlay').classList.toggle('show', this.mapOpen)
    this.paused = this.mapOpen
    if (this.mapOpen) this.drawFullMap()
  }

  zoomMap(factor: number) {
    this.mapZoom = Math.max(0.7, Math.min(5, this.mapZoom * factor))
    this.drawFullMap()
  }

  private async streamMap() {
    const w = this.world
    const streamer = w && !w.city.procedural ? streamerFor(w.city) : undefined
    if (!w || !streamer || this.streamBusy) return
    this.streamBusy = true
    $('city-tag').classList.add('streaming')
    try {
      const delta = await streamer.loadAround(this.actor.x, this.actor.z)
      if (delta && this.world === w) {
        w.appendMap(delta)
        this.traffic?.ensurePopulation()
        this.combat?.ensurePopulation()
        this.buildMinimap()
        $('city-tag').textContent = `OSM · ${streamer.tileCount} SECTORS`
        if (this.mapOpen) this.drawFullMap()
      }
    } catch (e) {
      console.warn('Background map streaming failed; cached sectors remain playable', e)
      this.toast('Map uplink interrupted — retrying in the background', 'bad')
    } finally {
      this.streamBusy = false
      $('city-tag').classList.remove('streaming')
    }
  }

  buyMask(id: string) {
    const m = MASKS.find((x) => x.id === id)
    if (!m || this.save.masks.includes(id) || this.save.money < m.price) return
    this.save.money -= m.price
    this.save.masks.push(id)
    this.equipMask(id)
  }

  equipMask(id: string) {
    if (!this.save.masks.includes(id)) return
    this.save.mask = id
    this.player.setMask(id)
    this.character.setMask(id)
    this.persist()
    this.openModal('masks')
  }

  private maskThumbs() {
    if (this.thumbs.size) return
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    r.setPixelRatio(1)
    r.setSize(128, 128)
    const sc = new THREE.Scene()
    sc.add(new THREE.HemisphereLight(0xffffff, 0x662255, 2.4))
    const dl = new THREE.DirectionalLight(0xffffff, 1.6)
    dl.position.set(1, 1.5, 2)
    sc.add(dl)
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10)
    cam.position.set(0.5, 0.2, 1.55)
    cam.lookAt(0, 0.08, 0)
    for (const m of MASKS) {
      const g = buildMask(m.id)
      g.rotation.y = 0.25
      sc.add(g)
      r.render(sc, cam)
      this.thumbs.set(m.id, r.domElement.toDataURL())
      sc.remove(g)
    }
    r.dispose()
    r.forceContextLoss()
  }

  tow() {
    const w = this.world
    if (!w || this.paused || this.onFoot) return
    const fee = Math.round(30 * this.player.spec.payMult)
    const { pump } = w.nearestPump(this.player.pos.x, this.player.pos.z)
    if (!pump) return
    this.save.money = Math.max(0, this.save.money - fee)
    this.player.placeAtNode(w, pump.node)
    this.toast(`Grav-tow dropped you at the nearest HJ-77 pump (-${money(fee)})`, 'info')
  }

  toggleMode() {
    const w = this.world
    if (!w || this.paused) return
    if (this.onFoot) { this.toast('Hop back on your ride first', 'info'); return }
    if (this.player.mode === 'mag') {
      const sling = this.player.unsnap()
      this.toast(sling ? 'SLINGSHOT! Launched off the conduit into FREE HOVER' : `FREE HOVER: inertia drifting, ${isTouch() ? 'BOOST' : 'Shift'} to hyper-boost`, sling ? 'good' : 'info')
    } else if (this.player.pos.y > 12) {
      this.toast('Drop below 12 m to Mag-Lock onto a conduit', 'bad')
    } else if (this.player.snap(w)) {
      this.toast(`MAG-LOCK engaged: conduit riding, ${isTouch() ? '◀ ▶' : 'A/D'} picks the branch`, 'info')
    } else {
      this.toast('No street conduit in range', 'bad')
    }
    this.routeTimer = 0
  }

  // ---------- garage & real estate ----------

  buyVehicle(id: string) {
    const v = vehicleById(id)
    if (this.save.owned.includes(id) || this.save.money < v.price) return
    this.save.money -= v.price
    this.save.owned.push(id)
    this.selectVehicle(id)
    this.juice = v.tank
    this.persist()
    if (id === 'hoverghini' && !this.save.won) {
      this.save.won = true
      this.persist()
      this.openModal('win')
      return
    }
    this.toast(`${v.name} is yours. Full tank on the house.`, 'good')
    this.openModal('garage')
  }

  selectVehicle(id: string) {
    if (!this.save.owned.includes(id)) return
    const v = vehicleById(id)
    const ratio = this.juice / this.player.spec.tank
    this.player.setSpec(v)
    this.juice = v.tank * ratio
    this.save.current = id
    if (this.player.mode === 'free' && this.player.targetAlt > v.maxAlt) this.player.targetAlt = v.maxAlt
    this.persist()
    this.openModal('garage')
  }

  buyLandmark(id: string) {
    const w = this.world
    if (!w) return
    const l = w.city.landmarks.find((x) => x.id === id)
    if (!l || this.save.holdings.some((h) => h.id === id) || this.save.money < l.price) return
    this.save.money -= l.price
    this.save.holdings.push({ id, name: l.name, city: w.city.name, cityKey: w.city.key, building: l.building, income: l.income })
    this.refreshOwned()
    this.persist()
    this.toast(`You now own ${l.name}. +${money(l.income)}/min`, 'good')
    this.openModal('holdings')
  }

  locate(id: string) {
    const w = this.world
    const l = w?.city.landmarks.find((x) => x.id === id)
    if (!w || !l) return
    const b = w.city.buildings[l.building]
    this.waypoint = { x: b.cx, z: b.cz, label: l.name }
    this.routeTimer = 0
    this.closeModal()
    this.toast(`Waypoint set: ${l.name}`, 'info')
  }

  get incomePerMin() {
    return this.save.holdings.reduce((s, h) => s + h.income, 0)
  }

  private refreshOwned() {
    const w = this.world
    if (!w) return
    w.setOwned(this.save.holdings.filter((h) => h.cityKey === w.city.key).map((h) => h.building))
  }

  // ---------- modals ----------

  openModal(view: string) {
    if (!this.world && view !== 'warp') return
    const m = $('modal')
    m.dataset.view = view
    const body = $('modal-body')
    const tabs: [string, string][] = [['contracts', 'Contracts'], ['garage', 'Garage'], ['masks', 'Masks'], ['holdings', 'Estate'], ['warp', 'Warp'], ['help', 'Help']]
    const tabBar = this.world && view !== 'win'
      ? `<nav class="tabs">${tabs.map(([id, label]) => `<button class="tab ${id === view ? 'on' : ''}" data-act="view" data-arg="${id}">${label}</button>`).join('')}<button class="tab-close" data-act="close" aria-label="Close">✕</button></nav>`
      : ''
    $('modal-close').style.display = tabBar || view === 'win' || !this.world ? 'none' : ''
    const card = body.parentElement!
    const scroll = view === m.dataset.lastView ? card.scrollTop : 0
    m.dataset.lastView = view
    body.innerHTML = tabBar + this.renderView(view)
    card.scrollTop = scroll
    m.classList.add('show')
    this.paused = true
    body.querySelectorAll<HTMLElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => this.onAction(b.dataset.act!, b.dataset.arg ?? '')),
    )
    const form = body.querySelector<HTMLFormElement>('#search-form')
    form?.addEventListener('submit', (e) => {
      e.preventDefault()
      void this.search((form.elements.namedItem('q') as HTMLInputElement).value)
    })
  }

  closeModal() {
    const m = $('modal')
    if (!this.world) return
    m.classList.remove('show')
    m.dataset.view = ''
    if (!this.loading) this.paused = false
  }

  private onAction(act: string, arg: string) {
    switch (act) {
      case 'accept': this.accept(Number(arg)); break
      case 'abandon': this.abandon(); break
      case 'refresh': this.generateOffers(); break
      case 'buy-vehicle': this.buyVehicle(arg); break
      case 'select-vehicle': this.selectVehicle(arg); break
      case 'buy-landmark': this.buyLandmark(arg); break
      case 'locate': this.locate(arg); break
      case 'warp': {
        const [lat, lon, ...name] = arg.split('|')
        void this.warp(name.join('|'), Number(lat), Number(lon))
        break
      }
      case 'view': this.openModal(arg); break
      case 'close': this.closeModal(); break
      case 'buy-mask': this.buyMask(arg); break
      case 'equip-mask': this.equipMask(arg); break
      case 'cheat':
        this.earn(5_000_000)
        this.persist()
        this.toast('+$5,000,000 test funds wired to your account', 'good')
        this.openModal($('modal').dataset.view || 'garage')
        break
      case 'reset': if (confirm('Wipe your save and start over as a gutter courier?')) this.resetSave(); break
    }
  }

  private async search(q: string) {
    const out = document.getElementById('search-results')
    if (!out || !q.trim()) return
    out.innerHTML = '<p class="muted">Scanning the global grid…</p>'
    try {
      const res = await geocode(q)
      out.innerHTML = res.length
        ? res
            .map(
              (r) => `<button class="city-btn" data-act="warp" data-arg="${r.lat}|${r.lon}|${esc(r.name)}">
                <strong>${esc(r.name)}</strong><span>${esc(r.area)}</span></button>`,
            )
            .join('')
        : '<p class="muted">No matches. Try a city or neighbourhood name.</p>'
      out.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => this.onAction(b.dataset.act!, b.dataset.arg ?? '')))
    } catch {
      out.innerHTML = '<p class="error">Geocoder unreachable. Pick one of the preset cities instead.</p>'
    }
  }

  private renderView(view: string): string {
    const s = this.save
    const w = this.world
    switch (view) {
      case 'contracts': {
        const active = this.active
          ? `<div class="card active-card">
              <div class="row"><span class="pill ${this.active.type.id}">${this.active.type.label}</span><strong>${money(this.active.pay)}</strong></div>
              <h3>${esc(this.active.client)}</h3><p class="muted">${this.active.type.blurb}</p>
              <p>${this.active.stage === 'pickup' ? 'Heading to pickup' : `Delivering, ${Math.max(0, Math.ceil(this.active.remaining))}s left`}</p>
              <button class="btn danger" data-act="abandon">Abandon contract</button></div>`
          : ''
        const offers = this.offers
          .map(
            (o) => `<div class="card">
              <div class="row"><span class="pill ${o.type.id}">${o.type.label}</span><strong class="pay">${money(o.pay)}</strong></div>
              <h3>${esc(o.client)}</h3>
              <p class="muted">${o.type.blurb}</p>
              <div class="row meta"><span>${(o.dist / 1000).toFixed(1)} km</span><span>${o.time}s limit</span>${o.type.leak ? '<span class="warn">HJ leak</span>' : ''}</div>
              <button class="btn" data-act="accept" data-arg="${o.id}" ${this.active ? 'disabled' : ''}>${this.active ? 'Finish current job first' : 'Accept'}</button>
            </div>`,
          )
          .join('')
        return `<h2>Contract Board</h2>
          <p class="muted">Pay scales with your ride's cargo class (${this.player.spec.name}: ×${this.player.spec.payMult}). Beat the clock for a speed tip.</p>
          ${active}<div class="grid">${offers || '<p class="muted">No offers right now.</p>'}</div>
          <button class="btn ghost" data-act="refresh">Refresh board</button>`
      }
      case 'garage': {
        const max = { speed: 95, tank: 120, pay: 15, alt: 320 }
        const bar = (v: number, m: number) => `<div class="bar"><i style="width:${Math.min(100, (v / m) * 100)}%"></i></div>`
        const cards = VEHICLES.map((v) => {
          const owned = s.owned.includes(v.id)
          const current = s.current === v.id
          const afford = s.money >= v.price
          const btn = current
            ? '<button class="btn" disabled>Riding</button>'
            : owned
              ? `<button class="btn" data-act="select-vehicle" data-arg="${v.id}">Ride this</button>`
              : `<button class="btn ${afford ? 'buy' : ''}" data-act="buy-vehicle" data-arg="${v.id}" ${afford ? '' : 'disabled'}>Buy ${money(v.price)}</button>`
          return `<div class="card vehicle ${current ? 'current' : ''} ${v.id === 'hoverghini' ? 'goal' : ''}">
            <div class="swatch" style="--c:#${v.body.toString(16).padStart(6, '0')};--g:#${v.glow.toString(16).padStart(6, '0')}"></div>
            <h3>${v.name}</h3><p class="muted">${v.tagline}</p>
            <div class="stats">
              <label>Top speed <span>${Math.round(v.maxSpeed * 3.6)} km/h</span></label>${bar(v.maxSpeed, max.speed)}
              <label>HJ-77 tank <span>${v.tank} L</span></label>${bar(v.tank, max.tank)}
              <label>Cargo pay <span>×${v.payMult}</span></label>${bar(v.payMult, max.pay)}
              <label>Max altitude <span>${v.maxAlt} m</span></label>${bar(v.maxAlt, max.alt)}
              <label>Evaporation <span>${v.evap.toFixed(3)} L/s</span></label>
            </div>${btn}</div>`
        }).join('')
        return `<h2>Garage</h2><p class="muted">From gutter deck to Hoverghini. Bigger rides unlock richer cargo classes, but drink more HJ-77.</p>
          <div class="row test-funds"><span class="muted small">Playtesting?</span><button class="btn buy" data-act="cheat">+$5,000,000 test funds</button></div>
          <div class="grid">${cards}</div>`
      }
      case 'masks': {
        this.maskThumbs()
        const cards = MASKS.map((m) => {
          const owned = s.masks.includes(m.id)
          const current = s.mask === m.id
          const afford = s.money >= m.price
          const btn = current
            ? '<button class="btn" disabled>Wearing</button>'
            : owned
              ? `<button class="btn" data-act="equip-mask" data-arg="${m.id}">Wear</button>`
              : `<button class="btn ${afford ? 'buy' : ''}" data-act="buy-mask" data-arg="${m.id}" ${afford ? '' : 'disabled'}>${m.price ? 'Buy ' + money(m.price) : 'Free'}</button>`
          return `<div class="card mask ${current ? 'current' : ''}">
            <img src="${this.thumbs.get(m.id)}" alt="${m.name} mask" width="96" height="96" />
            <h3>${m.name}</h3><p class="muted small">${m.blurb}</p>${btn}</div>`
        }).join('')
        return `<h2>Masks</h2><p class="muted">Every courier needs a face for the job. Your mask shows on the board and when you're on foot.</p>
          <div class="grid masks">${cards}</div>`
      }
      case 'holdings': {
        const list = w
          ? w.city.landmarks
              .map((l) => {
                const owned = s.holdings.some((h) => h.id === l.id)
                const afford = s.money >= l.price
                const b = w.city.buildings[l.building]
                return `<div class="card land ${owned ? 'owned' : ''}">
                  <div class="row"><h3>${esc(l.name)}</h3>${owned ? '<span class="pill owned">OWNED</span>' : ''}</div>
                  <div class="row meta"><span>${Math.round(b.height)} m tall</span><span>+${money(l.income)}/min</span></div>
                  <div class="row">
                    <button class="btn ghost" data-act="locate" data-arg="${l.id}">Set waypoint</button>
                    ${owned ? '' : `<button class="btn ${afford ? 'buy' : ''}" data-act="buy-landmark" data-arg="${l.id}" ${afford ? '' : 'disabled'}>Buy ${money(l.price)}</button>`}
                  </div></div>`
              })
              .join('')
          : ''
        const elsewhere = s.holdings.filter((h) => h.cityKey !== w?.city.key)
        return `<h2>Real Estate: ${esc(w?.city.name ?? '')}</h2>
          <p class="muted">Buy landmark towers to earn passive rent every minute, in every city, forever. Owned towers glow gold.</p>
          <div class="summary"><div><small>Portfolio</small><strong>${s.holdings.length} properties</strong></div><div><small>Passive income</small><strong>${money(this.incomePerMin)}/min</strong></div></div>
          <div class="grid">${list || '<p class="muted">No landmarks found in this district.</p>'}</div>
          ${elsewhere.length ? `<h3 class="sub">Holdings in other cities</h3><ul class="plain">${elsewhere.map((h) => `<li>${esc(h.name)} <span class="muted">(${esc(h.city)})</span> <strong>+${money(h.income)}/min</strong></li>`).join('')}</ul>` : ''}`
      }
      case 'warp':
        return `<h2>${this.world ? 'Warp Gate' : 'Choose your city'}</h2>
          <p class="muted">Any real city on Earth, rebuilt as neon from OpenStreetMap data. Your cash, garage and portfolio travel with you.</p>
          <form id="search-form" class="search"><input name="q" placeholder="Search any city or neighbourhood…" autocomplete="off" /><button class="btn">Search</button></form>
          <div id="search-results" class="cities"></div>
          <h3 class="sub">Hot zones</h3>
          <div class="cities">${CITIES.map((c) => `<button class="city-btn" data-act="warp" data-arg="${c.lat}|${c.lon}|${c.name}"><strong>${c.name}</strong><span>${c.area}</span></button>`).join('')}</div>`
      case 'help':
        return `<h2>Courier Manual</h2>
          <div class="help">
            <div><h3>Flight</h3><ul class="plain keys">
              <li><kbd>W</kbd>/<kbd>S</kbd> Thrust and brake (hold S when stopped to reverse on a conduit)</li>
              <li><kbd>A</kbd>/<kbd>D</kbd> Steer, or pick the branch at the next junction in Mag-Lock</li>
              <li><kbd>E</kbd> Toggle Mag-Lock / Free Hover</li>
              <li><kbd>Shift</kbd> Hyper-boost (Free Hover only, burns HJ-77 fast)</li>
              <li><kbd>Shift</kbd> Boost works in Mag-Lock too; <kbd>Space</kbd> hops off the conduit</li>
              <li><kbd>Space</kbd>/<kbd>C</kbd> Climb and descend (Free Hover; ceiling depends on vehicle)</li>
              <li><kbd>X</kbd> Hop off / on your ride. On foot: <kbd>WASD</kbd> run, <kbd>Shift</kbd> sprint, <kbd>Space</kbd> jump</li>
              <li><kbd>V</kbd> Switch chase / top-down camera</li>
              <li><kbd>Q</kbd> Fire plasma weapon (works on foot or from your ride)</li>
            </ul></div>
            <div><h3>Business</h3><ul class="plain keys">
              <li><kbd>J</kbd> Contract board</li><li><kbd>G</kbd> Garage</li><li><kbd>P</kbd> Real estate</li><li><kbd>M</kbd> Warp to another city</li>
              <li><kbd>F</kbd> Refuel at a turquoise HJ-77 pump</li><li><kbd>T</kbd> Call a grav-tow to the nearest pump</li>
            </ul></div>
            <div><h3>Hoverjuice (HJ-77)</h3><p class="muted">Your repulsors drink a volatile turquoise fluid that evaporates constantly, even while parked. Run dry and you sink to a crawl.
            HJ-77 is also the precursor to the street drug Cyan-ade. Precursor contracts pay big, but the leaking canisters double your evaporation.</p></div>
            <div><h3>Touch controls</h3><p class="muted">◀ ▶ steer (or choose the junction branch), <b>GO</b> thrusts, <b>BRK</b> brakes and reverses.
            Tap the <b>MAG-LOCK</b> badge to switch modes; <b>BOOST</b> and ▲ ▼ altitude appear in Free Hover. Tap the fuel prompt at a pump to refuel.</p></div>
            <div><h3>Flight modes</h3><p class="muted"><b>Mag-Lock</b> snaps you to street conduits on an elastic tether: steer to swing across the lane, corners fling you wide, and leaving the conduit at speed slingshots you into Free Hover. <b>Free Hover</b> unlocks drifting, boosting and altitude, but towers are solid.</p></div>
          </div>
          <div class="row test-funds"><span class="muted small">Playtesting?</span><button class="btn buy" data-act="cheat">+$5,000,000 test funds</button></div>
          <div class="row"><span class="muted">${s.deliveries} deliveries · ${money(s.earned)} earned lifetime</span><button class="btn danger ghost" data-act="reset">Reset save</button></div>`
      case 'win':
        return `<div class="win"><h1>HOVERGHINI</h1><p>From the gutter to the skyline. You own the ultimate status symbol.</p>
          <p class="muted">${s.deliveries} deliveries · ${s.holdings.length} properties · ${money(s.earned)} earned</p>
          <button class="btn buy" data-act="close">Take her for a spin</button></div>`
    }
    return ''
  }

  // ---------- minimap ----------

  private buildMinimap() {
    const w = this.world!
    const size = 1800
    this.mmScale = 820 / Math.max(750, w.city.radius)
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    const o = size / 2
    g.fillStyle = '#07071a'
    g.fillRect(0, 0, size, size)
    g.fillStyle = '#1b1640'
    for (const b of w.city.buildings) {
      g.beginPath()
      b.poly.forEach(([x, z], i) => (i ? g.lineTo(o + x * this.mmScale, o + z * this.mmScale) : g.moveTo(o + x * this.mmScale, o + z * this.mmScale)))
      g.fill()
    }
    g.lineCap = 'round'
    for (const r of w.city.roads) {
      g.strokeStyle = r.major ? '#ff2bd6' : '#1fb8c9'
      g.lineWidth = Math.max(1, r.width * this.mmScale * 0.8)
      g.beginPath()
      r.pts.forEach(([x, z], i) => (i ? g.lineTo(o + x * this.mmScale, o + z * this.mmScale) : g.moveTo(o + x * this.mmScale, o + z * this.mmScale)))
      g.stroke()
    }
    this.minimapBase = c
  }

  private mapDot(g: CanvasRenderingContext2D, x: number, z: number, color: string, r: number) {
    const w = this.world!
    const base = this.minimapBase!
    const o = base.width / 2
    g.fillStyle = color
    g.beginPath()
    g.arc(o + x * this.mmScale, o + z * this.mmScale, r, 0, Math.PI * 2)
    g.fill()
    if (w.city.procedural) return
  }

  private drawFullMap() {
    const w = this.world
    const cv = $<HTMLCanvasElement>('full-map')
    const g = cv.getContext('2d')
    if (!w || !g || !this.minimapBase || !this.mapOpen) return
    const dpr = Math.min(devicePixelRatio, 2)
    const width = Math.max(1, cv.clientWidth), height = Math.max(1, cv.clientHeight)
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(height * dpr)) {
      cv.width = Math.round(width * dpr)
      cv.height = Math.round(height * dpr)
    }
    const base = this.minimapBase, o = base.width / 2
    const fit = Math.min(cv.width, cv.height) / base.width
    const scale = fit * this.mapZoom
    const px = o + this.actor.x * this.mmScale, pz = o + this.actor.z * this.mmScale
    g.fillStyle = '#05030d'
    g.fillRect(0, 0, cv.width, cv.height)
    g.save()
    g.translate(cv.width / 2, cv.height / 2)
    g.scale(scale, scale)
    g.drawImage(base, -px, -pz)
    g.translate(-px, -pz)
    for (const p of w.pumps) this.mapDot(g, p.x, p.z, '#19ffe6', 6 / scale)
    const t = this.target()
    if (t) this.mapDot(g, t.x, t.z, '#ffe14d', 9 / scale)
    if (this.route.length > 1) {
      g.strokeStyle = '#ffe14d'
      g.lineWidth = 4 / scale
      g.beginPath()
      this.route.forEach((i, n) => {
        const node = w.city.nodes[i]
        const x = o + node.x * this.mmScale, y = o + node.z * this.mmScale
        if (n) g.lineTo(x, y); else g.moveTo(x, y)
      })
      g.stroke()
    }
    this.mapDot(g, this.actor.x, this.actor.z, '#ffffff', 8 / scale)
    g.restore()
    $('map-coords').textContent = `${w.city.name} · ${streamerFor(w.city)?.tileCount ?? 'SIM'} sectors · ${(w.city.radius * 2 / 1000).toFixed(1)} km loaded`
  }

  private drawMinimap() {
    const w = this.world
    const cv = $<HTMLCanvasElement>('minimap')
    const g = cv.getContext('2d')
    if (!w || !g || !this.minimapBase) return
    const dpr = Math.min(window.devicePixelRatio, 2)
    const css = cv.clientWidth
    if (cv.width !== css * dpr) { cv.width = cv.height = css * dpr }
    const S = cv.width
    const zoom = (0.34 / this.mmScale) * dpr
    const base = this.minimapBase
    const o = base.width / 2
    const px = this.actor.x, pz = this.actor.z
    g.save()
    g.fillStyle = '#05050c'
    g.fillRect(0, 0, S, S)
    g.translate(S / 2, S / 2)
    g.rotate(-this.actorHeading + Math.PI)
    g.scale(zoom, zoom)
    g.drawImage(base, -(o + px * this.mmScale), -(o + pz * this.mmScale))
    const dot = (x: number, z: number, color: string, r: number) => {
      g.fillStyle = color
      g.beginPath()
      g.arc((x - px) * this.mmScale, (z - pz) * this.mmScale, r / zoom * dpr, 0, Math.PI * 2)
      g.fill()
    }
    for (const h of this.save.holdings) if (h.cityKey === w.city.key) { const b = w.city.buildings[h.building]; if (b) dot(b.cx, b.cz, '#ffc400', 3) }
    for (const p of w.pumps) dot(p.x, p.z, '#19ffe6', 3.5)
    if (this.route.length > 1) {
      g.strokeStyle = '#ffe14d'
      g.lineWidth = 2.5 / zoom * dpr
      g.beginPath()
      g.moveTo(0, 0)
      for (const i of this.route) g.lineTo((w.city.nodes[i].x - px) * this.mmScale, (w.city.nodes[i].z - pz) * this.mmScale)
      g.stroke()
    }
    const t = this.target()
    if (t) dot(t.x, t.z, this.active?.stage === 'dropoff' ? '#ffe14d' : '#ff2bd6', 6)
    g.restore()
    g.fillStyle = '#fff'
    g.beginPath()
    g.moveTo(S / 2, S / 2 - 8 * dpr)
    g.lineTo(S / 2 + 5 * dpr, S / 2 + 6 * dpr)
    g.lineTo(S / 2 - 5 * dpr, S / 2 + 6 * dpr)
    g.closePath()
    g.fill()
    if (this.mapOpen) this.drawFullMap()
  }

  // ---------- frame ----------

  update(dt: number, input: Input, foot: FootInput, camYaw: number) {
    const w = this.world
    if (!w) return
    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) $('toast').classList.remove('show')
    }
    if (!this.paused) {
      const spec = this.player.spec
      if (this.onFoot) {
        this.character.update(dt, foot, w, camYaw)
        this.player.update(dt, IDLE, w, this.juice > 0)
      } else this.player.update(dt, input, w, this.juice > 0)
      const leak = this.active?.stage === 'dropoff' ? this.active.type.leak : 0
      const magEff = this.player.mode === 'mag' ? 0.7 : 1
      this.juice -= (spec.evap * (1 + leak) + spec.burn * this.player.lastBurn * magEff) * dt
      if (this.juice <= 0 && this.juice + dt * spec.evap > 0) this.toast(`HJ-77 depleted! Crawl to a pump or ${isTouch() ? 'tap the prompt' : 'press T'} for a tow.`, 'bad')
      this.juice = Math.max(0, this.juice)
      this.updateContract(dt)
      this.offerTimer -= dt
      if (this.offerTimer <= 0 && !this.active) this.generateOffers()
      this.pityTimer = Math.max(0, this.pityTimer - dt)
      this.incomeTimer += dt
      if (this.incomeTimer >= 1) {
        this.earn((this.incomePerMin / 60) * this.incomeTimer)
        this.incomeTimer = 0
      }
      this.saveTimer += dt
      if (this.saveTimer > 10) { this.persist(); this.saveTimer = 0 }
      if (this.waypoint && Math.hypot(this.waypoint.x - this.actor.x, this.waypoint.z - this.actor.z) < 40) {
        this.toast(`Arrived at ${this.waypoint.label}`, 'good')
        this.waypoint = null
      }
      this.routeTimer -= dt
      if (this.routeTimer <= 0) {
        this.computeRoute()
        this.drawRoute()
        this.routeTimer = 0.7
      }
      this.streamTimer -= dt
      if (this.streamTimer <= 0) {
        this.streamTimer = 1.5
        void this.streamMap()
      }
    }
    w.update(dt)
    this.traffic?.update(dt, this.actor)
    this.combat?.update(
      this.paused ? 0 : dt,
      this.actor,
      (amount) => {
        this.earn(amount)
        this.toast(`Gang drone neutralized · +${money(amount)}`, 'good')
      },
      () => {
        this.juice = Math.max(0, this.juice - 2.5)
        this.toast('Hostile plasma hit · HJ-77 containment damaged', 'bad')
      },
    )
    this.updateMarkers(dt)
    this.updateHud()
    this.drawMinimap()
  }

  private updateMarkers(dt: number) {
    const t = this.target()
    this.beacon.visible = !!t
    this.arrow.visible = !!t
    if (!t) return
    const color = this.active ? (this.active.stage === 'pickup' ? 0xff2bd6 : 0xffe14d) : 0x19ffe6
    this.beacon.position.set(t.x, 0, t.z)
    this.beacon.children.forEach((c) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(color))
    this.beacon.getObjectByName('ring')!.rotation.z += dt
    ;(this.arrow.material as THREE.MeshBasicMaterial).color.setHex(color)
    const p = this.actor
    const ang = Math.atan2(t.x - p.x, t.z - p.z)
    const y = p.y + (this.onFoot || this.player.spec.kind === 'board' ? 2.6 : 3.2)
    this.arrow.position.set(p.x + Math.sin(ang) * 3, y, p.z + Math.cos(ang) * 3)
    this.arrow.lookAt(t.x, y, t.z)
  }

  private updateHud() {
    const s = this.save
    const p = this.player
    $('money').textContent = money(s.money)
    $('income').textContent = this.incomePerMin ? `+${money(this.incomePerMin)}/min passive` : 'No properties yet'
    $('vehicle-name').textContent = p.spec.name
    $('combat-status').textContent = this.combat ? `${this.combat.remaining} HOSTILES` : ''
    const foot = this.onFoot
    $('speed').textContent = String(Math.round((foot ? this.character.speed : p.groundSpeed) * 3.6))
    $('alt').textContent = `${Math.round(this.actor.y)} m`
    const mode = $('mode')
    setHtml(mode, foot ? 'ON FOOT' : p.mode === 'mag' ? 'MAG-LOCK' : 'FREE HOVER')
    mode.className = `mode ${foot ? 'foot' : p.mode}`
    $('hud').dataset.mode = foot ? 'foot' : p.mode
    const touch = isTouch()
    const pct = this.juice / p.spec.tank
    const fill = $('juice-fill')
    fill.style.width = `${pct * 100}%`
    fill.classList.toggle('low', pct < 0.2)
    $('juice-text').textContent = `${this.juice.toFixed(1)} / ${p.spec.tank} L`
    $('boost').classList.toggle('on', p.boosting)

    const turn = $('turn')
    if (p.mode === 'mag' && !foot) {
      const nt = p.nextTurn(this.world!)
      const hint = this.routeHint()
      const arrows = ['⮕', '⬆', '⬅']
      turn.style.display = nt.junction || nt.dir === 2 ? '' : 'none'
      setHtml(turn, nt.dir === 2
        ? 'Dead end: auto-reverse'
        : `Next junction <b>${arrows[nt.dir + 1]}</b>${hint !== null ? ` <span class="${hint === nt.dir ? 'ok' : 'warn'}">route ${arrows[hint + 1]}</span>` : ''}`)
    } else turn.style.display = 'none'

    const c = this.active
    const panel = $('contract')
    if (c) {
      panel.classList.add('show')
      const w = this.world!
      const tn = w.city.nodes[c.stage === 'pickup' ? c.from : c.to]
      const d = Math.hypot(tn.x - p.pos.x, tn.z - p.pos.z)
      const dist = d < 1000 ? Math.round(d / 5) * 5 + ' m' : (d / 1000).toFixed(1) + ' km'
      setHtml(panel, `<div class="row"><span class="pill ${c.type.id}">${c.type.label}</span><strong class="pay">${money(c.pay)}</strong></div>
        <div class="client">${esc(c.client)}</div>
        <div class="row"><span>${c.stage === 'pickup' ? 'PICKUP' : 'DROP-OFF'} · ${dist}</span>
        <span class="timer ${c.stage === 'dropoff' && c.remaining < 15 ? 'hot' : ''}">${c.stage === 'dropoff' ? (c.remaining > 0 ? Math.ceil(c.remaining) + 's' : 'LATE') : c.time + 's'}</span></div>`)
    } else if (this.waypoint) {
      panel.classList.add('show')
      setHtml(panel, `<div class="client">Waypoint: ${esc(this.waypoint.label)}</div><div class="muted">${touch ? 'Tap for contracts' : 'Press <kbd>J</kbd> for contracts'}</div>`)
    } else {
      panel.classList.add('show')
      setHtml(panel, `<div class="client">No active contract</div><div class="muted">${touch ? 'Tap to open the contract board' : 'Press <kbd>J</kbd> to open the contract board'}</div>`)
    }

    const { dist } = this.world!.nearestPump(p.pos.x, p.pos.z)
    const prompt = $('prompt')
    const nearRide = foot && this.character.pos.distanceTo(p.pos) < 5.5
    if (foot) {
      setHtml(prompt, nearRide ? `${touch ? 'Tap to hop on' : '<kbd>X</kbd> Hop on'} your ${p.spec.name}` : '')
      prompt.classList.toggle('show', nearRide && !this.paused)
    } else if (dist < 18 && !this.paused) {
      const need = p.spec.tank - this.juice
      setHtml(prompt, need > 0.5 ? `${touch ? '⛽ Tap to refuel' : '<kbd>F</kbd> Refuel'} ${need.toFixed(0)} L · ${money(need * JUICE_PRICE)}` : 'Tank full')
      prompt.classList.add('show')
    } else if (this.juice <= 0 && !this.paused) {
      setHtml(prompt, `${touch ? 'Tap to call' : '<kbd>T</kbd> Call'} grav-tow (${money(30 * p.spec.payMult)})`)
      prompt.classList.add('show')
    } else prompt.classList.remove('show')
  }
}

const IDLE: Input = { throttle: 0, brake: 0, steer: 0, boost: false, up: false, down: false }

const isTouch = () => document.body.classList.contains('is-touch')

function setHtml(el: HTMLElement, html: string) {
  if (el.dataset.html !== html) {
    el.dataset.html = html
    el.innerHTML = html
  }
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
