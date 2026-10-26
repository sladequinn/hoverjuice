import {Street} from './street'
import {GOODS,MASK_CATALOG,MISSIONS,cargoCount,capacity,vehiclePrice,performancePrice,exchange,streetOrderPrice} from '../shared/street'
import {Economy} from './economy'
import {COMMODITIES,neighbours} from '../shared/economy'
import {Crews} from './crews'
import {CREW_COLORS,districtBounds,districtFor} from '../shared/crews'
import {GlobalProperties} from './global-properties'
import {hg} from '../shared/properties'
import {distance,validId,validGeo,wrapLon} from '../shared/multiplayer'
import {CloudSave} from './cloud-save'
import {OnlineSession} from './online-session'
import {routeGuide} from './route-guide'
import {TrafficSound} from './traffic-sound'
import {Radio} from './radio'
import {STATIONS} from './radio-config'
import { PAINTS, UPGRADES, buildFor, tunedVehicle } from './customization'
import {GANG_INFO} from './gangs'
import {GANGS,type Gang} from './filter'
import {NavigationMap,type MapView,type MapMarker} from './navigation-map'
import { highwayLoop } from './campaign'
import { ParticlePool } from './particles'
import { HoverjuiceSpray } from './hoverjuice'
import { Multiplayer } from './multiplayer'
import { RunState } from './dynamics'
import * as THREE from 'three'
import { CITIES, VEHICLES, vehicleById } from './data'
import { worldToLatLon, fetchCity, geocode, streamerFor, type CityData, pointInPoly } from './map'
import { Player, type Input } from './vehicle'
import { MASKS, buildMask, validMask } from './character'
import { World } from './world'
import { TrafficSystem } from './traffic'
import { DealerSystem, CONTRABAND } from './dealers'


type SaveData = import('../shared/preferences').Preferences

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

function defaultSave(): SaveData {
  return {current:'board',mask:'balaclava',paint:'factory',allegiance:'SHINOBI',city:null,safehouse:null,cam:'chase'}
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
  cloud = new CloudSave(localStorage)
  online = new OnlineSession(this.cloud)
  multiplayer: Multiplayer | null = null
  crewGate=new THREE.Mesh(new THREE.TorusGeometry(14,.5,6,32),new THREE.MeshBasicMaterial({color:0x73ffcb}))
  street=new Street(localStorage,()=>{this.applyGear();const v=$('modal').dataset.view??'';if(['market','garage','masks','stash'].includes(v)&&!(document.activeElement instanceof HTMLInputElement))this.openModal(v)})
  economy=new Economy(localStorage,()=>{if(['economy','contracts'].includes($('modal').dataset.view??'')&&!(document.activeElement instanceof HTMLInputElement))this.openModal($('modal').dataset.view??'economy')})
  crews=new Crews(localStorage,()=>{if($('modal').dataset.view==='crews'&&!(document.activeElement instanceof HTMLInputElement))this.openModal('crews')})
  properties=new GlobalProperties(localStorage,()=>{const view=$('modal').dataset.view;if(view==='property'||view==='properties')this.openModal(view)})
  radio=new Radio(()=>({heat:this.run.heat,speed:this.player.groundSpeed*3.6,gang:this.world?.gangAt(this.actor.x,this.actor.z)??this.gang}))
  trafficSound=new TrafficSound()
  particles=new ParticlePool()
  spray=new HoverjuiceSpray()
  private fueling:{x:number;z:number;litres:number;limit:number}|null=null
  run = new RunState()
  private garageNode = 0
  private collisionCooldown = 0
  save = defaultSave()
  world: World | null = null
  traffic: TrafficSystem | null = null
  dealers: DealerSystem | null = null
  player: Player
  juice = 0
  scene: THREE.Scene
  paused = true
  prepareRender?:()=>Promise<void>
  loading = false
  waypoint: { x: number; z: number; label: string } | null = null
  private saveTimer = 0
  private routeTimer = 0
  private route: number[] = []
  private routeLine: THREE.Line | null = null
  private beacon: THREE.Group
  private arrow: THREE.Mesh
  private territoryLast: Gang|null=null
  private hudTimer=0
  private navigation: NavigationMap | null = null
  private fullView: MapView | null = null
  private mapCenter: {x:number;z:number}|null = null
  private dealerAnchor={x:Infinity,z:Infinity}
  private dealerWaypoint: string|null=null
  private toastTimer = 0
  private thumbs = new Map<string, string>()
  private streamTimer = 0
  private streamBusy = false
  private mapOpen = false
  private mapZoom = 2
  private glitcherCones: THREE.InstancedMesh
  private scrapeCooldown = 0
  private sprintRoad = ''
  private sprintTimer = 0
  private sprintDist = 0
  private sprintSamples: { x: number; y: number; z: number; h: number }[] = []
  private sprintBest = new Map<string, { time: number; samples: { x: number; y: number; z: number; h: number }[] }>()
  private sprintGhost: THREE.Mesh | null = null

  constructor(scene: THREE.Scene) {
    this.scene = scene
    void this.radio.load().then(()=>{if($('modal').dataset.view==='radio')this.openModal('radio')})
    scene.add(this.particles.mesh, this.spray.mesh)
    this.save.mask = validMask(this.save.mask)
    this.player = new Player(vehicleById(this.save.current), this.save.mask)
    this.juice = this.player.spec.tank
    scene.add(this.player.mesh)

    const coneGeo = new THREE.ConeGeometry(2.6, 13, 12, 1, true)
    coneGeo.rotateX(Math.PI / 2)
    coneGeo.translate(0, 0, 7.2)
    this.glitcherCones = new THREE.InstancedMesh(
      coneGeo,
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      18,
    )
    this.glitcherCones.count = 0
    this.glitcherCones.frustumCulled = false
    this.glitcherCones.visible = false
    scene.add(this.glitcherCones)

    this.beacon = new THREE.Group()
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff9d00, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    beamMat.userData.uTime = { value: 0 }
    beamMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = beamMat.userData.uTime
      shader.vertexShader = `varying vec3 vBeaconPos;\n` + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBeaconPos = position;')
      shader.fragmentShader = `uniform float uTime;\nvarying vec3 vBeaconPos;\n` + shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        float scan = 0.58 + 0.42 * sin(vBeaconPos.y * 1.6 - uTime * 12.0);
        float band = step(0.15, fract(sin(floor(vBeaconPos.y * 0.35 - uTime * 3.0) * 43758.5453)));
        gl_FragColor.a *= scan * (0.45 + 0.55 * band);
        #include <dithering_fragment>
        `,
      )
    }
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 3.2, 400, 16, 1, true),
      beamMat,
    )
    beam.position.y = 200
    beam.name = 'beam'
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.45, 8, 32), new THREE.MeshBasicMaterial({ color: 0xff9d00, wireframe: true }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.6
    ring.name = 'ring'
    this.beacon.add(beam, ring)
    this.beacon.visible = false
    scene.add(this.beacon)

    this.arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 1.1, 4),
      new THREE.MeshBasicMaterial({ color: 0xff9d00 }),
    )
    this.arrow.geometry.rotateX(Math.PI / 2)
    this.arrow.visible = false
    scene.add(this.arrow)
  }

  get actor() {
    return this.player.pos
  }

  get actorHeading() {
    return this.player.heading
  }

  get hasSave() {
    return this.save.city !== null
  }

  persist() {
    this.online.save(this.save)
  }

  applyAccountSave() {
    const parsed=this.cloud.snapshot?.payload
    this.save=parsed?{...defaultSave(),...parsed} as SaveData:defaultSave()
    this.save.current='board';this.save.mask='balaclava';this.save.paint='factory'
    void this.street.refresh()
    this.player.setSpec(this.selectedSpec());this.player.setMask(this.save.mask)
    this.juice=this.player.spec.tank
  }

  get playable(){return this.online.ready&&this.street.ready&&(!this.world||!!this.multiplayer?.connection.connected)}

  toast(msg: string, kind: 'good' | 'bad' | 'info' = 'info') {
    const t = $('toast')
    t.textContent = msg
    t.className = `toast show ${kind}`
    this.toastTimer = 3.2
  }

  // ---------- cities ----------

  async warp(name: string, lat: number, lon: number, newGame = false, friendSpawn = false) {
    if (this.loading || !this.online.ready || !this.street.ready) return
    if(this.world&&cargoCount(this.street.state)>0){this.toast('Sell or stash your cargo before changing cities. Drive to nearby markets to haul it.','info');return}
    this.settleFuel(false)
    this.loading = true
    this.paused = true
    const overlay = $('loading')
    overlay.classList.add('show')
    $('loading-city').textContent = name
    let progress=0
    const status=(text:string,value=progress)=>{progress=Math.max(progress,value);$('loading-status').textContent=text;$('loading-progress').setAttribute('aria-valuenow',String(Math.round(progress)));$('loading-fill').style.width=`${progress}%`;$('loading-percent').textContent=`${Math.round(progress)}%`;for(const el of document.querySelectorAll<HTMLElement>('[data-load-stage]'))el.classList.toggle('active',progress>=Number(el.dataset.loadStage))}
    status('Connecting to city uplink…',2)
    $('btn-load-sim').style.display='none'
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
      city = await fetchCity(name, lat, lon, status, ctrl.signal)
    } catch (e) {
      if(choice!=='cancel')this.toast('City connection failed. Choose a city to retry.','bad')
    } finally {
      $('btn-load-sim').removeEventListener('click', onSim)
      $('btn-load-cancel').removeEventListener('click', onCancel)
    }
    if (!city) {
      clearInterval(tick)
      this.paused=!this.world
      overlay.classList.remove('show')
      this.loading = false
      if(!this.world)this.openModal('couch')
      return
    }
    $('btn-load-cancel').style.display='none'
    $('btn-load-sim').style.display='none'
    $('loading-status').textContent = `Extruding ${city.buildings.length.toLocaleString()} towers…`
    await new Promise((r) => setTimeout(r, 30))

    if(!this.online.ready){clearInterval(tick);overlay.classList.remove('show');this.loading=false;return}
    if(newGame){
      this.save=defaultSave();this.run=new RunState()
      this.applyGear()
      this.juice=this.player.spec.tank
    }
    this.spray.clear()
    this.save.safehouse??={name,lat,lon}
    if(this.multiplayer){this.scene.remove(this.multiplayer.group);this.multiplayer.dispose();this.multiplayer=null}
    if (this.world) {
      if (this.traffic) {
        this.scene.remove(this.traffic.group)
        this.traffic.dispose()
        this.traffic = null
      }
      if (this.dealers) {
        this.scene.remove(this.dealers.group)
        this.dealers.dispose()
        this.dealers = null
      }
      this.scene.remove(this.world.group)
      this.world.dispose()
    }
    this.world = await World.create(city,status)
    this.spray.surfaceHeight=(x,z,reference)=>this.world!.surfaceHeightAt(x,z,reference)
    this.scene.add(this.world.group)
    this.traffic = new TrafficSystem(this.world)
    this.scene.add(this.traffic.group)
    this.dealerAnchor={x:Infinity,z:Infinity}
    this.mapCenter=null
    this.dealers = new DealerSystem(this.world)
    this.scene.add(this.dealers.group)

    const main = city.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.main && n.adj.length > 0)
    const home=this.save.safehouse
    const hx=(home.lon-lon)*111320*Math.cos(lat*Math.PI/180),hz=-(home.lat-lat)*110540
    const nearHome=!friendSpawn&&Math.hypot(hx,hz)<city.radius
    main.sort((a,b)=>Math.hypot(a.n.x-(nearHome?hx:0),a.n.z-(nearHome?hz:0))-Math.hypot(b.n.x-(nearHome?hx:0),b.n.z-(nearHome?hz:0)))
    this.garageNode = main[0]?.i ?? 0
    this.player.placeAtNode(this.world, this.garageNode)
    this.player.unsnap()
    if(friendSpawn){this.player.pos.set(0,this.world.groundHeightAt(0,0,this.player.pos.y)+1.2,0)}
    if(!city.procedural){
      const startGeo=worldToLatLon(city,this.player.pos.x,this.player.pos.z)
      this.properties.setLocation(startGeo);this.crews.setLocation(startGeo);this.economy.setLocation(startGeo);this.street.tick(this.economy.district)
      this.multiplayer=new Multiplayer(city);this.scene.add(this.multiplayer.group)
      void this.properties.activate();void this.crews.activate();void this.economy.activate()
    }else {this.properties.setLocation(null);this.crews.setLocation(null);this.economy.setLocation(null)}
    this.traffic.setActivitySites(this.dealers.dealers,this.actor)
    this.traffic.prime(this.actor)
    this.juice = Math.max(this.juice, this.player.spec.tank * 0.6)
    this.waypoint = null
    this.buildMinimap()
    this.save.city = { name, lat, lon }
    this.persist()

    status('Preparing cockpit and navigation…',88)
    this.maskThumbs()
    $<HTMLImageElement>('mask-portrait').src=this.thumbs.get(this.save.mask)!
    $('hud').classList.add('show')
    $('city-name').textContent = city.name
    $('city-tag').textContent = city.procedural ? 'SIM GRID' : `OSM · ${streamerFor(city)?.tileCount ?? 0} SECTORS`
    this.computeRoute();this.drawRoute();this.routeTimer=1.5
    this.updateHud();this.drawMinimap();this.hudTimer=.1
    this.refreshDealers()
    this.streamTimer=5
    status('Warming graphics · preparing your first drive…',94)
    try{await this.prepareRender?.();status('Ready. Stay dangerous.',100)}finally{clearInterval(tick)}
    overlay.classList.remove('show')
    this.loading = false
    this.closeModal()
    this.toast(
      city.procedural
        ? `Deployed to ${name} (simulation grid, real map data unavailable)`
        : `Deployed to ${name}. ${city.landmarks.length} landmarks are on the market.`,
      city.procedural ? 'bad' : 'good',
    )
  }

  private target() {
    return this.waypoint ? {...this.waypoint,node:-1} : null
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
    if (this.player.mode === 'mag') start = this.player.edgeB
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
    const pts=routeGuide(w,this.route)
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    this.routeLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff9d00, transparent: true, opacity: 0.9 }))
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
    if(!this.playable)return
    const w = this.world
    if (!w || this.paused) return
    const { dist } = w.nearestPump(this.player.pos.x, this.player.pos.z)
    if (dist > 18) return
    const need = this.player.spec.tank - this.juice
    if (need < 0.5) { this.toast('Tank is already full.'); return }
    if(this.fueling){this.settleFuel(false);return}
    if(!this.player.parked){this.toast('Stop at the pump to refuel','info');return}
    const pump=w.nearestPump(this.player.pos.x,this.player.pos.z).pump!
    this.fueling={x:pump.x,z:pump.z,litres:0,limit:need}
    this.toast('Fueling HJ-77. F to stop. Refueling is free.','info')
  }

  private settleFuel(_theft:boolean){
    const fuel=this.fueling;if(!fuel)return
    this.fueling=null
    this.toast(`Refueled ${fuel.litres.toFixed(1)} L`, 'good')
  }

  promptAction() {
    if(!this.playable)return
    const w = this.world
    if (!w || this.paused) return
    const ft = this.economy.target
    if (ft && this.economy.quote && !this.economy.driving && !w.city.procedural && distance(worldToLatLon(w.city, this.actor.x, this.actor.z), ft) <= 100) {
      void this.economy.start()
      return
    }
    const market = this.dealers?.nearest(this.actor.x, this.actor.z)
    if (market?.dealer && market.dist <= 22) {
      this.openModal('market')
      return
    }
    if (w.nearestPump(this.player.pos.x, this.player.pos.z).dist <= 18) this.refuel()
    else if (this.juice <= 0) this.tow()
  }

  cycleCamera() {
    this.save.cam = this.save.cam === 'chase' ? 'top' : 'chase'
    this.persist()
    this.toast(this.save.cam === 'top' ? 'Camera: TOP-DOWN' : 'Camera: CHASE', 'info')
  }

  private nearbyDealer(range = 22) {
    const nearest = this.dealers?.nearest(this.actor.x, this.actor.z)
    return nearest?.dealer && nearest.dist <= range ? nearest.dealer : null
  }

  openDealer() {
    const dealer = this.nearbyDealer()
    if (!dealer) {
      this.toast('No dealer nearby. Open the Night Market to locate one.', 'info')
      this.openModal('market')
      return
    }
    this.openModal('market')
  }

  private locateDealer(id: string) {
    const dealer = this.dealers?.dealers.find((candidate) => candidate.id === id)
    if (!dealer) return
    this.dealerWaypoint=id
    this.waypoint = { x: dealer.x, z: dealer.z, label: dealer.name }
    this.routeTimer = 0
    this.toggleMap(false)
    this.closeModal()
    this.toast(`Night Market waypoint: ${dealer.name}`, 'info')
  }

  get gang(){return this.save.allegiance}

  private bust() {
    if(!this.world)return
    this.player.placeAtNode(this.world,this.garageNode)
    this.player.unsnap()
    this.juice=Math.max(this.juice,this.player.spec.tank*0.25)
    this.run.repair()
    this.toast('Recovered at your starting garage', 'info')
  }

  toggleMap(force?: boolean) {
    if (!this.world) return
    if(this.world.isTunnel(this.actor.x,this.actor.z,this.actor.y)){this.toast('GPS unavailable inside tunnel','info');return}
    this.mapOpen = force ?? !this.mapOpen
    $('map-overlay').classList.toggle('show', this.mapOpen)
    this.paused = this.mapOpen
    if (this.mapOpen) {$('map-selection').hidden=true;this.mapCenter={x:this.actor.x,z:this.actor.z};this.drawFullMap()}
  }

  zoomMap(factor: number) {
    this.mapZoom = Math.max(0.3, Math.min(32, this.mapZoom * factor))
    this.drawFullMap()
  }

  private async streamMap() {
    const w = this.world
    const streamer = w && !w.city.procedural ? streamerFor(w.city) : undefined
    if (!w || !streamer || this.streamBusy) return
    this.streamBusy = true
    $('city-tag').classList.add('streaming')
    try {
      // Prefetch one tile ahead instead of loading a costly 3×3 square. At z14 this
      // gives roughly a kilometre of warning while keeping dense cities phone-friendly.
      const lookAhead = 850
      const delta = await streamer.loadAround(
        this.actor.x + Math.sin(this.actorHeading) * lookAhead,
        this.actor.z + Math.cos(this.actorHeading) * lookAhead,
        0,
      )
      if (delta && this.world === w) {
        await w.appendMap(delta)
        if(this.world !== w)return
        w.evictFar(this.actor.x, this.actor.z, 2500)
        this.traffic?.ensurePopulation()
        this.refreshDealers()
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

  equipMask(id:string){void this.street.command('equip-mask',id)}

  private appliedGear=''
  private applyGear(){
    if(!this.street.ready)return
    const s=this.street.state,key=JSON.stringify([s.current,s.mask,s.builds])
    this.save.current=s.current;this.save.mask=s.mask;this.save.paint=buildFor(s.builds,s.current).paint??'factory'
    if(key===this.appliedGear)return
    this.appliedGear=key
    const fuel=this.juice
    this.player.setSpec(this.selectedSpec());this.player.setMask(s.mask);this.juice=Math.min(fuel,this.player.spec.tank)
    if(this.thumbs.size)$<HTMLImageElement>('mask-portrait').src=this.thumbs.get(s.mask)!
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
    if(!this.playable)return
    const w = this.world
    if (!w || this.paused) return
    const { pump } = w.nearestPump(this.player.pos.x, this.player.pos.z)
    if (!pump) return
    this.player.placeAtNode(w, pump.node)
    this.toast('Grav-tow dropped you at the nearest HJ-77 pump. No charge.', 'info')
  }

  toggleTestFlight() {
    if(!this.playable)return
    if(!this.world)return
    this.player.testFlight=!this.player.testFlight
    if(this.player.testFlight && this.player.mode==='mag')this.player.unsnap()
    this.player.targetAlt=this.player.pos.y
    document.body.classList.toggle('test-flight',this.player.testFlight)
    this.toast(this.player.testFlight?'TEST FLIGHT ON · Space climbs · C descends · Y disables':'TEST FLIGHT OFF · Returning to street height','info')
  }

  toggleMode() {
    if(!this.playable)return
    const w = this.world
    if (!w || this.paused) return
    if (this.player.mode === 'mag') {
      const sling = this.player.unsnap()
      this.toast(sling ? 'SLINGSHOT! Launched off the conduit into FREE HOVER' : `FREE HOVER: inertia drifting, ${isTouch() ? 'BOOST' : 'Shift'} to hyper-boost`, sling ? 'good' : 'info')
    } else if (this.player.snap(w)) {
      this.toast(`MAG-LOCK engaged: conduit riding, ${isTouch() ? '◀ ▶' : 'A/D'} picks the branch`, 'info')
    } else {
      this.toast('No street conduit in range', 'bad')
    }
    this.routeTimer = 0
  }

  // ---------- garage & real estate ----------

  selectVehicle(id:string){void this.street.command('equip-vehicle',id)}
  private selectedSpec(){return tunedVehicle(this.street.state.current,this.street.state.builds)}
  paintVehicle(paint:string){void this.street.command('paint',paint)}

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

  // ---------- modals ----------

  openModal(view: string) {
    if(view==='holdings')void this.properties.loadPortfolio()
    view=({holdings:'properties'} as Record<string,string>)[view]??view
    if(view==='economy'||view==='contracts')void this.economy.activate()

    if (!this.world && view !== 'warp' && view !== 'couch' && view !== 'cloud' && view !== 'multiplayer' && view !== 'property' && view !== 'properties' && view !== 'crews' && view !== 'economy') return
    const m = $('modal')
    m.dataset.view = view
    const body = $('modal-body')
    const tabs: [string, string][] = [['contracts','Jobs'],['market','Market'],['garage','Garage'],['menu','More']]
    const activeTab=tabs.some(([id])=>id===view)?view:'menu'
    const tabBar = this.world && view !== 'win' && view !== 'couch'
      ? `<nav class="tabs" aria-label="Game sections">${tabs.map(([id, label]) => `<button class="tab ${id === activeTab ? 'on' : ''}" data-act="view" data-arg="${id}">${label}</button>`).join('')}<button class="tab-close" data-act="close" aria-label="Close">✕</button></nav>`
      : ''
    $('modal-close').style.display = tabBar || view === 'win' || !this.world ? 'none' : ''
    const card = body.parentElement!
    const scroll = view === m.dataset.lastView ? card.scrollTop : 0
    m.dataset.lastView = view
    const expanded=view===m.dataset.lastDetailsView ? [...body.querySelectorAll<HTMLDetailsElement>('details[data-fold][open]')].map(d=>d.dataset.fold) : []
    body.innerHTML = tabBar + this.renderView(view)
    for(const detail of body.querySelectorAll<HTMLDetailsElement>('details[data-fold]'))detail.open=expanded.includes(detail.dataset.fold)
    m.dataset.lastDetailsView=view
    card.scrollTop = scroll
    m.classList.add('show')
    this.paused = true
    body.querySelectorAll<HTMLElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => this.onAction(b.dataset.act!, b.dataset.arg ?? '')),
    )
    body.querySelector<HTMLInputElement>('#radio-volume')?.addEventListener('input',e=>this.radio.setVolume(Number((e.target as HTMLInputElement).value)/100))
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

  async openFriendInvite(code:string){try{await this.joinFriend(code)}catch(error){this.mpNotice=error instanceof Error?error.message:'Invite unavailable';if($('modal').dataset.view!=='cloud')this.openModal('multiplayer')}}
  private mpNotice=''
  private mpInvite=''
  async joinFriend(code:string){
    if(!validId(code))throw Error('Paste a valid invite link or code.')
    const response=await fetch('/api/multiplayer/invite?code='+code,{credentials:'same-origin'})
    if(response.status===401){sessionStorage.setItem('hoverghini.join',code);this.openModal('cloud');throw Error('Sign in first, then open the invite again.')}
    if(!response.ok)throw Error('Invite unavailable or expired.')
    const data=await response.json();if(!validGeo(data))throw Error('Invalid invite location')
    if(validId(data.raceId))localStorage.setItem('hoverghini.race',data.raceId)
    const url=new URL(location.href);url.searchParams.delete('join');history.replaceState(null,'',url)
    sessionStorage.removeItem('hoverghini.join');localStorage.setItem('hoverghini.multiplayer','on')
    $('title').classList.remove('show');await this.warp('Friend’s location',data.lat,data.lon,false,true)
  }
  private async multiplayerAction(act:string){
    try{
      const mp=this.multiplayer
      if(act==='mp-join'){const value=($('mp-code') as HTMLInputElement).value.trim();let code=value;try{code=new URL(value).searchParams.get('join')??value}catch{}await this.joinFriend(code);return}
      if(act==='mp-enable')mp?.reconnect()
      if(act==='mp-name'){
        const res=await fetch('/api/multiplayer/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:($('mp-name') as HTMLInputElement).value})})
        if(!res.ok)throw Error('Sign in and use 2–20 letters, numbers, spaces, dots, dashes or underscores.')
        mp?.reconnect();this.mpNotice='Name saved.'
      }
      if(act==='mp-invite'){
        const res=await fetch('/api/multiplayer/invite',{method:'POST'})
        if(!res.ok)throw Error('Connect and drive into the city before creating an invite.')
        const data=await res.json();this.mpInvite=data.url;this.mpNotice='Copy the invite below. It expires in three hours.'
      }
      if(act==='mp-create'&&mp&&this.world){
        const world=this.world,here=worldToLatLon(world.city,this.player.pos.x,this.player.pos.z)
        const loop=highwayLoop(world,this.player.edgeA)
        const course=[here]
        for(const i of loop){const n=world.city.nodes[i],p=worldToLatLon(world.city,n.x,n.z);if(distance(p,course.at(-1)!)>=60)course.push(p)}
        if(distance(here,course.at(-1)!)>=60)course.push(here)
        if(!mp.connection.send({type:'race-create',course}))throw Error('Connect before creating a race.')
        this.mpNotice='Race requested. Refresh to see the lobby, then invite a friend.'
      }
      if(act==='mp-start')mp?.connection.send({type:'race-start'})
      if(act==='mp-leave')mp?.connection.send({type:'race-leave'})
    }catch(error){this.mpNotice=error instanceof Error?error.message:'Multiplayer unavailable'}
    if($('modal').dataset.view!=='cloud')this.openModal('multiplayer')
  }

  private async cloudAction(act:string) {
    if(this.cloud.busy)return
    this.cloud.busy=true
    try{
      if(act==='cloud-login'||act==='cloud-github'){
        if(this.online.ready){this.persist();await this.online.flush();if(!this.online.ready)throw Error(this.online.status)}
        location.assign(act==='cloud-github'?'/api/auth/github/login':'/api/auth/google/login');return
      }
      if(act==='cloud-link'){
        this.persist();await this.online.flush();if(!this.online.ready)throw Error(this.online.status)
        const response=await fetch('/api/auth/google/link',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
        const data=await response.json();if(!response.ok)throw Error(data.error??'Linking unavailable')
        location.assign(data.url);return
      }
      if(act==='cloud-refresh'){await this.online.heartbeat();return}
      await this.online.logout(act==='cloud-logout-all');location.reload()
    }catch(error){this.cloud.status=error instanceof Error?error.message:'Account unavailable'}
    finally{this.cloud.busy=false;if($('modal').dataset.view==='cloud')this.openModal('cloud')}
  }

  private onAction(act: string, arg: string) {
    if(!this.playable&&!act.startsWith('cloud-')&&act!=='view'&&act!=='close')return
    switch (act) {
      case 'street-refresh': void this.street.refresh();break
      case 'street-retry': void this.street.retry();break
      case 'street-quote':{const [side,good,quantity]=arg.split('|');void this.street.getQuote(good,Number(quantity),side as 'buy'|'sell');break}
      case 'street-trade': void this.street.trade();break
      case 'street-command':{const [action,item='']=arg.split('|');void this.street.command(action,item);break}
      case 'street-scout':void this.street.scout();break
      case 'street-route':{try{const t=exchange(arg);if(this.world){this.waypoint={x:wrapLon(t.lon-this.world.city.lon)*111320*Math.cos(this.world.city.lat*Math.PI/180),z:(this.world.city.lat-t.lat)*110540,label:'Night Market · '+arg};this.routeTimer=0;this.closeModal()}}catch{}break}
      case 'street-waypoint':{const t=this.street.exchange;if(t&&this.world){this.waypoint={x:wrapLon(t.lon-this.world.city.lon)*111320*Math.cos(this.world.city.lat*Math.PI/180),z:(this.world.city.lat-t.lat)*110540,label:'Night Market exchange'};this.routeTimer=0;this.closeModal()}break}
      case 'courier-quote':{const [destination,mission]=arg.split('|');void this.economy.courierQuote(destination,mission).then(()=>{const t=this.economy.target;if(t&&this.world){this.waypoint={x:wrapLon(t.lon-this.world.city.lon)*111320*Math.cos(this.world.city.lat*Math.PI/180),z:(this.world.city.lat-t.lat)*110540,label:(this.economy.quote?.label??'Courier')+' pickup depot'};this.routeTimer=0;this.computeRoute();this.drawRoute();this.toast('Quote locked — follow the holo-beacon to the pickup depot','good')}});break}
      case 'freight-refresh': void this.economy.refresh();break
      case 'freight-quote': {const [destination,commodity]=arg.split('|');void this.economy.getQuote(destination,commodity,($('freight-competitive') as HTMLInputElement)?.checked??false).then(()=>{const t=this.economy.target;if(t&&this.world){this.waypoint={x:wrapLon(t.lon-this.world.city.lon)*111320*Math.cos(this.world.city.lat*Math.PI/180),z:(this.world.city.lat-t.lat)*110540,label:'Freight pickup depot'};this.routeTimer=0;this.computeRoute();this.drawRoute()}});break}
      case 'freight-start': void this.economy.start().then(()=>{if(this.economy.driving)this.closeModal()});break
      case 'freight-retry': void this.economy.retry();break
      case 'freight-resume': void this.economy.resume().then(()=>{if(this.economy.driving)this.closeModal()});break
      case 'freight-cancel': if(confirm('Cancel this shipment? Departed cargo will be lost and no payout is earned.'))void this.economy.cancel();break
      case 'freight-track': {const s=this.economy.shipments.find(s=>s.id===arg);if(s?.position&&this.world){this.waypoint={x:wrapLon(s.position.lon-this.world.city.lon)*111320*Math.cos(this.world.city.lat*Math.PI/180),z:(this.world.city.lat-s.position.lat)*110540,label:'Rival convoy · last reported position'};this.routeTimer=0;this.closeModal()}break}
      case 'freight-intercept': if(confirm('Spend 25 HG to challenge this opted-in rival shipment? No loot or cash reward is paid.'))void this.economy.intercept(arg).then(()=>{if(this.economy.driving)this.closeModal()});break
      case 'freight-waypoint': {const t=this.economy.target;if(t&&this.world){this.waypoint={x:wrapLon(t.lon-this.world.city.lon)*111320*Math.cos(this.world.city.lat*Math.PI/180),z:(this.world.city.lat-t.lat)*110540,label:'Freight depot / lane gate'};this.routeTimer=0;this.closeModal()}break}
      case 'crew-rally': {const t=this.crews.crew?.territories?.find(t=>t.id===arg);if(t)void this.warp('Crew rally '+t.id,t.lat,t.lon);break}
      case 'crew-refresh': void this.crews.refresh();break
      case 'crew-current': this.crews.current();break
      case 'crew-retry': void this.crews.retry();break
      case 'crew-create': void this.crews.command({action:'create',name:($('crew-name') as HTMLInputElement).value,tag:($('crew-tag') as HTMLInputElement).value.toUpperCase(),color:($('crew-color') as HTMLSelectElement).value});break
      case 'crew-join': void this.crews.command({action:'join',code:($('crew-code') as HTMLInputElement).value.trim()});break
      case 'crew-command': {const [action,target,value]=arg.split('|');if(['leave','kick','transfer'].includes(action)&&!confirm('Confirm crew membership change? Leaving or removal starts a one-hour rejoin cooldown.'))break;void this.crews.command({action,...(target?{target}:{}),...(value?{value}:{})});break}
      case 'crew-hq': {const p=this.properties.selected;if(p&&confirm('Establish your crew headquarters in this building? Your personal title remains yours.'))void this.crews.command({action:'hq',value:p.id});break}
      case 'crew-contest': void this.crews.contest(arg as 'open'|'join');break
      case 'crew-waypoint': {const t=this.crews.target??this.crews.crew?.headquarters;if(t&&this.world){this.waypoint={x:wrapLon(t.lon-this.world.city.lon)*111320*Math.cos(this.world.city.lat*Math.PI/180),z:(this.world.city.lat-t.lat)*110540,label:this.crews.target?'Crew delivery gate':'Crew headquarters'};this.routeTimer=0;this.closeModal()}break}
      case 'global-inspect': {const [lat,lon]=arg.split('|').map(Number);this.toggleMap(false);this.openModal('property');void this.properties.inspect({lat,lon});break}
      case 'global-item': this.toggleMap(false);this.openModal('property');void this.properties.select(arg);break
      case 'global-quote': void this.properties.requote();break
      case 'global-buy': if(confirm('Purchase this global title using your global wallet? This purchase is permanent; resale is not enabled.'))void this.properties.buy().then(()=>this.street.refresh());break
      case 'global-retry': void this.properties.retry().then(()=>this.street.refresh());break
      case 'global-refresh': void this.properties.activate().then(()=>this.properties.loadPortfolio());break
      case 'global-more': void this.properties.loadPortfolio(true);break
      case 'global-portfolio': this.openModal('properties');void this.properties.loadPortfolio();break
      case 'global-visit': {const p=this.properties.selected;if(p)void this.warp(p.name,p.lat,p.lon);break}
      case 'global-waypoint': {const p=this.properties.selected;if(p&&this.world){const point={x:wrapLon(p.lon-this.world.city.lon)*111320*Math.cos(this.world.city.lat*Math.PI/180),z:(this.world.city.lat-p.lat)*110540};this.waypoint={...point,label:p.name};this.routeTimer=0;this.closeModal()}break}
      case 'mp-invite': case 'mp-join': case 'mp-name': case 'mp-enable': case 'mp-create': case 'mp-start': case 'mp-leave': case 'mp-refresh': void this.multiplayerAction(act);break
      case 'cloud-title': $('modal').classList.remove('show');$('title').classList.add('show');break
      case 'cloud-login': case 'cloud-github': case 'cloud-link': case 'cloud-refresh': case 'cloud-logout': case 'cloud-logout-all': void this.cloudAction(act);break
      case 'join-gang':
        if(GANGS.includes(arg as Gang)){this.save.allegiance=arg as Gang;this.persist();this.openModal('gangs')}
        break
      case 'random-couch': {
        const c=CITIES[Math.floor(Math.random()*CITIES.length)]
        this.onAction('couch',`${c.lat}|${c.lon}|${c.name}`)
        break
      }
      case 'home': {
        const h=this.save.safehouse
        if(h)void this.warp(h.name,h.lat,h.lon)
        break
      }
      case 'couch':
      case 'warp': {
        const [lat, lon, ...name] = arg.split('|')
        void this.warp(name.join('|'), Number(lat), Number(lon), act==='couch')
        break
      }
      case 'radio-station': void this.radio.select(arg).then(()=>{if($('modal').dataset.view==='radio')this.openModal('radio')});break
      case 'radio-refresh': void this.radio.load().then(()=>{if($('modal').dataset.view==='radio')this.openModal('radio')});break
      case 'traffic-sound':this.trafficSound.toggle();this.openModal('help');break
      case 'radio-play': if(this.radio.playing)this.radio.pause();else void this.radio.play();break
      case 'radio-next': void this.radio.next();break
      case 'select-vehicle': this.selectVehicle(arg);break
      case 'equip-mask': this.equipMask(arg);break
      case 'paint': this.paintVehicle(arg); break
      case 'view': this.openModal(arg);if(arg==='properties')void this.properties.loadPortfolio();if(arg==='economy')void this.economy.activate().then(()=>{if(this.economy.enabled)return this.economy.refresh()});if(arg==='crews')void this.crews.activate().then(()=>{if(this.crews.enabled)return this.crews.refresh()}); break
      case 'close': this.closeModal(); break
      case 'locate-dealer': this.locateDealer(arg); break
      case 'test-flight': this.toggleTestFlight(); this.openModal('help'); break

    }
  }

  private async search(q: string) {
    const out = document.getElementById('search-results')
    if (!out || !q.trim()) return
    const action=$('modal').dataset.view==='couch'?'couch':'warp'
    out.innerHTML = '<p class="muted">Scanning the global grid…</p>'
    try {
      const res = await geocode(q)
      if(!out.isConnected)return
      out.innerHTML = res.length
        ? res
            .map(
              (r) => `<button class="city-btn" data-act="${action}" data-arg="${r.lat}|${r.lon}|${esc(r.name+', '+r.area)}">
                <strong>${esc(r.name)}</strong><span>${esc(r.area)}</span></button>`,
            )
            .join('')
        : '<p class="muted">No matches. Include the street number, street, city and country, or choose Random couch.</p>'
      out.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => this.onAction(b.dataset.act!, b.dataset.arg ?? '')))
    } catch (error) {
      out.innerHTML = `<p class="error">${esc(error instanceof Error?error.message:'Address search unavailable. Try again or choose Random couch.')}</p>`
    }
  }

  private renderView(view: string): string {
    const s = this.save
    switch (view) {
      case 'contracts':{
        const e=this.economy,curDistrict=e.district||(this.world&&!this.world.city.procedural?districtFor(worldToLatLon(this.world.city,this.actor.x,this.actor.z)):''),fromMarkets=[...new Set(e.markets.map(m=>m.district))].filter(d=>d!==curDistrict),destinations=fromMarkets.length?fromMarkets:(curDistrict?neighbours(curDistrict):[]),q=e.quote,v=e.active
        const depotDist=q&&this.world?Math.round(distance(worldToLatLon(this.world.city,this.actor.x,this.actor.z),q.route.points[0])):null
        return `<h2>Courier dispatch</h2><p role="status">${esc(e.status)}</p><p>${hg(this.street.balance)} · No upfront fee. Collect at the pickup depot and complete the route before the deadline.</p><div class="grid">${MISSIONS.map(m=>`<div class="card"><h3>${m.name}</h3><p>${m.client} · ${m.description}</p>${destinations.map(d=>`<button class="btn" data-act="courier-quote" data-arg="${d}|${m.id}" ${e.busy||v?.status==='active'?'disabled':''}>Quote delivery to ${esc(d)}</button>`).join('')}</div>`).join('')}</div>${!destinations.length?'<button class="btn" data-act="freight-refresh">Load nearby jobs</button>':''}
        ${q?`<div class="card active-card"><h3>${esc(q.label??'Freight job')}</h3><p>${hg(q.net)} payout · ${(q.route.total/1000).toFixed(1)} km${q.duration?` · ${Math.ceil(q.duration/60000)} minute deadline`:''}${depotDist!==null?` · ${depotDist<=100?'IN RANGE — READY TO COLLECT':`${depotDist} m to pickup depot (park within 100 m)`}`:''}</p><div class="row"><button class="btn" data-act="freight-waypoint">Guide to pickup</button><button class="btn buy" data-act="freight-start" ${e.busy||e.pending?'disabled':''}>Collect package</button></div></div>`:''}
        ${v?`<h3>Current delivery</h3><p>${esc(v.status)} · ${hg(v.net)} payout · ${Math.max(0,Math.ceil((v.expires_at-Date.now())/1000))} seconds remaining</p><button class="btn" data-act="freight-waypoint">Next gate</button><button class="btn" data-act="freight-resume">Resume delivery</button><button class="btn danger" data-act="freight-cancel">Abandon</button>`:''}${e.pending?'<button class="btn" data-act="freight-retry">Recover package pickup</button>':''}<button class="btn ghost" data-act="view" data-arg="economy">Freight & crew convoys</button>`
      }
      case 'market':{
        const t=this.street,q=t.quote,used=cargoCount(t.state),room=capacity(t.state)-used,disabled=t.busy||t.pending?'disabled':''
        const near=this.nearbyDealer(35),leaders=this.dealers?.dealers??[]
        return `<h2>Night Market</h2><p role="status">${esc(t.status)}</p><p>${hg(t.balance)} · Cargo ${used}/${capacity(t.state)} · ${esc(t.district)}</p>${near?`<p class="ok">Linked to ${esc(near.name)} · ${esc(near.gang)} syndicate channel (${esc(near.bio)})</p>`:''}${t.balance<8500&&!used?`<div class="card active-card"><h3>Need starting capital?</h3><p>Courier dispatch requires 0 HG upfront. Complete a delivery run to fund your first contraband buy.</p><button class="btn buy" data-act="view" data-arg="contracts">Open courier jobs</button></div>`:''}<p>Buy low, haul to another district, sell high. Stock and hourly supply shocks move prices. Quotes include the price impact of the full order. Park within 180 m of the exchange or beside a syndicate leader to trade.</p><div class="row"><button class="btn" data-act="street-waypoint">Guide to exchange</button><button class="btn" data-act="street-refresh">Refresh prices</button><button class="btn" data-act="street-scout">Compare nearby markets</button><button class="btn" data-act="view" data-arg="stash">Property stash</button></div>
        <div class="grid">${GOODS.map(g=>{const m=t.rows.find(m=>m.good===g.id),owned=t.state.cargo[g.id]??0,max=m?Array.from({length:Math.min(room,m.stock)},(_,i)=>i+1).filter(n=>streetOrderPrice(t.district,g.id,m.stock,'buy',n,m.at??Date.now())*n<=t.balance).at(-1)??0:0;return `<div class="card"><h3>${g.name}</h3><p>${owned} held · ${m?.stock??0} in stock · ${esc(m?.event??'Loading prices')}</p><p>Buy ${m?hg(m.ask):'…'} / sell ${m?hg(m.bid):'…'} per ${g.unit}</p><div class="row"><button class="btn" data-act="street-quote" data-arg="buy|${g.id}|1" ${!max?'disabled':disabled}>Buy 1</button><button class="btn" data-act="street-quote" data-arg="buy|${g.id}|${max}" ${!max?'disabled':disabled}>Buy max (${max})</button><button class="btn" data-act="street-quote" data-arg="sell|${g.id}|1" ${!owned?'disabled':disabled}>Sell 1</button><button class="btn" data-act="street-quote" data-arg="sell|${g.id}|${owned}" ${!owned?'disabled':disabled}>Sell all</button></div></div>`}).join('')}</div>
        ${t.scouts.length?`<h3>Nearby sell prices</h3><p>Compare these bids with the purchase price here. Prices and stock can change during the drive.</p><div class="grid">${t.scouts.map(d=>`<div class="card"><h3>${esc(d.district)}</h3>${GOODS.map(g=>`<p>${g.name}: ${hg(d.rows.find(m=>m.good===g.id)?.bid??0)}</p>`).join('')}<button class="btn" data-act="street-route" data-arg="${esc(d.district)}">Route to this exchange</button></div>`).join('')}</div>`:''}
        ${q?`<div class="card active-card"><h3>Confirm ${esc(q.side)}</h3><p>${q.quantity} ${esc(GOODS.find(g=>g.id===q.good)?.name??q.good)} · ${hg(q.total)} total · quote valid for 30 seconds</p><button class="btn buy" data-act="street-trade" ${disabled}>Confirm trade</button></div>`:''}${t.pending?'<button class="btn" data-act="street-retry">Recover pending transaction</button>':''}
        ${leaders.length?`<h3 class="sub">Syndicate street contacts</h3><div class="grid">${leaders.map(d=>{const distM=Math.round(Math.hypot(d.x-this.actor.x,d.z-this.actor.z)),specName=CONTRABAND.find(c=>c.id===d.specialty)?.name??d.specialty;return `<div class="card dealer-card" style="--dealer:#${d.color.toString(16).padStart(6,'0')}"><h3>${esc(d.name)} · ${esc(d.gang)}</h3><p>${esc(d.bio)}</p><p class="muted small">Specialty: ${esc(specName)} · ${distM} m away</p><button class="btn ghost" data-act="locate-dealer" data-arg="${esc(d.id)}">Locate dealer</button></div>`}).join('')}</div>`:''}`
      }
      case 'stash':return `<h2>Property stash</h2><p>${esc(this.street.status)}</p><p>Park within 120 m of an owned property to bank cargo. Your HG stays in your account wallet.</p><div class="row"><button class="btn" data-act="street-command" data-arg="stash|">Stash carried cargo</button><button class="btn" data-act="street-command" data-arg="withdraw|">Fill hold from stash</button></div>${GOODS.map(g=>`<p>${g.name}: ${this.street.state.cargo[g.id]??0} carried · ${this.street.state.vault[g.id]??0} banked</p>`).join('')}<button class="btn" data-act="global-portfolio">Your properties</button>`

      case 'economy': {
        const e=this.economy,q=e.quote,v=e.active,disabled=e.busy||e.pending?'disabled':'',destinations=[...new Set(e.markets.map(m=>m.district))].filter(d=>d!==e.district)
        return `<h2>Global freight markets</h2><p role="status">${esc(e.status)}</p><p>Wallet <strong>${hg(this.street.balance)}</strong> · Freight reserve ${hg(e.fund)}</p><div class="row"><button class="btn" data-act="freight-refresh">Refresh board</button><button class="btn ghost" data-act="view" data-arg="cloud">Sign in</button></div>${e.pending?'<button class="btn" data-act="freight-retry">Recover pending cargo load</button>':''}
        <p class="muted">Sealed consignments of fictional commodities. Prices reflect regional stock and shortages. Shipments pay from a finite reserve, up to six per day. No upfront cash is needed; fees are deducted from the payout.</p><label><input id="freight-competitive" type="checkbox"> Crew convoy: allow rival interception (optional)</label>
        <div class="grid">${COMMODITIES.map(c=>{const local=e.markets.find(m=>m.district===e.district&&m.commodity===c.id);return `<div class="card"><h3>${esc(c.name)}</h3><p>Here: ${local?hg(local.price):'Enter a real city'} / unit · ${local?.stock??0} stock${local?.pressure?` · SHORTAGE ${local.pressure}`:''}</p>${destinations.map(d=>{const m=e.markets.find(m=>m.district===d&&m.commodity===c.id)!;return `<p>${esc(d)}<br>${hg(m.price)} · ${m.price>m.previous_price?'↑':m.price<m.previous_price?'↓':'→'} · stock ${m.stock} · incoming ${m.incoming??0}${m.pressure?' · shortage '+m.pressure:''}<br><button class="btn ghost" data-act="freight-quote" data-arg="${esc(d)}|${c.id}" ${disabled}>Plan delivery</button></p>`}).join('')}</div>`}).join('')}</div>
        ${q?`<h3>Quoted freight</h3><p>${q.quantity} sealed units · payout ${hg(q.net)} after ${hg(q.fee)} service sink<br>${Math.round(q.route.total)} m · ${q.competitive?'Rival interception enabled':'Protected delivery'}<br>${Object.entries(q.benefits).filter(([,v])=>v).map(([k])=>esc(k)).join(' · ')||'Standard courier capacity'}</p><p class="muted">Go to the source waypoint within 60 seconds, or refresh the quote. Freight assist follows the server road route; use GO/BRAKE and steer into the indicated lane. Slow below 8 m/s to pass a lane gate safely. Three fast missed gates destroy cargo.</p><div class="row"><button class="btn" data-act="freight-waypoint">Guide to depot</button><button class="btn" data-act="freight-start" ${disabled}>Load cargo & drive</button></div>`:''}
        ${v?`<h3>Shipment ${esc(v.status)}</h3><p>${esc(e.progress||v.commodity)} · ${hg(v.net)} potential payout</p><div class="row"><button class="btn" data-act="freight-resume" ${disabled}>Resume online driving</button><button class="btn ghost" data-act="freight-waypoint">Next lane gate</button>${v.player_id===e.player?`<button class="btn ghost" data-act="freight-cancel">Cancel shipment</button>`:`<span>Challenge ends when this convoy settles; entry fee is nonrefundable.</span>`}</div>`:''}
        <h3>Rival convoys in this district</h3>${e.shipments.map(s=>`<div class="card"><p>${esc(s.commodity)} · crew ${esc(s.crew_id?.slice(0,8)??'')} · ${s.quantity} units</p><button class="btn ghost" data-act="freight-track" data-arg="${esc(s.id)}">Track convoy</button><button class="btn ghost" data-act="freight-intercept" data-arg="${esc(s.id)}" ${disabled}>Challenge nearby convoy · 25 HG</button></div>`).join('')||'<p class="muted">No opted-in rival convoys loaded.</p>'}<p class="muted">Interception requires rival crews, proximity within 200 m and a convoy between 25–85% of its route. Catch and match its lane for three seconds. Maximum two challenges per day; no theft payout.</p>
        <h3>Recent consignments</h3>${e.history.map(s=>`<p>${esc(s.commodity)} · ${esc(s.status)} · ${s.status==='delivered'?hg(s.net):'no payout'}</p>`).join('')||'<p>No consignments yet.</p>'}<p class="muted">An owned warehouse of at least 150 m² in the source district raises capacity from four to six units. A destination property and live crew control reduce service fees. An eligible crew HQ adds two minutes of delivery time. Buildings never change owners.</p>`
      }
      case 'crews': {
        const c=this.crews,v=c.crew,d=c.district,t=d?.contest,mine=t?.runs.find(r=>r.player===c.player),disabled=c.busy||c.pending?'disabled':''
        return `<h2>Crews & global districts</h2><p role="status">${esc(c.status)}</p><div class="row"><button class="btn" data-act="crew-refresh">Refresh</button><button class="btn ghost" data-act="view" data-arg="cloud">Account</button><button class="btn ghost" data-act="crew-current">View current district</button></div>${c.pending?'<button class="btn" data-act="crew-retry">Recover pending crew change</button>':''}
        ${v?`<h3 style="color:${esc(v.color)}">[${esc(v.tag)}] ${esc(v.name)}</h3><p>${esc(v.role)} · ${v.members.length}/16 members · ${v.reputation} reputation</p>${v.territories?.length?`<p>Controlled districts · shared rally travel</p><div class="row">${v.territories.map(t=>`<button class="btn" data-act="crew-rally" data-arg="${esc(t.id)}">Rally: ${esc(t.id)}</button>`).join('')}</div>`:''}<p>HQ: ${esc(v.headquarters?.name??'Not established')} · Select a title you own in your portfolio to establish HQ as leader or officer.</p><button class="btn" data-act="crew-waypoint">Rally at HQ / next delivery gate</button>${v.invite?`<p>Share this private crew invite with friends:</p><input aria-label="Crew invitation code" readonly value="${esc(v.invite)}" style="width:100%"><button class="btn ghost" data-act="crew-command" data-arg="invite" ${disabled}>Rotate invite (leader)</button>`:''}<div class="grid">${v.members.map(m=>`<div class="card">${esc(m.name)} · ${esc(m.role)}${v.role==='leader'&&m.id!==c.player?`<div class="row"><button class="btn ghost" data-act="crew-command" data-arg="role|${esc(m.id)}|${m.role==='officer'?'member':'officer'}" ${disabled}>${m.role==='officer'?'Demote':'Promote'}</button><button class="btn ghost" data-act="crew-command" data-arg="transfer|${esc(m.id)}" ${disabled}>Transfer leadership</button><button class="btn ghost" data-act="crew-command" data-arg="kick|${esc(m.id)}" ${disabled}>Remove</button></div>`:''}</div>`).join('')}</div><button class="btn ghost" data-act="crew-command" data-arg="leave" ${disabled}>Leave crew</button>`:`<p>Create a crew or join using a private invite. One crew per account; one-hour cooldown after leaving.</p><div class="row"><input id="crew-name" aria-label="Crew name" maxlength="24" placeholder="Crew name"><input id="crew-tag" aria-label="Crew tag" maxlength="5" placeholder="TAG"><select id="crew-color" aria-label="Crew color">${CREW_COLORS.map((color,i)=>`<option value="${color}">Color ${i+1}</option>`).join('')}</select><button class="btn" data-act="crew-create" ${disabled}>Create crew</button></div><div class="row"><input id="crew-code" aria-label="Crew invite code" placeholder="Private invite code"><button class="btn" data-act="crew-join" ${disabled}>Join crew</button></div>`}
        ${d?`<h3>${esc(d.id)}</h3><p>Control: <strong>${esc(d.name??'Unclaimed')}</strong>${d.controller?` · expires ${esc(new Date(d.expiresAt).toLocaleDateString())}`:''}</p><p class="muted">Two-driver delivery squads. Best valid time wins; a second finisher gives a 5% team bonus. Three attempts per driver, 30-second warmup, two-minute admission, ten-minute round. Follow the public road out and back below 8 m and 90 m/s. No collisions, currency stakes or property transfers.</p><div class="row"><button class="btn" data-act="crew-contest" data-arg="open" ${disabled}>Open / view contest</button><button class="btn" data-act="crew-contest" data-arg="join" ${disabled}>Join squad</button><button class="btn" data-act="crew-waypoint">Guide to next gate</button></div>${t?`<p>${t.finished?'Final result':Date.now()<t.startsAt?'Warmup':'Delivery contest active'} · ${t.runs.length}/16 drivers · ${t.finished?`Controller: ${esc(d.name??'Unclaimed')}`:`${Math.max(0,Math.ceil((t.endsAt-Date.now())/1000))} seconds remaining`}</p>${mine?`<p>Your delivery: ${mine.next}/${t.course.length} gates · ${mine.attempts}/3 attempts · ${esc(mine.invalid)}</p>`:''}<div class="grid">${t.runs.map(r=>`<div class="card">${esc(r.name)} · crew ${esc(r.crew.slice(0,8))}<br>${r.best===null?`${r.next}/${t.course.length} gates`:(r.best/1000).toFixed(2)+' seconds'}</div>`).join('')}</div>`:''}`:'<p>Enter a real-world city to discover its global district.</p>'}<p class="muted">Control lasts seven days without a successful defence. Three active districts per crew; 30-minute rest between rounds. Reputation and a shared HQ rally point are the benefits—no income or driving-stat advantage. Legacy NPC gangs remain separate.</p>`
      }
      case 'properties': {
        const p=this.properties
        return `<h2>Global property portfolio</h2><p role="status">${esc(p.status)}</p><p>Global wallet: <strong>${hg(p.balance)}</strong></p><p class="muted">These permanent titles belong to your account across every city and device. Global properties do not produce income or grant territory.</p><div class="row"><button class="btn" data-act="global-refresh" ${p.busy?'disabled':''}>Refresh account & portfolio</button><button class="btn ghost" data-act="view" data-arg="cloud">Account / sign in</button></div>${p.pending?'<button class="btn" data-act="global-retry">Recover pending purchase</button>':''}<div class="grid">${p.items.map(v=>`<div class="card"><h3>${esc(v.name)}</h3><p>${esc(v.id)} · ${esc(v.status)}<br>${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}<br>Acquired for ${hg(v.priceMinor)}</p><button class="btn" data-act="global-item" data-arg="${esc(v.id)}">Inspect title</button></div>`).join('')||'<p>No global titles loaded. Open the map and select a building to inspect it.</p>'}</div>${p.next?'<button class="btn" data-act="global-more">Load more titles</button>':''}${!this.world?'<button class="btn ghost" data-act="cloud-title">Back to title</button>':''}`
      }
      case 'property': {
        const p=this.properties,v=p.selected,q=p.quote,canBuy=v&&!v.ownerId&&v.status==='active'&&q&&q.expiresAt>Date.now()&&p.balance>=q.priceMinor&&!p.pending&&!p.busy
        return `<h2>${v?esc(v.name):'Global building inspection'}</h2><p role="status">${esc(p.status)}</p>${v?`<p>${esc(v.id)} · OSM version ${v.sourceVersion}<br>${v.lat.toFixed(5)}, ${v.lon.toFixed(5)} · ${v.area.toLocaleString()} m² · ${v.levels} estimated floor(s)</p><p><strong>${v.ownerId?`Owner: ${v.ownerId===p.playerId?'You':esc(v.ownerName||'Driver')} · ${esc(v.ownerId.slice(0,8))}`:'No registered owner'}</strong><br>Status: ${esc(v.status)}<br>Registry valuation: ${hg(v.priceMinor)}<br>Your global wallet: ${hg(p.balance)}</p><p class="muted">${v.status==='review'?'OSM geometry or identity needs reconciliation. Purchases are paused; existing titles remain protected.':v.status==='retired'?'The source building is absent from the current map snapshot. Its title and history remain preserved.':'Permanent personal title. Crew district changes never transfer this building.'}</p><div class="row">${!v.ownerId&&v.status==='active'?`<button class="btn" data-act="global-quote" ${p.busy?'disabled':''}>Refresh purchase quote</button><button class="btn buy" data-act="global-buy" ${canBuy?'':'disabled'}>Buy title · ${hg(q?.priceMinor??v.priceMinor)}</button>`:''}<button class="btn ghost" data-act="global-waypoint">Set waypoint</button>${v.ownerId===p.playerId?'<button class="btn" data-act="crew-hq">Establish crew HQ</button>':''}<button class="btn ghost" data-act="global-visit">Visit area</button></div>`:''}${p.pending?'<button class="btn" data-act="global-retry">Retry pending purchase safely</button>':''}<div class="row"><button class="btn ghost" data-act="global-portfolio">Global portfolio</button><button class="btn ghost" data-act="view" data-arg="cloud">Account / sign in</button></div><p class="muted small">Purchases use your server wallet. Map data © OpenStreetMap contributors, ODbL.</p>`
      }
      case 'multiplayer': {
        const mp=this.multiplayer,race=mp?.race
        return `<h2>Cruise with friends</h2><p role="status">${esc(mp?.status??'Choose a real-world city to cruise')} · ${mp?.count??0} nearby</p><p>${esc(this.mpNotice||mp?.notice||'Sign in to see other drivers in your area. The game pauses while reconnecting.')}</p>
        <div class="row"><button class="btn" data-act="view" data-arg="cloud">Account / sign in</button><button class="btn" data-act="mp-enable">Reconnect</button><button class="btn ghost" data-act="mp-refresh">Refresh status</button></div>
        <div class="row"><input id="mp-name" maxlength="20" placeholder="Driver name" aria-label="Driver name"><button class="btn" data-act="mp-name">Save name</button></div>
        <button class="btn" data-act="mp-invite">Create invite</button>${this.mpInvite?`<input aria-label="Invite link" readonly value="${esc(this.mpInvite)}" style="width:100%">`:''}
        <div class="row"><input id="mp-code" placeholder="Friend invite link or code" aria-label="Friend invite"><button class="btn" data-act="mp-join">Join friend</button></div>
        <h3>Casual road-loop race</h3><p class="muted">Create near a connected main-road loop. Invite friends before starting. Ghost racing: no vehicle collisions, rewards or ranked results.</p>
        ${race?`<p>${esc(race.status)} · ${race.racers.length}/8 racers</p><p>${race.racers.map(p=>`${esc(p.name)}: ${p.finished===null?`${p.checkpoint}/${race.course.length} checkpoints`:(p.finished/1000).toFixed(1)+'s'}`).join('<br>')}</p><button class="btn" data-act="mp-start">Start (host)</button><button class="btn ghost" data-act="mp-leave">Leave race</button>`:'<button class="btn" data-act="mp-create">Create road-loop race</button>'}
        ${!this.world?'<button class="btn ghost" data-act="cloud-title">Back to title</button>':''}`
      }
      case 'cloud':
        return `<h2>Your account</h2>${!this.world?'<button class="btn ghost" data-act="cloud-title">Back to title</button>':''}<p role="status">${esc(this.online.status)}</p><p>${esc(this.cloud.status)}</p>
          ${this.cloud.playerId?`<p>Driver ${esc(this.online.displayName||this.cloud.playerId.slice(0,8))}<br>Wallet: ${hg(this.street.ready?this.street.balance:this.cloud.balance)}</p><p>Progress saves automatically to this account.</p><div class="row">${!this.online.providers.includes('google')?'<button class="btn" data-act="cloud-link">Link Google to this account</button>':''}<button class="btn ghost" data-act="cloud-logout">Sign out</button><button class="btn ghost" data-act="cloud-logout-all">Sign out all devices</button></div>`:`<button class="btn" data-act="cloud-login">Continue with Google</button><details><summary>Existing GitHub player?</summary><p>Sign in once with GitHub, then link Google here to keep your player and holdings.</p><button class="btn ghost" data-act="cloud-github">Recover GitHub account</button></details>`}`
      case 'radio':
        return `<h2>Radio</h2><p class="muted">Gang frequencies, municipal dispatch, and late-night talk.</p><div class="radio-stations">${STATIONS.map(station=>`<button class="btn ${this.radio.station===station.id?'buy':''}" data-act="radio-station" data-arg="${station.id}" aria-pressed="${this.radio.station===station.id}"><strong>${station.name}</strong><small>${station.host}</small></button>`).join('')}</div><p id="radio-status" class="radio-status" aria-live="polite">${esc(this.radio.status)}</p><div class="row"><button class="btn" data-act="radio-play">Play / pause</button><button class="btn" data-act="radio-next">Next</button><button class="btn ghost" data-act="radio-station" data-arg="off">Off</button></div><button class="btn ghost" data-act="radio-refresh">Refresh stations</button><label class="radio-volume">Volume <input id="radio-volume" type="range" min="0" max="100" value="${Math.round(this.radio.volume*100)}" /></label><p class="muted small">Music and talk use the configured station playlists. Scanner chatter follows local Heat. Radio pauses when this tab is hidden.</p>`
      case 'menu':
        return `<h2>Off the clock</h2><p>${esc(s.city?.name??'City')}</p><div class="menu-links">${[['contracts','Courier jobs'],['market','Night Market'],['stash','Property stash'],['economy','Freight convoys'],['crews','Crews & districts'],['properties','Property portfolio'],['multiplayer','Cruise with friends'],['cloud','Your account'],['radio','Radio'],['masks','Masks'],['tutorial','Getting started'],['help','Controls']].map(([id,label])=>`<button class="btn ghost" data-act="view" data-arg="${id}">${label}</button>`).join('')}</div>`
      case 'tutorial':
        return `<h2>Your first freight run</h2><p>Open Jobs and choose a courier mission and destination. Follow the depot waypoint, then start the shipment near its source depot. Drive through the lane gates to earn HG.</p><p>No starting cash is required. The fee comes out of the payout. Shipments, payouts, wallet funds and property titles are recorded by the server.</p><button class="btn" data-act="view" data-arg="contracts">Open jobs</button>`
      case 'garage':{
        const t=this.street,state=t.state,b=buildFor(state.builds,state.current),disabled=t.busy||t.pending?'disabled':''
        return `<h2>Garage</h2><p>${hg(t.balance)} · ${esc(t.status)}</p><div class="grid">${VEHICLES.map(v=>`<div class="card"><h3>${esc(v.name)}</h3><p>${esc(v.tagline)}</p><p>${hg(vehiclePrice(v.id))}</p><button class="btn" data-act="street-command" data-arg="${state.vehicles.includes(v.id)?'equip-vehicle':'buy-vehicle'}|${v.id}" ${state.current===v.id||(!state.vehicles.includes(v.id)&&t.balance<vehiclePrice(v.id))?'disabled':disabled}>${state.current===v.id?'Riding':state.vehicles.includes(v.id)?'Ride this':'Buy vehicle'}</button></div>`).join('')}</div><h3>Performance upgrades</h3>${UPGRADES.map(u=>`<div class="card"><h3>${u.name} · ${b[u.id]}/3</h3><p>${u.description}</p><button class="btn" data-act="street-command" data-arg="upgrade|${u.id}" ${b[u.id]>=3||t.balance<performancePrice(state,u.id)?'disabled':disabled}>${b[u.id]>=3?'Maxed':hg(performancePrice(state,u.id))}</button></div>`).join('')}<h3>Paint</h3><div class="row"><button class="btn" data-act="paint" data-arg="factory">Factory</button>${PAINTS.map(p=>`<button class="btn" data-act="paint" data-arg="${p.id}">${p.name}</button>`).join('')}</div>${t.pending?'<button class="btn" data-act="street-retry">Recover purchase</button>':''}`
      }
      case 'masks':{
        this.maskThumbs();const t=this.street
        return `<h2>Masks</h2><p>${hg(t.balance)} · ${esc(t.status)}</p><div class="grid masks">${MASKS.map(m=>{const owned=t.state.masks.includes(m.id),price=MASK_CATALOG.find(v=>v.id===m.id)!.price;return `<div class="card"><img src="${this.thumbs.get(m.id)}" alt="${esc(m.name)}" width="96" height="96"><h3>${esc(m.name)}</h3><p>${esc(m.blurb)}</p><button class="btn" data-act="street-command" data-arg="${owned?'equip-mask':'buy-mask'}|${m.id}" ${t.busy||t.pending||t.state.mask===m.id||(!owned&&t.balance<price)?'disabled':''}>${t.state.mask===m.id?'Wearing':owned?'Wear':hg(price)}</button></div>`}).join('')}</div>`
      }
      case 'couch':
        return `<h2>Where’s your couch?</h2>
          <p class="muted">Every empire starts somewhere. Pick an address for your starting location. You’ll spawn on the nearest connected street.</p>
          <form id="search-form" class="search"><input name="q" aria-label="Safehouse address" placeholder="Street number, street, city, country" maxlength="160" required autocomplete="off" /><button class="btn">Find couch</button></form>
          <div id="search-results" class="cities" aria-live="polite"></div>
          <button class="btn buy big" data-act="random-couch">Random couch</button>
          <p class="muted small">Random chooses a starting district. Your starting location is saved to your account.</p>`
      case 'warp':
        return `<h2>${this.world ? 'City uplink' : 'Choose your district'}</h2>
          <p class="muted">Pick a city. Take the night shift. Run cargo, dodge traffic and keep enough HJ-77 in the tank to get home.</p>
          <form id="search-form" class="search"><input name="q" placeholder="Search an address, city or neighbourhood…" autocomplete="off" /><button class="btn">Search</button></form>
          <div id="search-results" class="cities"></div>
          <h3 class="sub">Deployment zones</h3>
          <div class="cities">${CITIES.map((c) => `<button class="city-btn" data-act="warp" data-arg="${c.lat}|${c.lon}|${c.name}"><strong>${c.name}</strong><span>${c.area}</span></button>`).join('')}</div>`
      case 'help':
        return `<h2>Driver controls</h2><p>W/S thrust and brake · A/D steer · E Mag-Lock · Shift boost · Space hop · V camera.</p><p>J courier jobs · N Night Market · G garage · K masks · P properties · M city · F free refuel · T free tow.</p><p>Touch: use the stick, GO / BRAKE, MAG-LOCK and BOOST. Tap a fuel prompt to refuel.</p><p>Earn HG delivering packages and trading cargo. Buy vehicles, upgrades, masks and property. Casual races have no currency rewards.</p><button class="btn" data-act="traffic-sound">Traffic sound: ${this.trafficSound.enabled?'ON':'OFF'}</button>`
    }
    return ''
  }

  // ---------- minimap ----------

  private refreshDealers(){
    this.dealerAnchor={x:this.actor.x,z:this.actor.z}
    this.dealers?.refresh(this.actor.x,this.actor.z)
    this.traffic?.setActivitySites(this.dealers?.dealers??[],this.actor)
    if(this.dealerWaypoint && this.waypoint){
      const d=this.dealers?.dealers.find(d=>d.id===this.dealerWaypoint)
      if(d&&this.waypoint.label===d.name){this.waypoint={x:d.x,z:d.z,label:d.name};this.routeTimer=0}
    }
  }

  private mapPanel(html:string){
    const panel=$('map-selection');panel.hidden=false;panel.innerHTML=html
    panel.querySelectorAll<HTMLElement>('[data-act]').forEach(el=>el.addEventListener('click',()=>this.onAction(el.dataset.act!,el.dataset.arg??'')))
  }
  private showMapBuilding(index:number,point?:{x:number;z:number}){
    const w=this.world!,b=w.city.buildings[index],ll=worldToLatLon(w.city,point?.x??b.cx,point?.z??b.cz)
    this.mapPanel(`<strong>${esc(b.name||'Building')}</strong><p>Inspect the worldwide title and server price.</p><button class="btn" data-act="global-inspect" data-arg="${ll.lat}|${ll.lon}">Inspect property</button>`)
  }

  mapPick(x:number,y:number){
    if(!this.fullView||!this.navigation||!this.world)return
    const cv=$<HTMLCanvasElement>('full-map'),dpr=cv.width/cv.clientWidth,v=this.fullView
    const m=this.mapMarkers().map(m=>{const p=this.navigation!.project(v,m.x,m.z);return {m,d:Math.hypot(p.x-x*dpr,p.y-y*dpr)}}).filter(v=>v.d<16*dpr).sort((a,b)=>a.d-b.d)[0]?.m
    if(m){
      if(m.id.startsWith('global:')){this.onAction('global-item',m.id.slice(7));return}
      if(m.id.startsWith('dealer:')){this.mapPanel(`<strong>${esc(m.label)}</strong><p>Parked gang dealer</p><button class="btn" data-act="locate-dealer" data-arg="${esc(m.id.slice(7))}">Set waypoint</button>`);return}
    }
    const p=this.navigation.unproject(v,x*dpr,y*dpr)
    const i=this.world.city.buildings.findIndex(b=>pointInPoly(p.x,p.z,b.poly))
    if(i>=0){this.showMapBuilding(i,p);return}
    this.waypoint={...p,label:m?.label??'Map waypoint'};this.dealerWaypoint=null;this.routeTimer=0;this.computeRoute();this.drawRoute()
    this.mapPanel(`<strong>${esc(this.waypoint.label)}</strong><p>Waypoint set. Close the map to drive.</p>`)
    this.drawFullMap()
  }
  panMap(dx:number,dy:number){
    if(!this.fullView||!this.mapCenter)return
    const cv=$<HTMLCanvasElement>('full-map'),dpr=cv.width/cv.clientWidth
    this.mapCenter.x-=dx*dpr/this.fullView.scale;this.mapCenter.z-=dy*dpr/this.fullView.scale
    this.drawFullMap()
  }
  centerMap(){this.mapCenter={x:this.actor.x,z:this.actor.z};$('map-selection').hidden=true;this.drawFullMap()}

  private mapMarkers():MapMarker[]{
    const w=this.world!,out:MapMarker[]=[]
    for(const s of this.economy.shipments)if(s.position)out.push({id:'convoy:'+s.id,x:wrapLon(s.position.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-s.position.lat)*110540,label:'Rival freight convoy',symbol:'F',color:'#ff8fb4'})
    const exchange=this.street.exchange;if(exchange)out.push({id:'street-exchange',x:wrapLon(exchange.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-exchange.lat)*110540,label:'Night Market exchange',symbol:'$',color:'#df8dcc'})
    const freightTarget=this.economy.target;if(freightTarget)out.push({id:'freight-gate',x:wrapLon(freightTarget.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-freightTarget.lat)*110540,label:'Freight depot / lane gate',symbol:'D',color:'#73ffcb'})
    const district=this.crews.district,contest=district?.contest,target=this.crews.target
    const mark=(p:{lat:number;lon:number},id:string,label:string,symbol:string,color:string)=>out.push({id,x:wrapLon(p.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-p.lat)*110540,label,symbol,color})
    for(const h of district?.headquarters??[])mark(h,'crew-hq:'+h.id,`[${h.tag}] HQ`,'H',h.color)
    if(target)mark(target,'crew-gate','Next crew delivery gate','D','#73ffcb')
    else if(contest&&!contest.finished)mark(contest.course[0],'crew-gate','Crew delivery start','D','#73ffcb')
    for(const p of this.properties.nearby)out.push({id:'global:'+p.id,x:wrapLon(p.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-p.lat)*110540,label:`${p.name} · ${p.ownerId===this.properties.playerId?'Your title':p.ownerName||'Owned'}`,symbol:'◆',color:p.ownerId===this.properties.playerId?'#ffe08a':'#c4b3f4'})
    for(const d of this.dealers?.dealers??[])out.push({id:`dealer:${d.id}`,x:d.x,z:d.z,label:d.name,symbol:'D',color:'#df8dcc'})
    const garage=w.city.nodes[this.garageNode];if(garage)out.push({id:'garage',x:garage.x,z:garage.z,label:'Starting garage',symbol:'H',color:'#94e4b2'})
    for(const p of w.pumps)out.push({id:`fuel:${p.x}:${p.z}`,x:p.x,z:p.z,label:'HJ-77',symbol:'F',color:'#00d8e8'})
    const race=this.multiplayer?.race,entry=race?.racers.find(p=>p.id===this.multiplayer?.id),checkpoint=entry&&race?.course[entry.checkpoint]
    if(checkpoint&&race?.status!=='finished')out.push({id:'multiplayer-checkpoint',x:wrapLon(checkpoint.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-checkpoint.lat)*110540,label:'Race checkpoint',symbol:'R',color:'#73ffcb'})
    if(this.waypoint)out.push({id:'waypoint',...this.waypoint,symbol:'W',color:'#fff280'})
    return out
  }
  private buildMinimap(){
    const city=this.world!.city;this.navigation=new NavigationMap(city)

  }

  private drawNavigation(cv:HTMLCanvasElement,full:boolean){
    if(!this.navigation||!this.world)return
    const dpr=Math.min(devicePixelRatio,2),width=Math.round(cv.clientWidth*dpr),height=Math.round(cv.clientHeight*dpr)
    if(!width||!height)return
    if(cv.width!==width||cv.height!==height){cv.width=width;cv.height=height}
    const g=cv.getContext('2d')!,center=full?(this.mapCenter??this.actor):this.actor
    const v:MapView={x:center.x,z:center.z,width,height,scale:full?Math.min(width,height)/3200*this.mapZoom:width/650}
    if(full)this.fullView=v
    this.navigation.draw(g,v,full?'full':'mini',dpr)
    if(this.crews.district&&!this.world.city.procedural){const district=this.crews.district,b=districtBounds(district.id),city=this.world.city
      g.save();g.strokeStyle=district.color??'#73ffcb';g.lineWidth=2*dpr;g.setLineDash([8*dpr,5*dpr]);g.beginPath()
      for(const [i,[lat,lon]]of [[b.south,b.west],[b.south,b.east],[b.north,b.east],[b.north,b.west]].entries()){const p=this.navigation.project(v,wrapLon(lon-city.lon)*111320*Math.cos(city.lat*Math.PI/180),(city.lat-lat)*110540);if(i)g.lineTo(p.x,p.y);else g.moveTo(p.x,p.y)}g.closePath();g.stroke();g.restore()
      if(full){g.fillStyle=district.color??'#73ffcb';g.font=`bold ${12*dpr}px sans-serif`;g.fillText(`${district.tag?'['+district.tag+']':'Unclaimed'} · ${district.id}${district.contest&&!district.contest.finished?' · CONTEST':''}`,12*dpr,48*dpr)}
    }
    if(this.route.length>1){g.strokeStyle='#ffc36a';g.lineWidth=2*dpr;g.beginPath();this.route.forEach((i,j)=>{const n=this.world!.city.nodes[i],p=this.navigation!.project(v,n.x,n.z);if(j)g.lineTo(p.x,p.y);else g.moveTo(p.x,p.y)});g.stroke()}
    for(const m of this.mapMarkers()){
      if(!full&&m.symbol==='H'&&Math.hypot(m.x-v.x,m.z-v.z)>2600)continue
      if(!full&&!['D','W','H','P','X'].includes(m.symbol)&&Math.hypot(m.x-v.x,m.z-v.z)>325)continue
      this.navigation.marker(g,v,m,dpr,full)
    }
    const p=this.navigation.project(v,this.actor.x,this.actor.z)
    g.save();g.translate(p.x,p.y);g.rotate(Math.PI-this.actorHeading);g.fillStyle='#fff';g.strokeStyle='#0a141c';g.lineWidth=2*dpr;g.beginPath();g.moveTo(0,-9*dpr);g.lineTo(6*dpr,7*dpr);g.lineTo(0,4*dpr);g.lineTo(-6*dpr,7*dpr);g.closePath();g.fill();g.stroke();g.restore()
    g.textAlign='left';g.textBaseline='top';g.font=`bold ${11*dpr}px sans-serif`;g.fillStyle='#dbe6ed';g.fillText('N ↑',8*dpr,8*dpr)
    if(full){const metres=100/ (v.scale/dpr);g.fillText(`${Math.round(metres)} m`,16*dpr,height-165*dpr);g.fillRect(16*dpr,height-145*dpr,100*dpr,2*dpr)}
  }
  private drawFullMap(){
    if(!this.mapOpen)return
    this.drawNavigation($<HTMLCanvasElement>('full-map'),true)
    $('map-coords').textContent=`${streamerFor(this.world!.city)?.tileCount??'SIM'} sectors · Drag to explore · Tap buildings / markers`
  }
  private drawMinimap(){this.drawNavigation($<HTMLCanvasElement>('minimap'),false);if(this.mapOpen)this.drawFullMap()}

  update(dt: number, input: Input) {
    const w = this.world
    if (!w) return
    if(!this.playable){
      this.economy.step(0,0,null)
      this.multiplayer?.update(0,this.player,undefined,w,0,this.save.paint==='factory'?undefined:this.save.paint)
      return
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) $('toast').classList.remove('show')
    }
    if (!this.paused) {
      const spec = this.player.spec
      if(this.fueling){
        if(input.throttle>0.1||Math.hypot(this.player.pos.x-this.fueling.x,this.player.pos.z-this.fueling.z)>18)this.settleFuel(true)
        else {const amount=Math.min(dt*4,this.fueling.limit-this.fueling.litres,this.player.spec.tank-this.juice);this.juice+=amount;this.fueling.litres+=amount;if(this.fueling.litres>=this.fueling.limit-0.01)this.settleFuel(false)}
      }
      const p=this.player
      const tunnel=w.isTunnel(p.pos.x,p.pos.z,p.pos.y)
      if(!this.economy.driving)this.run.update(dt,cargoCount(this.street.state),tunnel,w.gangAt(p.pos.x,p.pos.z)!==this.gang,this.save.mask==='balaclava')
      p.overclocking=this.run.overclock>0; p.limping=this.run.limp>=0
      if(!this.economy.driving)this.player.update(dt, input, w, this.juice > 0)
      this.collisionCooldown=Math.max(0,this.collisionCooldown-dt)
      this.scrapeCooldown=Math.max(0,this.scrapeCooldown-dt)
      if(p.impact>3 && !this.collisionCooldown) { this.run.damage(Math.min(45,p.impact*0.65),this.save.mask==='oni'); this.collisionCooldown=0.6 }
      if(p.apex) this.run.chain()
      if(p.curbScrape && this.scrapeCooldown<=0) { this.run.chain(); this.scrapeCooldown=1.2 }
      if(this.run.limp===0) this.bust()
      const garage=w.city.nodes[this.garageNode]
      if(p.groundSpeed<3 && (Math.hypot(p.pos.x-garage.x,p.pos.z-garage.z)<12)) { this.run.heat=0; if(this.run.limp>=0)this.run.repair() }
      if(tunnel) this.route=[]
      this.updateSprint(dt, w)

      const magEff = this.player.mode === 'mag' ? 0.7 : 1
      this.juice -= (spec.evap / this.run.flow + spec.burn * this.player.lastBurn * magEff) * dt
      if (this.juice <= 0 && this.juice + dt * spec.evap > 0) this.toast(`HJ-77 depleted! Crawl to a pump or ${isTouch() ? 'tap the prompt' : 'press T'} for a tow.`, 'bad')
      this.juice = Math.max(0, this.juice)
      this.saveTimer += dt
      if (this.saveTimer > 10) { this.persist(); this.saveTimer = 0 }
      if (this.waypoint && Math.hypot(this.waypoint.x - this.actor.x, this.waypoint.z - this.actor.z) < 16) {
        this.toast(`Arrived at ${this.waypoint.label}`, 'good')
        this.waypoint = null
      }
      this.routeTimer -= dt
      if (this.routeTimer <= 0) {
        this.computeRoute()
        this.drawRoute()
        this.routeTimer = 1.5
      }
      this.streamTimer -= dt
      if (this.streamTimer <= 0) {
        this.streamTimer = 1.5
        w.evictFar?.(this.actor.x, this.actor.z, 2500)
        if(Math.hypot(this.actor.x-this.dealerAnchor.x,this.actor.z-this.dealerAnchor.z)>250)this.refreshDealers()
        void this.streamMap()
      }
    }
    if(!w.city.procedural){
      const geo=worldToLatLon(w.city,this.player.pos.x,this.player.pos.z);this.properties.setLocation(geo);this.crews.setLocation(geo);this.economy.setLocation(geo);this.street.tick(this.economy.district)
      const ownedSites = this.properties.nearby
        .filter(prop => prop.ownerId && prop.ownerId === this.properties.playerId)
        .map(prop => {
          const x = wrapLon(prop.lon - w.city.lon) * 111320 * Math.cos(w.city.lat * Math.PI / 180)
          const z = (w.city.lat - prop.lat) * 110540
          const b = w.city.buildings.find(cand => Math.hypot(cand.cx - x, cand.cz - z) < 45)
          return { id: prop.id, x: b?.cx ?? x, z: b?.cz ?? z, y: (b?.base ?? w.terrainHeightAt(x, z)) + (b?.height ?? 24) }
        })
      w.syncOwnedHolograms?.(ownedSites, this.save.mask, buildMask)
    }
    const freight=this.economy.step(this.paused?-1:input.throttle,this.paused?0:input.steer,this.multiplayer?(v)=>{this.multiplayer?.connection.send(v)}:null)
    if(freight&&!w.city.procedural){const p=this.player;p.pos.x=wrapLon(freight.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180);p.pos.z=(w.city.lat-freight.lat)*110540;p.pos.y=w.groundHeightAt(p.pos.x,p.pos.z,p.pos.y)+1;p.heading=freight.yaw;p.speed=freight.speed;p.vel.set(Math.sin(p.heading)*p.speed,Math.cos(p.heading)*p.speed);p.mesh.position.copy(p.pos);p.mesh.rotation.set(0,p.heading,0)}
    const crewTarget=this.economy.target??this.crews.target
    if(crewTarget&&!w.city.procedural){const x=wrapLon(crewTarget.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z=(w.city.lat-crewTarget.lat)*110540;this.crewGate.position.set(x,w.groundHeightAt(x,z,this.player.pos.y)+2,z);this.crewGate.rotation.x=-Math.PI/2;this.crewGate.scale.setScalar(this.economy.driving ? .12 : 1);this.crewGate.visible=true;if(this.crewGate.parent!==this.scene)this.scene.add(this.crewGate)}else this.crewGate.visible=false
    this.multiplayer?.update(dt,this.player,this.spray,w,this.paused?0:dt,this.save.paint==='factory'?undefined:this.save.paint)
    w.update(this.paused?0:dt)
    this.dealers?.update(this.paused?0:dt)
    const traffic=this.traffic?.update(this.paused?0:dt,this.actor,this.player.groundSpeed,this.run.heat,this.spray)
    this.updateGlitcherCones()
    if(!this.paused&&traffic&&!this.economy.driving){
      if(traffic.horn)this.trafficSound.honk(traffic.horn.distance,traffic.horn.side,traffic.horn.freight)
      if(traffic.impact>0){this.run.damage(Math.min(30,traffic.impact*0.5),this.save.mask==='oni');if(this.player.mode==='mag' && traffic.impact>22)this.player.unsnap()}
      for(let i=0;i<traffic.nearMisses;i++)this.run.chain()
      if(traffic.boxed&&this.run.limp<0){this.run.limp=15;this.toast('BOXED IN · 15 seconds reserve power','bad')}
    }
    if(!this.paused){
      this.spray.emit(this.player,dt,this.actor,this.player.heading,this.player.groundSpeed,
        this.player.mesh.userData.halfW,this.player.mesh.userData.halfL,
        w.groundHeightAt(this.actor.x,this.actor.z,this.actor.y),this.player.boosting)
      this.spray.update(dt)
      this.particles.update(dt)
    }
    this.updateMarkers(dt)
    this.hudTimer -= dt
    if (this.hudTimer <= 0) { this.updateHud(); this.drawMinimap(); this.hudTimer = 0.1 }
  }

  private updateGlitcherCones() {
    if (this.save.mask !== 'glitcher' || !this.traffic) {
      this.glitcherCones.visible = false
      return
    }
    const cones = this.traffic.patrolCones(this.actor, this.run.heat, 18)
    this.glitcherCones.count = cones.length
    this.glitcherCones.visible = cones.length > 0
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    cones.forEach((c, i) => {
      dummy.position.set(c.x, c.y - 0.35, c.z)
      dummy.rotation.set(0, c.heading, 0)
      dummy.updateMatrix()
      this.glitcherCones.setMatrixAt(i, dummy.matrix)
      this.glitcherCones.setColorAt(i, color.setHex(c.hostile ? 0xff3b5c : 0x00f0ff))
    })
    this.glitcherCones.instanceMatrix.needsUpdate = true
    if (this.glitcherCones.instanceColor) this.glitcherCones.instanceColor.needsUpdate = true
  }

  private updateSprint(dt: number, w: World) {
    const p = this.player
    if (p.mode !== 'mag' || p.groundSpeed < 18 || !w.city.roads?.length) {
      this.sprintRoad = ''
      this.sprintTimer = 0
      this.sprintDist = 0
      this.sprintSamples.length = 0
      if (this.sprintGhost) this.sprintGhost.visible = false
      return
    }
    const road = w.city.roads.find(r => r.major && r.name && r.nodeIds?.includes(p.edgeA) && r.nodeIds?.includes(p.edgeB))
    if (!road?.name) return
    if (this.sprintRoad !== road.name) {
      this.sprintRoad = road.name
      this.sprintTimer = 0
      this.sprintDist = 0
      this.sprintSamples = []
    }
    this.sprintTimer += dt
    this.sprintDist += p.groundSpeed * dt
    this.sprintSamples.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z, h: p.heading })
    const best = this.sprintBest.get(road.name)
    if (best && best.samples.length) {
      if (!this.sprintGhost) {
        this.sprintGhost = new THREE.Mesh(
          new THREE.BoxGeometry(1.1, 0.45, 2.4),
          new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.32, wireframe: true }),
        )
        this.scene.add(this.sprintGhost)
      }
      const idx = Math.min(best.samples.length - 1, this.sprintSamples.length - 1)
      const s = best.samples[idx]
      this.sprintGhost.visible = true
      this.sprintGhost.position.set(s.x, s.y, s.z)
      this.sprintGhost.rotation.set(0, s.h, 0)
    } else if (this.sprintGhost) {
      this.sprintGhost.visible = false
    }
    if (this.sprintDist >= 400) {
      const time = this.sprintTimer
      const prev = this.sprintBest.get(road.name)
      if (!prev || time < prev.time) {
        this.sprintBest.set(road.name, { time, samples: [...this.sprintSamples] })
        this.toast(`${road.name} 400m sprint PB · ${time.toFixed(2)}s`, 'good')
      }
      this.sprintTimer = 0
      this.sprintDist = 0
      this.sprintSamples = []
    }
  }

  private updateMarkers(dt: number) {
    const t = this.target()
    this.beacon.visible = !!t
    this.arrow.visible = !!t
    if (!t) return
    const color = 0x19ffe6
    this.beacon.position.set(t.x, this.world!.groundHeightAt(t.x,t.z,this.actor.y), t.z)
    this.beacon.children.forEach((c) => {
      const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial
      mat.color.setHex(color)
      if (mat.userData?.uTime) mat.userData.uTime.value += dt
    })
    this.beacon.getObjectByName('ring')!.rotation.z += dt * 1.6
    ;(this.arrow.material as THREE.MeshBasicMaterial).color.setHex(color)
    const p = this.actor
    const ang = Math.atan2(t.x - p.x, t.z - p.z)
    const y = p.y + (this.player.spec.kind === 'board' ? 2.6 : 3.2)
    this.arrow.position.set(p.x + Math.sin(ang) * 3, y, p.z + Math.cos(ang) * 3)
    this.arrow.lookAt(t.x, y, t.z)
  }

  private updateHud() {
    const radioStatus=document.getElementById('radio-status');if(radioStatus)radioStatus.textContent=this.radio.status
    const p = this.player
    const turf=this.world!.gangAt(p.pos.x,p.pos.z)
    $('territory-status').textContent=`${turf} · ${turf===this.gang?'FRIENDLY':'RIVAL'} TURF`
    $('territory-status').style.color=GANG_INFO[turf].color
    if(this.territoryLast!==turf){if(this.territoryLast)this.toast(`${turf} territory · ${GANG_INFO[turf].leader}`,'info');this.territoryLast=turf}
    $('tutorial-tip').hidden=true
    $('money').textContent = this.street.ready ? hg(this.street.balance) : 'Wallet unavailable'
    $('income').textContent = `CARGO ${cargoCount(this.street.state)}/${capacity(this.street.state)}`
    $('vehicle-name').textContent = `${p.spec.name} · ${this.gang}`
    const delivery=this.crews.district?.contest,driver=delivery?.runs.find(r=>r.player===this.crews.player)
    $('network-status').textContent=this.economy.progress || (delivery&&!delivery.finished&&driver?`CREW DELIVERY ${driver.next}/${delivery.course.length} · ${driver.best!==null?'COMPLETE':Date.now()<delivery.startsAt?'WARMUP':driver.invalid||'FOLLOW GREEN GATES'}`:'') || this.multiplayer?.raceStatus || this.multiplayer?.status || 'CONNECTING'
    const tunnel=this.world!.isTunnel(p.pos.x,p.pos.z,p.pos.y)
    $('minimap').style.visibility=tunnel?'hidden':'visible'
    $('alt').textContent=tunnel?'GPS LOST':`${Math.round(p.pos.y)} m${p.testFlight?' · TEST FLIGHT':''}`
    document.body.classList.toggle('test-flight',p.testFlight && p.mode==='free')
    $('combat-status').textContent = `HULL ${Math.ceil(this.run.hull)}%${this.run.heat>0?' · HEAT '+this.run.heat.toFixed(1):''}${this.run.flow>1?' · FLOW '+this.run.flow.toFixed(1)+'×':''}${this.run.limp>=0?' · LIMP '+Math.ceil(this.run.limp)+'s':''}`
    $('speed').textContent = String(Math.round(p.groundSpeed * 3.6))
    const mode = $('mode')
    setHtml(mode, p.mode === 'mag' ? 'MAG-LOCK' : 'FREE HOVER')
    mode.className = `mode ${p.mode}`
    $('hud').dataset.mode = p.mode
    const lock = $('touch-mode')
    lock.setAttribute('aria-pressed', String(p.mode === 'mag'))
    lock.textContent = p.mode === 'mag' ? 'UNLOCK' : 'MAG-LOCK'
    const touch = isTouch()
    const pct = this.juice / p.spec.tank
    const fill = $('juice-fill')
    fill.style.width = `${pct * 100}%`
    fill.classList.toggle('low', pct < 0.2)
    $('juice-text').textContent = `${this.juice.toFixed(1)} / ${p.spec.tank} L`
    $('boost').classList.toggle('on', p.boosting)

    const turn = $('turn')
    if (p.mode === 'mag') {
      const nt = p.nextTurn(this.world!)
      const hint = this.routeHint()
      const arrows = ['⮕', '⬆', '⬅']
      turn.style.display = nt.junction || nt.dir === 2 ? '' : 'none'
      setHtml(turn, nt.dir === 2
        ? 'Dead end: auto-reverse'
        : `Next junction <b>${arrows[nt.dir + 1]}</b>${hint !== null ? ` <span class="${hint === nt.dir ? 'ok' : 'warn'}">route ${arrows[hint + 1]}</span>` : ''}`)
    } else turn.style.display = 'none'

    const panel = $('contract')
    panel.classList.toggle('show',!!this.waypoint)
    setHtml(panel,this.waypoint?`<div class="client">Waypoint: ${esc(this.waypoint.label)}</div>`:`<span class="muted">FREIGHT</span> · ${touch?'Tap for work':'<kbd>J</kbd> Find a shipment'}`)

    const { dist } = this.world!.nearestPump(p.pos.x, p.pos.z)
    const prompt = $('prompt')
    const market = this.dealers?.nearest(this.actor.x, this.actor.z)
    const ft = this.economy.target
    const atDepot = !!(ft && this.economy.quote && !this.economy.driving && !this.world!.city.procedural && distance(worldToLatLon(this.world!.city, this.actor.x, this.actor.z), ft) <= 100)
    if (atDepot && !this.paused) {
      setHtml(prompt, `${touch ? 'Tap to collect' : '<kbd>R</kbd> Collect'} ${esc(this.economy.quote?.label ?? 'package')} · ${hg(this.economy.quote?.net ?? 0)}`)
      prompt.classList.add('show')
    } else if (market?.dealer && market.dist < 22 && !this.paused) {
      setHtml(prompt, `${touch ? 'Tap for market' : '<kbd>R</kbd> Market'} · ${esc(market.dealer.name)} (${market.dealer.gang})`)
      prompt.classList.add('show')
    } else if (dist < 18 && !this.paused) {
      const need = p.spec.tank - this.juice
      setHtml(prompt, this.fueling ? `Fueling ${this.fueling.litres.toFixed(1)} L · F to stop` : need > 0.5 ? `${touch ? '⛽ Tap to refuel' : '<kbd>F</kbd> Refuel'} ${need.toFixed(0)} L · FREE` : 'Tank full')
      prompt.classList.add('show')
    } else if (this.juice <= 0 && !this.paused) {
      setHtml(prompt, `${touch ? 'Tap to call' : '<kbd>T</kbd> Call'} grav-tow (free)`)
      prompt.classList.add('show')
    } else prompt.classList.remove('show')
  }
}


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
