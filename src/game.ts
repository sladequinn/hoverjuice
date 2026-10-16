import {PhysicalWorld,clipBuildings} from './physical'
import {PoliceSystem} from './police'
import {StreetObjects} from './street-objects'
import {CityLife} from './city-life'
import {districtFor} from '../shared/crews'
import {Economy} from './economy'
import {COMMODITIES} from '../shared/economy'
import {Crews} from './crews'
import {CREW_COLORS,districtBounds} from '../shared/crews'
import {GlobalProperties} from './global-properties'
import {hg} from '../shared/properties'
import {distance,validId,validGeo,wrapLon} from '../shared/multiplayer'
import {CloudSave,CloudError,LOCAL_SAVE_KEY} from './cloud-save'
import {routeGuide} from './route-guide'
import {TrafficSound} from './traffic-sound'
import {Radio} from './radio'
import {STATIONS} from './radio-config'
import { PAINTS, UPGRADES, normalizeBuilds, buildFor, tunedVehicle, upgradeCost, type GarageBuilds } from './customization'
import {jobPair} from './jobs'
import {GANG_INFO} from './gangs'
import {GANGS,type Gang} from './filter'
import {tutorialActive,tutorialText,type TutorialState} from './tutorial'
import {NavigationMap,type MapView,type MapMarker} from './navigation-map'
import {residential,houseOffer,localHome,distanceToHome,type Safehouse} from './housing'
import { Campaign, highwayLoop } from './campaign'
import { ParticlePool } from './particles'
import { HoverjuiceSpray } from './hoverjuice'
import { Multiplayer } from './multiplayer'
import { OwnershipClient } from './persistence'
import { RunState } from './dynamics'
import * as THREE from 'three'
import { CITIES, CONTRACT_TYPES, JUICE_PRICE, VEHICLES, vehicleById, type ContractType } from './data'
import { worldToLatLon, fetchCity, geocode, proceduralCity, streamerFor, type CityData, pointInPoly } from './map'
import { Player, type Input } from './vehicle'
import { MASKS, buildMask, validMask } from './character'
import { World } from './world'
import { TrafficSystem } from './traffic'
import { CONTRABAND, DealerSystem } from './dealers'

const SAVE_KEY = LOCAL_SAVE_KEY

interface Holding {
  id: string
  name: string
  city: string
  cityKey: string
  building: number
  income: number
}

interface SaveData {
  builds: GarageBuilds
  tutorial: TutorialState
  allegiance: Gang
  gangRep: Record<Gang,number>
  money: number
  owned: string[]
  current: string
  holdings: Holding[]
  city: { name: string; lat: number; lon: number } | null
  homes: Safehouse[]
  safehouse: { name: string; lat: number; lon: number } | null
  deliveries: number
  earned: number
  won: boolean
  masks: string[]
  mask: string
  cam: 'chase' | 'top'
  coldOpenDone:boolean
  hull:number
  heat:number
  notoriety:number
  vaultCash: number
  vaultCargo: Record<string, number>
  contraband: Record<string, number>
}

interface Contract {
  tutorial?: boolean
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
  return {
    builds:{},
    tutorial:{stage:'ready'},
    allegiance:'SHINOBI',
    gangRep:{SHINOBI:0,LIARS:0,HYENAS:0,JESTERS:0},
    money: 150,
    owned: ['board'],
    current: 'board',
    holdings: [],
    city: null,
    safehouse: null,
    homes: [],
    deliveries: 0,
    earned: 0,
    won: false,
    masks: ['balaclava'],
    mask: 'balaclava',
    cam: 'chase',
    contraband: {}, coldOpenDone:false, hull:100,heat:0,notoriety:0,vaultCash: 0, vaultCargo: {},
  }
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) {const parsed=JSON.parse(raw);return { ...defaultSave(), ...parsed,builds:normalizeBuilds(parsed.builds),tutorial:parsed.tutorial??{stage:'skipped'},allegiance:parsed.allegiance??(parsed.mask==='liar'?'LIARS':parsed.mask==='oni'?'HYENAS':parsed.mask==='jester'?'JESTERS':'SHINOBI')} }
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
  cloud = new CloudSave(localStorage)
  multiplayer: Multiplayer | null = null
  crewGate=new THREE.Mesh(new THREE.TorusGeometry(14,.5,6,32),new THREE.MeshBasicMaterial({color:0x73ffcb}))
  economy=new Economy(localStorage,()=>{if($('modal').dataset.view==='economy'&&!(document.activeElement instanceof HTMLInputElement))this.openModal('economy')})
  crews=new Crews(localStorage,()=>{if($('modal').dataset.view==='crews'&&!(document.activeElement instanceof HTMLInputElement))this.openModal('crews')})
  properties=new GlobalProperties(localStorage,()=>{const view=$('modal').dataset.view;if(view==='property'||view==='properties')this.openModal(view)})
  ownership = new OwnershipClient()
  radio=new Radio(()=>({heat:this.run.heat,speed:this.player.groundSpeed*3.6,gang:this.world?.gangAt(this.actor.x,this.actor.z)??this.gang,police:this.police?.message??'Dispatch: no active pursuit.'}))
  trafficSound=new TrafficSound()
  particles=new ParticlePool()
  spray=new HoverjuiceSpray()
  private fueling:{x:number;z:number;litres:number;limit:number}|null=null
  private slicks:{x:number;z:number;life:number}[]=[]
  campaign:Campaign|null=null
  private introMessage=0
  run = new RunState()
  private garageNode = 0
  private collisionCooldown = 0
  save = loadSave()
  world: World | null = null
  traffic: TrafficSystem | null = null
  cityLife:CityLife|null=null
  police:PoliceSystem|null=null
  streetObjects:StreetObjects|null=null
  physical=new PhysicalWorld()
  crashPulse=0
  private physicalCooldown=0
  dealers: DealerSystem | null = null
  player: Player
  juice = 0
  scene: THREE.Scene
  paused = true
  prepareRender?:()=>Promise<void>
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
  private territoryLast: Gang|null=null
  private hudTimer=0
  private homeBuildings=new Map<string,number>()
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
  private marketEpoch = -1

  constructor(scene: THREE.Scene) {
    this.scene = scene
    void this.radio.load().then(()=>{if($('modal').dataset.view==='radio')this.openModal('radio')})
    scene.add(this.particles.mesh, this.spray.mesh)
    this.save.mask = validMask(this.save.mask)
    this.save.masks = [...new Set(["balaclava", ...this.save.masks.map(validMask)])]
    this.player = new Player(tunedVehicle(this.save.current,this.save.builds), this.save.mask)
    this.run.hull=this.save.hull;this.run.heat=this.save.heat;this.run.notoriety=this.save.notoriety
    this.juice = this.player.spec.tank
    scene.add(this.player.mesh)

    this.beacon = new THREE.Group()
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 400, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff9d00, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    )
    beam.position.y = 200
    beam.name = 'beam'
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.5, 8, 48), new THREE.MeshBasicMaterial({ color: 0xff9d00 }))
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
    this.save.hull=this.run.hull;this.save.heat=this.run.heat;this.save.notoriety=this.run.notoriety
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

  async warp(name: string, lat: number, lon: number, newGame = false, friendSpawn = false) {
    if (this.loading) return
    this.settleFuel(false)
    this.loading = true
    this.paused = true
    const overlay = $('loading')
    overlay.classList.add('show')
    $('loading-city').textContent = name
    let progress=0
    const status=(text:string,value=progress)=>{progress=Math.max(progress,value);$('loading-status').textContent=text;$('loading-progress').setAttribute('aria-valuenow',String(Math.round(progress)));$('loading-fill').style.width=`${progress}%`;$('loading-percent').textContent=`${Math.round(progress)}%`;for(const el of document.querySelectorAll<HTMLElement>('[data-load-stage]'))el.classList.toggle('active',progress>=Number(el.dataset.loadStage))}
    status('Connecting to city uplink…',2)
    $('btn-load-sim').style.display=''
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
      if (choice !== 'cancel') {
        if (choice !== 'sim') {
          console.warn('Map fetch failed, using simulation grid', e)
          $('loading-status').textContent = 'Map servers unreachable. Compiling a simulation grid…'
          await new Promise((r) => setTimeout(r, 0))
        }
        city = proceduralCity(name, lat, lon)
      }
    } finally {
      $('btn-load-sim').removeEventListener('click', onSim)
      $('btn-load-cancel').removeEventListener('click', onCancel)
    }
    if (!city) {
      clearInterval(tick)
      this.paused=!this.world
      overlay.classList.remove('show')
      this.loading = false
      this.toast('City transfer cancelled', 'info')
      return
    }
    $('btn-load-cancel').style.display='none'
    $('btn-load-sim').style.display='none'
    $('loading-status').textContent = `Extruding ${city.buildings.length.toLocaleString()} towers…`
    await new Promise((r) => setTimeout(r, 30))

    if(newGame){
      this.save=defaultSave();this.run=new RunState()
      this.player.setSpec(vehicleById('board'));this.player.setMask('balaclava')
      this.juice=this.player.spec.tank
    }
    this.spray.clear()
    this.save.safehouse??={name,lat,lon}
    if(this.campaign){this.scene.remove(this.campaign.boss);this.campaign.dispose();this.campaign=null}
    if(this.multiplayer){this.scene.remove(this.multiplayer.group);this.multiplayer.dispose();this.multiplayer=null}
    if (this.world) {
      if(this.police){this.scene.remove(this.police.group);this.police.dispose();this.police=null}
      if(this.streetObjects){this.scene.remove(this.streetObjects.group);this.streetObjects.dispose();this.streetObjects=null}
      if(this.cityLife){this.scene.remove(this.cityLife.group);this.cityLife.dispose();this.cityLife=null}
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
    if(!city.procedural){this.multiplayer=new Multiplayer(city);this.scene.add(this.multiplayer.group);void this.properties.activate();void this.crews.activate();void this.economy.activate()}else {this.properties.setLocation(null);this.crews.setLocation(null);this.economy.setLocation(null)}
    void this.syncOwnership()
    this.traffic = new TrafficSystem(this.world)
    this.scene.add(this.traffic.group)
    this.police=new PoliceSystem(this.world);this.streetObjects=new StreetObjects(this.world);this.scene.add(this.police.group,this.streetObjects.group)
    this.cityLife=new CityLife(this.world,localStorage);this.traffic.setLife(this.cityLife);this.scene.add(this.cityLife.group)
    this.dealerAnchor={x:Infinity,z:Infinity}
    this.mapCenter=null
    this.dealers = new DealerSystem(this.world)
    this.scene.add(this.dealers.group)
    this.marketEpoch = this.dealers.epoch
    this.refreshOwned()

    const main = city.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.main && n.adj.length > 0)
    const home=this.save.safehouse
    const hx=(home.lon-lon)*111320*Math.cos(lat*Math.PI/180),hz=-(home.lat-lat)*110540
    const nearHome=!friendSpawn&&Math.hypot(hx,hz)<city.radius
    main.sort((a,b)=>Math.hypot(a.n.x-(nearHome?hx:0),a.n.z-(nearHome?hz:0))-Math.hypot(b.n.x-(nearHome?hx:0),b.n.z-(nearHome?hz:0)))
    this.garageNode = main[0]?.i ?? 0
    this.player.placeAtNode(this.world, this.garageNode)
    this.player.unsnap()
    if(friendSpawn){this.player.pos.set(0,this.world.groundHeightAt(0,0,this.player.pos.y)+1.2,0)}
    this.traffic.setActivitySites(this.dealers.dealers,this.actor)
    this.traffic.prime(this.actor)
    this.campaign=new Campaign(this.world);this.scene.add(this.campaign.boss)
    if(!friendSpawn&&!this.save.coldOpenDone){this.campaign.coldOpen(this.player);this.introMessage=2;this.save.coldOpenDone=true}
    this.juice = Math.max(this.juice, this.player.spec.tank * 0.6)
    this.active = null
    this.waypoint = null
    this.offers = []
    this.generateOffers()
    this.resumeTutorial()
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

  private resumeTutorial(){
    const w=this.world,t=this.save.tutorial
    if(!w||!tutorialActive(t))return
    if(t.stage==='deal'){this.locateWhiteLie();return}
    const nodes=w.city.nodes,pool=this.mainNodes()
    const nearest=(x:number,z:number)=>pool.reduce((best,i)=>Math.hypot(nodes[i].x-x,nodes[i].z-z)<Math.hypot(nodes[best].x-x,nodes[best].z-z)?i:best,pool[0])
    if(pool.length<2)return
    let from:number,to:number
    if(t.city?.lat===w.city.lat&&t.city.lon===w.city.lon&&t.from&&t.to){from=nearest(t.from.x,t.from.z);to=nearest(t.to.x,t.to.z)}
    else {
      const starts=pool.filter(i=>{const n=nodes[i],d=Math.hypot(n.x-this.actor.x,n.z-this.actor.z);return d>70&&d<300})
      from=starts[0]??nearest(this.actor.x,this.actor.z)
      const ends=pool.filter(i=>{const n=nodes[i],d=Math.hypot(n.x-nodes[from].x,n.z-nodes[from].z);return d>=400&&d<850})
      if(!ends.length)return
      to=ends[0]
      this.save.tutorial={stage:'pickup',city:{lat:w.city.lat,lon:w.city.lon},from:{x:nodes[from].x,z:nodes[from].z},to:{x:nodes[to].x,z:nodes[to].z}}
    }
    const drop=this.save.tutorial.stage==='dropoff'
    this.active={id:this.nextId++,tutorial:true,type:CONTRACT_TYPES[0],client:'First night · Courier induction',from,to,dist:Math.hypot(nodes[from].x-nodes[to].x,nodes[from].z-nodes[to].z),pay:250,time:0,stage:drop?'dropoff':'pickup',remaining:0}
    this.routeTimer=0;this.persist()
  }
  private skipTutorial(){
    if(this.active?.tutorial)this.active=null
    this.save.tutorial={stage:'skipped'};this.persist()
  }
  private locateWhiteLie(){
    const d=this.dealers?.dealers.find(d=>d.gang==='LIARS')
    if(d)this.locateDealer(d.id)
    else this.toast('WHITE LIE needs a commercial parking spot. Explore another sector; the sample stays with you.','info')
  }
  private sellTutorialSample(){
    if(this.save.tutorial.stage!=='deal'||this.nearbyDealer()?.gang!=='LIARS'||!this.player.parked)return
    this.save.tutorial={stage:'done'};this.save.gangRep.LIARS+=2;this.earn(100);this.persist()
    this.toast('WHITE LIE: “You can drive. You can keep quiet. We’ll get along.” · +$100','good')
    this.openModal('market')
  }

  // ---------- contracts ----------

  private mainNodes() {
    const w = this.world!
    const out: number[] = []
    w.city.nodes.forEach((n, i) => n.main && n.adj.length>0 && out.push(i))
    return out
  }

  generateOffers() {
    const w = this.world
    if (!w) return
    const pool = this.mainNodes()
    if (pool.length < 2) return
    const p = this.actor
    const spec = this.player.spec
    this.offers = []
    for (let k = 0; k < 4; k++) {
      const type = k === 3 || Math.random() < 0.18 ? CONTRACT_TYPES[2] : Math.random() < 0.35 ? CONTRACT_TYPES[1] : CONTRACT_TYPES[0]
      const safePool = type.id === 'cyanade' ? pool.filter(i=>w.eligibleAt(w.city.nodes[i].x,w.city.nodes[i].z)) : pool
      const pair=jobPair(w.city.nodes,safePool,p.x,p.z,this.offers.map(o=>o.from))
      if(!pair)continue
      const {from,to,dist}=pair
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
    if(this.active?.tutorial)this.skipTutorial()
    this.active = c
    this.offers = this.offers.filter((o) => o.id !== id)
    this.waypoint = null
    this.routeTimer = 0
    this.toggleMap(false)
    this.closeModal()
    this.toast(`Contract accepted: head to the pickup for ${c.client}`, 'info')
  }

  abandon() {
    if (!this.active) return
    if(this.active.tutorial){this.skipTutorial();this.closeModal();return}
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
    if (c.stage === 'dropoff'&&!c.tutorial) c.remaining -= dt
    if (d < 16 && Math.abs(this.actor.y-(tgt.y??0)) < 30) {
      if (c.stage === 'pickup') {
        c.stage = 'dropoff'
        c.remaining = c.time
        this.routeTimer = 0
        if(c.tutorial){this.save.tutorial.stage='dropoff';this.persist();this.toast('Parcel secured. Follow X. No timer on your first run.','info')}
        else this.toast(`Package secured. ${c.time}s on the clock.`, 'info')
      } else {
        const late = c.remaining < 0
        const pay = c.tutorial?250:Math.round(late ? c.pay * 0.4 : c.pay + Math.max(0, c.remaining) * c.pay * 0.004 * this.run.flow)
        this.earn(pay)
        this.save.deliveries++
        const turf=w.gangAt(tgt.x,tgt.z);this.save.gangRep[turf]++
        if(c.tutorial){this.save.tutorial={stage:'deal'};this.locateWhiteLie()}
        this.active = null
        this.persist()
        this.toast(c.tutorial?'First delivery complete · +$250. Take the sealed sample to WHITE LIE.':late ? `Late delivery. Client docked you: +${money(pay)}` : `Delivered! +${money(pay)} (incl. speed tip)`, late ? 'bad' : 'good')
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
    this.toast('Fueling HJ-77. F to pay. Throttle to pump-and-dash.','info')
  }

  private settleFuel(theft:boolean){
    const fuel=this.fueling;if(!fuel)return
    this.fueling=null
    const cost=fuel.litres*JUICE_PRICE
    if(theft||cost>this.save.money){
      this.run.heat=Math.min(5,this.run.heat+1)
      this.slicks.push({x:this.player.pos.x,z:this.player.pos.z,life:12})
      if(this.slicks.length>16)this.slicks.shift()
      this.toast('PUMP-AND-DASH · +1 HEAT · ignited HJ-77 slick','bad')
    }else{this.save.money-=cost;this.toast(`Paid ${money(cost)} for ${fuel.litres.toFixed(1)} L`,'good')}
    this.persist()
  }

  promptAction() {
    const w = this.world
    if (!w || this.paused) return
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

  get cargoUsed() {
    return Object.values(this.save.contraband).reduce((sum, amount) => sum + amount, 0)
  }

  get cargoCapacity() {
    return { board: 8, compact: 22, truck: 70, luxury: 36, super: 24 }[this.player.spec.kind]
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

  private trade(goodId: string, quantity: number, buying: boolean) {
    const dealer = this.nearbyDealer()
    const good = CONTRABAND.find((item) => item.id === goodId)
    if (!dealer || !good || !this.dealers) return
    const quote = this.dealers.quote(dealer, good)
    if (buying) {
      const room = this.cargoCapacity - this.cargoUsed
      const amount = Math.max(0, Math.min(quantity, room, Math.floor(this.save.money / quote.ask)))
      if (!amount) {
        this.toast(room <= 0 ? 'Cargo is full. Sell something or bring a bigger ride.' : 'Not enough cash for that buy.', 'bad')
        return
      }
      this.save.money -= quote.ask * amount
      this.save.contraband[good.id] = (this.save.contraband[good.id] ?? 0) + amount
      this.toast(`Bought ${amount} ${good.unit}${amount === 1 ? '' : 's'} of ${good.name}`, 'good')
    } else {
      const amount = Math.max(0, Math.min(quantity, this.save.contraband[good.id] ?? 0))
      if (!amount) return
      this.save.contraband[good.id] -= amount
      this.earn(quote.bid * amount)
      this.toast(`Moved ${amount} ${good.unit}${amount === 1 ? '' : 's'} of ${good.name} · +${money(quote.bid * amount)}`, 'good')
    }
    this.persist()
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

  overclock() {
    if(this.paused || !(this.save.contraband.cyanade>0)) {this.toast('Carry one Cyan-ade to overclock', 'info');return}
    if(!this.run.burn()) {this.toast('Overclock unavailable: hull or coils depleted','bad');return}
    this.save.contraband.cyanade--;this.persist()
    this.toast('OVERCLOCK · 300 km/h · 15 seconds · −25 hull','info')
  }

  get gang(){return this.save.allegiance}
  get netWorth(){return this.save.money+this.save.vaultCash+this.save.owned.reduce((sum,id)=>sum+vehicleById(id).price,0)+this.save.holdings.reduce((sum,h)=>sum+h.income/0.012,0)}
  challenge(){
    if(!this.world||!this.campaign)return
    const tallest=this.world.city.buildings.reduce((a,b)=>a.height>b.height?a:b)
    if(this.netWorth<10000000||!this.save.holdings.some(h=>h.id===tallest.id)){this.toast('Pink slip locked: $10M net worth and the tallest building required','info');return}
    if(!this.campaign.challenge(this.player)){this.toast('No contiguous highway circuit loaded. Explore more sectors.','info');return}
    this.closeModal();this.toast('SCANNER CHALLENGE · three laps · winner takes the Hoverghini','info')
  }

  private bust() {
    if(!this.world)return
    this.save.contraband={}; this.active=null
    this.save.money=Math.max(0,this.save.money-250)
    this.player.placeAtNode(this.world,this.garageNode)
    this.player.unsnap()
    this.juice=Math.max(this.juice,this.player.spec.tank*0.25)
    this.run.repair();this.police?.reset();this.persist();this.resumeTutorial()
    this.toast('IMPOUNDED · cargo confiscated · $250 fee · stash untouched','bad')
  }

  stash(withdraw=false) {
    if(!this.world || !this.player.parked)return
    const p=this.player.pos,n=this.world.city.nodes[this.garageNode]
    const owned=this.save.holdings.some(h=>{const b=this.world!.city.buildings.find(b=>b.id===h.id);return b&&Math.hypot(p.x-b.cx,p.z-b.cz)<40})
    if(!owned&&!this.atOwnedHome()&&Math.hypot(p.x-n.x,p.z-n.z)>15){this.toast('Return to your garage or an owned property','info');return}
    if(withdraw){
      this.save.money+=this.save.vaultCash;this.save.vaultCash=0
      let room=this.cargoCapacity-this.cargoUsed
      for(const [id,q] of Object.entries(this.save.vaultCargo)){const take=Math.min(room,q);this.save.contraband[id]=(this.save.contraband[id]??0)+take;this.save.vaultCargo[id]-=take;room-=take}
      this.persist();this.toast('Vault withdrawal complete. Excess cargo stays banked.','good');return
    }
    this.save.vaultCash+=this.save.money;this.save.money=0
    for(const [id,q] of Object.entries(this.save.contraband)) this.save.vaultCargo[id]=(this.save.vaultCargo[id]??0)+q
    this.save.contraband={};this.run.heat=0;this.persist();this.toast('Cash and cargo banked in your stash vault','good')
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
        void this.syncOwnership()
        this.traffic?.ensurePopulation()
        this.refreshDealers()
        if(this.save.tutorial.stage==='ready')this.resumeTutorial()
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
    this.persist()
    this.maskThumbs()
    $<HTMLImageElement>('mask-portrait').src=this.thumbs.get(id)!
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
    if (!w || this.paused) return
    const fee = Math.round(30 * this.player.spec.payMult)
    const { pump } = w.nearestPump(this.player.pos.x, this.player.pos.z)
    if (!pump) return
    this.save.money = Math.max(0, this.save.money - fee)
    this.player.placeAtNode(w, pump.node)
    this.toast(`Grav-tow dropped you at the nearest HJ-77 pump (-${money(fee)})`, 'info')
  }

  toggleTestFlight() {
    if(!this.world)return
    this.player.testFlight=!this.player.testFlight
    if(this.player.testFlight && this.player.mode==='mag')this.player.unsnap()
    this.player.targetAlt=this.player.pos.y
    document.body.classList.toggle('test-flight',this.player.testFlight)
    this.toast(this.player.testFlight?'TEST FLIGHT ON · Space climbs · C descends · Y disables':'TEST FLIGHT OFF · Returning to street height','info')
  }

  toggleMode() {
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

  buyVehicle(id: string) {
    if(id==='hoverghini'){this.challenge();return}
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

  selectVehicle(id: string, showGarage=true) {
    if (!this.save.owned.includes(id)) return
    const v = tunedVehicle(id,this.save.builds)
    const ratio = this.juice / this.player.spec.tank
    this.player.setSpec(v)
    this.juice = v.tank * ratio
    this.save.current = id
    if (this.player.mode === 'free' && this.player.targetAlt > v.maxAlt) this.player.targetAlt = v.maxAlt
    this.persist()
    if(showGarage)this.openModal('garage')
  }

  customizeVehicle(kind:'paint'|'upgrade',arg:string){
    const id=this.save.current
    if(!this.save.owned.includes(id))return
    const build={...buildFor(this.save.builds,id)}
    if(kind==='paint'){
      if(arg!=='factory'&&!PAINTS.some(p=>p.id===arg))return
      build.paint=arg==='factory'?undefined:arg
    }else{
      const upgrade=UPGRADES.find(u=>u.id===arg)
      if(!upgrade)return
      const level=build[upgrade.id],cost=upgradeCost(id,level)
      if(level>=3||this.save.money<cost)return
      this.save.money-=cost;build[upgrade.id]++
    }
    this.save.builds[id]=build
    // Preserve litres: fitting a larger tank does not dispense free fuel.
    const fuel=this.juice
    this.selectVehicle(id)
    this.juice=Math.min(fuel,this.player.spec.tank)
    this.persist()
    this.openModal('garage')
  }

  buyLandmark(id: string) {
    const w = this.world
    if (!w) return
    const l = w.city.landmarks.find((x) => x.id === id)
    if (!l || this.ownership.ownership.has(id) || !w.city.buildings[l.building].eligible || this.save.holdings.some((h) => h.id === id) || this.save.money < l.price) return
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

  private ownershipBusy=false
  private async syncOwnership(){
    const w=this.world;if(!w||w.city.procedural||this.ownershipBusy)return
    this.ownershipBusy=true
    try{await this.ownership.load(w.city.buildings.map(b=>b.tile).filter((t):t is string=>Boolean(t)));if(this.world===w)this.refreshOwned()}
    finally{this.ownershipBusy=false}
  }
  private refreshOwned() {
    const w = this.world
    if (!w) return
    const claims=this.save.holdings.map(h=>({building:w.city.buildings.findIndex(b=>b.id===h.id),gang:'SHINOBI'})).filter(c=>c.building>=0)
    for(const row of this.ownership.ownership.values()){const building=w.city.buildings.findIndex(b=>b.id===row.buildingId);if(building>=0)claims.push({building,gang:row.gang})}
    w.setTurf(claims)
  }

  // ---------- modals ----------

  openModal(view: string) {
    if (!this.world && view !== 'warp' && view !== 'couch' && view !== 'cloud' && view !== 'multiplayer' && view !== 'property' && view !== 'properties' && view !== 'crews' && view !== 'economy') return
    const m = $('modal')
    m.dataset.view = view
    const body = $('modal-body')
    const tabs: [string, string][] = [['contracts','Jobs'],['garage','Garage'],['warp','City'],['menu','More']]
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
      if(act==='mp-enable'||act==='mp-disable')mp?.setEnabled(act==='mp-enable')
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
      if(act==='cloud-login'){
        this.persist();await this.cloud.prepareLogin();location.assign('/api/auth/login');return
      }else if(act==='cloud-local-restore'){
        if(!confirm('Restore the pre-cloud backup stored on this device?'))return
        this.cloud.restoreLocalBackup();location.reload();return
      }else if(act==='cloud-refresh')await this.cloud.refresh()
      else if(act==='cloud-upload'){
        if(this.cloud.snapshot?.payload&&!confirm('Replace the cloud legacy backup with this device’s progress?'))return
        this.persist();await this.cloud.upload(this.save)
      }else if(act==='cloud-retry')await this.cloud.retry()
      else if(act==='cloud-discard'){
        if(confirm('Discard the pending upload? Local progress stays. The server may already have accepted it.'))this.cloud.discardPending()
      }else if(act==='cloud-restore'){
        if(!confirm('Restore the cloud legacy backup? Current progress will be backed up on this device before reloading.'))return
        this.persist();await this.cloud.restore();location.reload();return
      }else await this.cloud.logout(act==='cloud-logout-all')
    }catch(error){
      if(error instanceof CloudError&&error.status===401){this.cloud.playerId=null;this.cloud.snapshot=null}
      this.cloud.status=error instanceof Error?error.message:'Cloud unavailable. Local progress is safe.'
    }finally{this.cloud.busy=false;if($('modal').dataset.view==='cloud')this.openModal('cloud')}
  }

  private onAction(act: string, arg: string) {
    switch (act) {
      case 'freight-refresh': void this.economy.refresh();break
      case 'freight-quote': {const [destination,commodity]=arg.split('|');void this.economy.getQuote(destination,commodity,($('freight-competitive') as HTMLInputElement)?.checked??false);break}
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
      case 'global-buy': if(confirm('Purchase this global title using your global wallet? This purchase is permanent; resale is not enabled.'))void this.properties.buy();break
      case 'global-retry': void this.properties.retry();break
      case 'global-refresh': void this.properties.activate().then(()=>this.properties.loadPortfolio());break
      case 'global-more': void this.properties.loadPortfolio(true);break
      case 'global-portfolio': this.openModal('properties');void this.properties.loadPortfolio();break
      case 'global-visit': {const p=this.properties.selected;if(p)void this.warp(p.name,p.lat,p.lon);break}
      case 'global-waypoint': {const p=this.properties.selected;if(p&&this.world){const point={x:wrapLon(p.lon-this.world.city.lon)*111320*Math.cos(this.world.city.lat*Math.PI/180),z:(this.world.city.lat-p.lat)*110540};this.waypoint={...point,label:p.name};this.routeTimer=0;this.closeModal()}break}
      case 'mp-invite': case 'mp-join': case 'mp-name': case 'mp-enable': case 'mp-disable': case 'mp-create': case 'mp-start': case 'mp-leave': case 'mp-refresh': void this.multiplayerAction(act);break
      case 'cloud-title': $('modal').classList.remove('show');$('title').classList.add('show');break
      case 'cloud-login': case 'cloud-local-restore': case 'cloud-refresh': case 'cloud-upload': case 'cloud-retry': case 'cloud-restore': case 'cloud-discard': case 'cloud-logout': case 'cloud-logout-all': void this.cloudAction(act);break
      case 'skip-tutorial': this.skipTutorial();this.closeModal();break
      case 'tutorial-dealer': this.locateWhiteLie();this.closeModal();break
      case 'tutorial-sale': this.sellTutorialSample();break
      case 'join-gang':
        if(GANGS.includes(arg as Gang)){this.save.allegiance=arg as Gang;this.persist();this.openModal('gangs')}
        break
      case 'accept': this.accept(Number(arg)); break
      case 'abandon': this.abandon(); break
      case 'refresh': this.generateOffers(); break
      case 'buy-vehicle': this.buyVehicle(arg); break
      case 'select-vehicle': this.selectVehicle(arg); break
      case 'buy-landmark': this.buyLandmark(arg); break
      case 'locate': this.locate(arg); break
      case 'buy-home': this.buyHome(Number(arg)); break
      case 'home-waypoint': {
        const h=this.save.homes.find(h=>h.id===arg)
        if(h&&this.world){const p=localHome(h,this.world.city);this.waypoint={...p,label:h.name};this.routeTimer=0;this.toggleMap(false);this.closeModal()}
        break
      }
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
        if(act==='couch' && this.hasSave && !confirm('Start a new game here? This replaces your current progress.'))return
        const [lat, lon, ...name] = arg.split('|')
        void this.warp(name.join('|'), Number(lat), Number(lon), act==='couch')
        break
      }
      case 'radio-station': void this.radio.select(arg).then(()=>{if($('modal').dataset.view==='radio')this.openModal('radio')});break
      case 'radio-refresh': void this.radio.load().then(()=>{if($('modal').dataset.view==='radio')this.openModal('radio')});break
      case 'traffic-sound':this.trafficSound.toggle();this.openModal('help');break
      case 'radio-play': if(this.radio.playing)this.radio.pause();else void this.radio.play();break
      case 'radio-next': void this.radio.next();break
      case 'paint': this.customizeVehicle('paint',arg); break
      case 'upgrade': this.customizeVehicle('upgrade',arg); break
      case 'view': this.openModal(arg);if(arg==='properties')void this.properties.loadPortfolio();if(arg==='economy')void this.economy.activate().then(()=>{if(this.economy.enabled)return this.economy.refresh()});if(arg==='crews')void this.crews.activate().then(()=>{if(this.crews.enabled)return this.crews.refresh()}); break
      case 'close': this.closeModal(); break
      case 'challenge': this.challenge(); break
      case 'stash': this.stash(); break
      case 'withdraw': this.stash(true); break
      case 'buy-mask': this.buyMask(arg); break
      case 'equip-mask': this.equipMask(arg); break
      case 'buy-good': {
        const [id, amount] = arg.split('|')
        this.trade(id, Number(amount), true)
        break
      }
      case 'sell-good': {
        const [id, amount] = arg.split('|')
        this.trade(id, Number(amount), false)
        break
      }
      case 'locate-dealer': this.locateDealer(arg); break
      case 'test-hoverghini': {
        const v=vehicleById('hoverghini')
        if(!this.save.owned.includes(v.id)){
          if(this.save.money<v.price){this.toast('Add test funds first.','bad');break}
          this.save.money-=v.price;this.save.owned.push(v.id)
        }
        this.selectVehicle(v.id,false);this.juice=v.tank;this.persist();this.openModal('help')
        this.toast('Hoverghini ready · full tank.','good');break
      }
      case 'test-flight': this.toggleTestFlight(); this.openModal('help'); break
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
    const w = this.world
    switch (view) {
      case 'economy': {
        const e=this.economy,q=e.quote,v=e.active,disabled=e.busy||e.pending?'disabled':'',destinations=[...new Set(e.markets.map(m=>m.district))].filter(d=>d!==e.district)
        return `<h2>Global freight markets</h2><p role="status">${esc(e.status)}</p><p>Global wallet <strong>${hg(e.balance)}</strong> · Freight reserve ${hg(e.fund)}</p><div class="row"><button class="btn" data-act="freight-refresh">Refresh board</button><button class="btn ghost" data-act="view" data-arg="cloud">Sign in</button></div>${e.pending?'<button class="btn" data-act="freight-retry">Recover pending cargo load</button>':''}
        <p class="muted">Sealed consignments of fictional commodities. Prices reflect regional stock and shortages. Contracts pay from a finite reserve, up to six per day; local cash and local cargo stay separate.</p><label><input id="freight-competitive" type="checkbox"> Crew convoy: allow rival interception (optional)</label>
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
        return `<h2>Global property portfolio</h2><p role="status">${esc(p.status)}</p><p>Global wallet: <strong>${hg(p.balance)}</strong></p><p class="muted">These permanent titles belong to your account across every city and device. Local cash, safehouses and rent remain separate legacy progress. Global properties do not produce income or grant territory.</p><div class="row"><button class="btn" data-act="global-refresh" ${p.busy?'disabled':''}>Refresh account & portfolio</button><button class="btn ghost" data-act="view" data-arg="cloud">Account / sign in</button></div>${p.pending?'<button class="btn" data-act="global-retry">Recover pending purchase</button>':''}<div class="grid">${p.items.map(v=>`<div class="card"><h3>${esc(v.name)}</h3><p>${esc(v.id)} · ${esc(v.status)}<br>${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}<br>Acquired for ${hg(v.priceMinor)}</p><button class="btn" data-act="global-item" data-arg="${esc(v.id)}">Inspect title</button></div>`).join('')||'<p>No global titles loaded. Open the map and select a building to inspect it.</p>'}</div>${p.next?'<button class="btn" data-act="global-more">Load more titles</button>':''}${!this.world?'<button class="btn ghost" data-act="cloud-title">Back to title</button>':''}`
      }
      case 'property': {
        const p=this.properties,v=p.selected,q=p.quote,canBuy=v&&!v.ownerId&&v.status==='active'&&q&&q.expiresAt>Date.now()&&p.balance>=q.priceMinor&&!p.pending&&!p.busy
        return `<h2>${v?esc(v.name):'Global building inspection'}</h2><p role="status">${esc(p.status)}</p>${v?`<p>${esc(v.id)} · OSM version ${v.sourceVersion}<br>${v.lat.toFixed(5)}, ${v.lon.toFixed(5)} · ${v.area.toLocaleString()} m² · ${v.levels} estimated floor(s)</p><p><strong>${v.ownerId?`Owner: ${v.ownerId===p.playerId?'You':esc(v.ownerName||'Driver')} · ${esc(v.ownerId.slice(0,8))}`:'No registered owner'}</strong><br>Status: ${esc(v.status)}<br>Registry valuation: ${hg(v.priceMinor)}<br>Your global wallet: ${hg(p.balance)}</p><p class="muted">${v.status==='review'?'OSM geometry or identity needs reconciliation. Purchases are paused; existing titles remain protected.':v.status==='retired'?'The source building is absent from the current map snapshot. Its title and history remain preserved.':'Permanent personal title. Crew district changes never transfer this building.'}</p><div class="row">${!v.ownerId&&v.status==='active'?`<button class="btn" data-act="global-quote" ${p.busy?'disabled':''}>Refresh purchase quote</button><button class="btn buy" data-act="global-buy" ${canBuy?'':'disabled'}>Buy title · ${hg(q?.priceMinor??v.priceMinor)}</button>`:''}<button class="btn ghost" data-act="global-waypoint">Set waypoint</button>${v.ownerId===p.playerId?'<button class="btn" data-act="crew-hq">Establish crew HQ</button>':''}<button class="btn ghost" data-act="global-visit">Visit area</button></div>`:''}${p.pending?'<button class="btn" data-act="global-retry">Retry pending purchase safely</button>':''}<div class="row"><button class="btn ghost" data-act="global-portfolio">Global portfolio</button><button class="btn ghost" data-act="view" data-arg="cloud">Account / sign in</button></div><p class="muted small">Global purchases use server-issued wallet funds. Local cash and test funds cannot be imported. Map data © OpenStreetMap contributors, ODbL.</p>`
      }
      case 'multiplayer': {
        const mp=this.multiplayer,race=mp?.race
        return `<h2>Cruise with friends</h2><p role="status">${esc(mp?.status??'Choose a real-world city to cruise')} · ${mp?.count??0} nearby</p><p>${esc(this.mpNotice||mp?.notice||'Sign in to see other drivers in your area. Driving stays responsive if the connection drops.')}</p>
        <div class="row"><button class="btn" data-act="view" data-arg="cloud">Account / sign in</button><button class="btn" data-act="mp-enable">Go online</button><button class="btn ghost" data-act="mp-disable">Play solo</button><button class="btn ghost" data-act="mp-refresh">Refresh status</button></div>
        <div class="row"><input id="mp-name" maxlength="20" placeholder="Driver name" aria-label="Driver name"><button class="btn" data-act="mp-name">Save name</button></div>
        <button class="btn" data-act="mp-invite">Create invite</button>${this.mpInvite?`<input aria-label="Invite link" readonly value="${esc(this.mpInvite)}" style="width:100%">`:''}
        <div class="row"><input id="mp-code" placeholder="Friend invite link or code" aria-label="Friend invite"><button class="btn" data-act="mp-join">Join friend</button></div>
        <h3>Casual road-loop race</h3><p class="muted">Create near a connected main-road loop. Invite friends before starting. Ghost racing: no vehicle collisions, rewards or ranked results.</p>
        ${race?`<p>${esc(race.status)} · ${race.racers.length}/8 racers</p><p>${race.racers.map(p=>`${esc(p.name)}: ${p.finished===null?`${p.checkpoint}/${race.course.length} checkpoints`:(p.finished/1000).toFixed(1)+'s'}`).join('<br>')}</p><button class="btn" data-act="mp-start">Start (host)</button><button class="btn ghost" data-act="mp-leave">Leave race</button>`:'<button class="btn" data-act="mp-create">Create road-loop race</button>'}
        ${!this.world?'<button class="btn ghost" data-act="cloud-title">Back to title</button>':''}`
      }
      case 'cloud':
        return `<h2>Account & cloud saves</h2>${!this.world?'<button class="btn ghost" data-act="cloud-title">Back to title</button>':''}<p>Gameplay currently uses your legacy local save. Cloud backup carries that progress between devices. Local cash, property and test rewards never become global currency.</p><p role="status">${esc(this.cloud.status)}</p>
          ${this.cloud.playerId?`<p class="muted">Player ${esc(this.cloud.playerId)}<br>Global wallet: ${(this.cloud.balance/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} HG · No gameplay rewards enabled yet.<br>Cloud backup: ${this.cloud.snapshot?.payload?esc(String(this.cloud.snapshot.payload.city&&typeof this.cloud.snapshot.payload.city==='object'?(this.cloud.snapshot.payload.city as {name:string}).name:'No city')):'None'} · revision ${this.cloud.snapshot?.revision??'unknown'}</p>`:''}
          <div class="row"><button class="btn" data-act="cloud-refresh">Check account / refresh</button><button class="btn" data-act="cloud-login">Sign in with GitHub</button></div>
          ${this.cloud.playerId?`<div class="row"><button class="btn" data-act="cloud-upload" ${!this.cloud.snapshot||this.cloud.pending?'disabled':''}>Back up this device</button><button class="btn" data-act="cloud-restore" ${!this.cloud.snapshot?.payload||this.cloud.pending?'disabled':''}>Restore cloud backup</button></div>${this.cloud.pending?'<div class="row"><button class="btn" data-act="cloud-retry">Retry interrupted upload</button><button class="btn ghost" data-act="cloud-discard">Discard pending upload</button></div>':''}<div class="row"><button class="btn ghost" data-act="cloud-logout">Sign out</button><button class="btn ghost" data-act="cloud-logout-all">Sign out all devices</button></div>`:''}
          <button class="btn ghost" data-act="cloud-local-restore">Recover pre-restore local backup</button><p class="muted small">Backups are manual. Playing offline, New Game and Reset affect this device only. Restore keeps a recovery copy on this device. Cloud accounts must be enabled on this game host.</p>`
      case 'radio':
        return `<h2>Radio</h2><p class="muted">Gang frequencies, municipal dispatch, and late-night talk.</p><div class="radio-stations">${STATIONS.map(station=>`<button class="btn ${this.radio.station===station.id?'buy':''}" data-act="radio-station" data-arg="${station.id}" aria-pressed="${this.radio.station===station.id}"><strong>${station.name}</strong><small>${station.host}</small></button>`).join('')}</div><p id="radio-status" class="radio-status" aria-live="polite">${esc(this.radio.status)}</p><div class="row"><button class="btn" data-act="radio-play">Play / pause</button><button class="btn" data-act="radio-next">Next</button><button class="btn ghost" data-act="radio-station" data-arg="off">Off</button></div><button class="btn ghost" data-act="radio-refresh">Refresh stations</button><label class="radio-volume">Volume <input id="radio-volume" type="range" min="0" max="100" value="${Math.round(this.radio.volume*100)}" /></label><p class="muted small">Music and talk use the configured station playlists. Scanner chatter follows local Heat. Radio pauses when this tab is hidden.</p>`
      case 'menu':
        return `<h2>Off the clock</h2><p class="muted">${esc(s.city?.name??'City')} · ${money(s.money)} available</p>
          <div class="menu-links">${[['economy','Global freight markets'],['crews','Crews & global districts'],['properties','Global property portfolio'],['multiplayer','Cruise with friends'],['cloud','Account & cloud saves'],['radio','Radio stations'],['market','Dealers & cargo'],['holdings','Safehouses & vaults'],['gangs','Gangs & territory'],['masks','Mask perks'],['tutorial','First-night guide'],['help','Controls & settings']].map(([id,label])=>`<button class="btn ghost" data-act="view" data-arg="${id}">${label}<span>→</span></button>`).join('')}</div>
          <details class="fold"><summary>City & account details</summary><p class="muted">Net worth ${money(this.netWorth)} · Notoriety ${this.run.notoriety}<br>Vault ${money(s.vaultCash)} · Income ${money(this.incomePerMin)}/min<br>${esc(this.multiplayer?.status??'Local save')} · ${esc($('city-tag').textContent??'')}</p></details>`

      case 'tutorial':
        return `<h2>Your first night</h2><p>${esc(tutorialText(s.tutorial))}</p><p class="muted">Deliver a legal parcel for $250, then sell a sealed sample to WHITE LIE for $100. Use the map’s P / X markers. Dealers use D. Return to a safehouse to stash cargo and clear Heat.</p>${s.tutorial.stage==='deal'?'<button class="btn buy" data-act="tutorial-dealer">Locate WHITE LIE</button>':''}${tutorialActive(s.tutorial)?'<button class="btn ghost" data-act="skip-tutorial">Skip tutorial</button>':''}`
      case 'gangs':
        return `<h2>Four gangs. One city.</h2><p class="muted">You represent ${this.gang}. Your mask keeps its own perk. Rival turf increases Heat gain while carrying contraband; the Street Balaclava reduces that penalty. Deliveries build local respect. Gang control follows mapped landuse, with stable generated districts filling unmapped areas.</p><div class="grid">${GANGS.map(g=>`<div class="card" style="border-color:${GANG_INFO[g].color}"><h3 style="color:${GANG_INFO[g].color}">${g}</h3><p>${GANG_INFO[g].leader} · ${GANG_INFO[g].district}</p><p>Respect: ${s.gangRep[g]}</p><button class="btn" data-act="join-gang" data-arg="${g}" ${this.gang===g?'disabled':''}>${this.gang===g?'Representing':'Represent '+g}</button></div>`).join('')}</div>`
      case 'contracts': {
        const active = this.active
          ? `<div class="card active-card">
              <div class="row"><span class="pill ${this.active.type.id}">${this.active.type.label}</span><strong>${money(this.active.pay)}</strong></div>
              <h3>${esc(this.active.client)}</h3><p class="muted">${this.active.type.blurb}</p>
              <p>${this.active.tutorial ? 'Training delivery · no timer' : this.active.stage === 'pickup' ? 'Heading to pickup' : `Delivering, ${Math.max(0, Math.ceil(this.active.remaining))}s left`}</p>
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
      case 'market': {
        const dealer = this.nearbyDealer()
        const inventory = CONTRABAND.map((good) => {
          const amount = s.contraband[good.id] ?? 0
          return amount ? `<li><i style="--good:#${good.color.toString(16).padStart(6, '0')}"></i><span>${esc(good.name)}</span><strong>${amount}</strong></li>` : ''
        }).join('')
        const cargo = `<div class="market-cargo">
          <div class="row"><span>CONTRABAND HOLD</span><strong>${this.cargoUsed} / ${this.cargoCapacity}</strong></div>
          <div class="bar"><i style="width:${Math.min(100, this.cargoUsed / this.cargoCapacity * 100)}%"></i></div>
          <ul>${inventory || '<li class="muted">Your hold is clean.</li>'}</ul>
        </div>`
        if (!dealer || !this.dealers) {
          const cards = this.dealers?.dealers.map((candidate) => {
            const specialty = CONTRABAND.find((good) => good.id === candidate.specialty)!
            const dist = Math.hypot(candidate.x - this.actor.x, candidate.z - this.actor.z)
            return `<div class="card dealer-card" style="--dealer:#${candidate.color.toString(16).padStart(6, '0')}">
              <div class="row"><h3>${esc(candidate.name)}</h3><span>${(dist / 1000).toFixed(1)} km</span></div>
              <p class="muted">${esc(candidate.gang)} · ${esc(candidate.bio)}<br>Known for cheap ${esc(specialty.name)}. Get within 22 m to trade.</p>
              <button class="btn ghost" data-act="locate-dealer" data-arg="${candidate.id}">Set waypoint</button>
            </div>`
          }).join('') ?? ''
          return `<h2>Night Market</h2><p class="muted">SLADE runs SHINOBI. WHITE LIE runs LIARS. FASA runs HYENAS. FRECKLES runs JESTERS. Find their parked cars to trade; prices shift with the local supply.</p>
            ${cargo}<div class="grid dealers">${cards || '<p class="muted">No eligible dealer parking in these sectors yet. Explore more of the city.</p>'}</div>`
        }
        const tutorialDeal=s.tutorial.stage==='deal'&&dealer.gang==='LIARS'?'<div class="card"><h3>WHITE LIE · First deal</h3><p>Hand over the sealed sample from your courier run.</p><button class="btn buy" data-act="tutorial-sale">Sell sealed sample · $100</button></div>':''
        const event = this.dealers.event(dealer)
        const specialty = CONTRABAND.find((good) => good.id === dealer.specialty)!
        const rows = CONTRABAND.map((good) => {
          const quote = this.dealers!.quote(dealer, good)
          const owned = s.contraband[good.id] ?? 0
          const maxBuy = Math.max(0, Math.min(this.cargoCapacity - this.cargoUsed, Math.floor(s.money / quote.ask)))
          return `<div class="market-row" style="--good:#${good.color.toString(16).padStart(6, '0')}">
            <div class="good-info"><i></i><div><strong>${esc(good.name)}</strong><small>${esc(good.blurb)}</small></div></div>
            <div class="quote ask"><small>BUY</small><strong>${money(quote.ask)}</strong></div>
            <div class="trade-buttons">
              <button data-act="buy-good" data-arg="${good.id}|1" ${maxBuy < 1 ? 'disabled' : ''}>+1</button>
              <button data-act="buy-good" data-arg="${good.id}|5" ${maxBuy < 1 ? 'disabled' : ''}>+5</button>
              <button data-act="buy-good" data-arg="${good.id}|999">MAX</button>
            </div>
            <div class="quote bid"><small>SELL</small><strong>${money(quote.bid)}</strong><span>${owned} held</span></div>
            <div class="trade-buttons sell">
              <button data-act="sell-good" data-arg="${good.id}|1" ${owned < 1 ? 'disabled' : ''}>−1</button>
              <button data-act="sell-good" data-arg="${good.id}|999" ${owned < 1 ? 'disabled' : ''}>ALL</button>
            </div>
          </div>`
        }).join('')
        return `<div class="market-head" style="--dealer:#${dealer.color.toString(16).padStart(6, '0')}">
            <div><p class="kicker">${esc(dealer.gang)} // leader & dealer</p><h2>${esc(dealer.name)}</h2><p class="muted">${esc(dealer.bio)}<br>Specialty: ${esc(specialty.name)} · new prices in ${this.dealers.timeRemaining()}s</p></div>
            <strong class="market-cash">${money(s.money)}</strong>
          </div>
          ${event ? `<div class="market-event ${event.kind}"><b>${event.kind === 'shortage' ? 'SUPPLY SHOCK' : 'STREET GLUT'}</b>${esc(event.headline)}</div>` : ''}
          ${cargo}<div class="market-table">${tutorialDeal}${rows}</div>`
      }
      case 'garage': {
        const max = { speed: 95, tank: 120, pay: 15 }
        const bar = (v: number, m: number) => `<div class="bar"><i style="width:${Math.min(100, (v / m) * 100)}%"></i></div>`
        const cards = VEHICLES.map((base) => {
          const v=tunedVehicle(base.id,s.builds)
          const owned = s.owned.includes(v.id)
          const current = s.current === v.id
          const afford = s.money >= v.price
          const btn = current
            ? '<button class="btn" disabled>Riding</button>'
            : owned
              ? `<button class="btn" data-act="select-vehicle" data-arg="${v.id}">Ride this</button>`
              : v.id==='hoverghini' ? '<button class="btn" data-act="challenge">Pink-slip challenge</button>' : `<button class="btn ${afford ? 'buy' : ''}" data-act="buy-vehicle" data-arg="${v.id}" ${afford ? '' : 'disabled'}>Buy ${money(v.price)}</button>`
          return `<div class="card vehicle ${current ? 'current' : ''} ${v.id === 'hoverghini' ? 'goal' : ''}">
            <div class="swatch" style="--c:#${v.body.toString(16).padStart(6, '0')};--g:#${v.glow.toString(16).padStart(6, '0')}"></div>
            <h3>${v.name}</h3><p class="muted">${v.tagline}</p>
            <div class="stats">
              <label>Top speed <span>${Math.round(v.maxSpeed * 3.6)} km/h</span></label>${bar(v.maxSpeed, max.speed)}
              <label>HJ-77 tank <span>${v.tank} L</span></label>${bar(v.tank, max.tank)}
              <label>Cargo pay <span>×${v.payMult}</span></label>${bar(v.payMult, max.pay)}
              <label>Evaporation <span>${v.evap.toFixed(3)} L/s</span></label>
            </div>${btn}</div>`
        }).join('')
        const build=buildFor(s.builds,s.current)
        const workshop=`<details class="fold" data-fold="paint"><summary>Paint <span>${esc(PAINTS.find(p=>p.id===build.paint)?.name??'Factory')}</span></summary><div class="paint-options"><button class="btn" data-act="paint" data-arg="factory" ${!build.paint?'disabled':''}>Factory paint</button>${PAINTS.map(p=>`<button class="btn" data-act="paint" data-arg="${p.id}" aria-pressed="${build.paint===p.id}" ${build.paint===p.id?'disabled':''}><span style="display:inline-block;width:12px;height:12px;background:#${p.color.toString(16).padStart(6,'0')};margin-right:6px"></span>${p.name}</button>`).join('')}</div></details>
          <details class="fold" data-fold="upgrades"><summary>Performance <span>${build.drive+build.handling+build.efficiency}/9 stages</span></summary><div class="upgrade-list">${UPGRADES.map(u=>{const level=build[u.id],cost=upgradeCost(s.current,level);return `<div class="upgrade-row"><div><strong>${u.name} · ${level}/3</strong><p class="muted small">${u.description}</p></div><button class="btn" data-act="upgrade" data-arg="${u.id}" ${level>=3||s.money<cost?'disabled':''}>${level>=3?'Max':money(cost)}</button></div>`}).join('')}</div></details>`
        return `<h2>Garage</h2><p class="muted">${money(s.money)} available</p><div class="garage-current"><span class="kicker">CURRENT RIDE</span><h3>${esc(this.player.spec.name)}</h3><p>${Math.round(this.player.spec.maxSpeed*3.6)} km/h · ${this.player.spec.tank} L · Cargo ×${this.player.spec.payMult}</p></div>
          ${workshop}<details class="fold" data-fold="vehicles"><summary>Vehicles <span>${s.owned.length} owned</span></summary><div class="grid">${cards}</div></details>
          <button class="btn ghost garage-vault" data-act="view" data-arg="holdings">Safehouses & vaults →</button>`
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
        return `<h2>Masks</h2><p class="muted">Every courier needs a face for the job. Your mask stays visible on your ride.</p>
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
        return `<h2>Local safehouses: ${esc(w?.city.name ?? '')}</h2><button class="btn" data-act="global-portfolio">Global property portfolio</button><p class="muted">Legacy local holdings below do not grant global ownership.</p>
          ${s.homes.map(h=>`<div class="card"><h3>${esc(h.name)}</h3><p class="muted">Owned safehouse · No criminal turf or passive rent</p><button class="btn ghost" data-act="home-waypoint" data-arg="${esc(h.id)}">Set waypoint</button></div>`).join('')}
          <p class="muted">Open the map and tap a teal residential building to buy a safehouse.</p>
          ${s.safehouse?`<div class="card"><h3>Your couch · Starter safehouse</h3><p>${esc(s.safehouse.name)}</p><p class="muted">Free garage and stash. Park at the street entrance to clear Heat.</p><button class="btn" data-act="home">Return to couch</button><button class="btn ghost" data-act="stash">Stash</button><button class="btn ghost" data-act="withdraw">Withdraw</button></div>`:''}
          <p class="muted">Buy landmark towers to earn passive rent every minute, in every city, forever. Owned towers glow gold.</p>
          <div class="summary"><div><small>Portfolio</small><strong>${s.holdings.length} properties</strong></div><div><small>Passive income</small><strong>${money(this.incomePerMin)}/min</strong></div></div>
          <div class="grid">${list || '<p class="muted">No landmarks found in this district.</p>'}</div>
          ${elsewhere.length ? `<h3 class="sub">Holdings in other cities</h3><ul class="plain">${elsewhere.map((h) => `<li>${esc(h.name)} <span class="muted">(${esc(h.city)})</span> <strong>+${money(h.income)}/min</strong></li>`).join('')}</ul>` : ''}`
      }
      case 'couch':
        return `<h2>Where’s your couch?</h2>
          <p class="muted">Every empire starts somewhere. Pick an address for your first safehouse. You’ll spawn on the nearest connected street.</p>
          <form id="search-form" class="search"><input name="q" aria-label="Safehouse address" placeholder="Street number, street, city, country" maxlength="160" required autocomplete="off" /><button class="btn">Find couch</button></form>
          <div id="search-results" class="cities" aria-live="polite"></div>
          <button class="btn buy big" data-act="random-couch">Random couch</button>
          <p class="muted small">Random chooses a starting district. Your safehouse stays saved on this device.</p>`
      case 'warp':
        return `<h2>${this.world ? 'City uplink' : 'Choose your district'}</h2>
          <p class="muted">Pick a city. Take the night shift. Run cargo, dodge traffic and keep enough HJ-77 in the tank to get home.</p>
          <form id="search-form" class="search"><input name="q" placeholder="Search an address, city or neighbourhood…" autocomplete="off" /><button class="btn">Search</button></form>
          <div id="search-results" class="cities"></div>
          <h3 class="sub">Deployment zones</h3>
          <div class="cities">${CITIES.map((c) => `<button class="city-btn" data-act="warp" data-arg="${c.lat}|${c.lon}|${c.name}"><strong>${c.name}</strong><span>${c.area}</span></button>`).join('')}</div>`
      case 'help':
        return `<h2>Courier Manual</h2><button class="btn ghost" data-act="traffic-sound">Traffic sound: ${this.trafficSound.enabled?'ON':'OFF'}</button>
          <div class="help">
            <div><h3>Street handling</h3><ul class="plain keys">
              <li><kbd>W</kbd>/<kbd>S</kbd> Thrust and brake (hold S when stopped to reverse on a conduit)</li>
              <li><kbd>A</kbd>/<kbd>D</kbd> Steer, or pick the branch at the next junction in Mag-Lock</li>
              <li><kbd>E</kbd> Toggle Mag-Lock / Free Hover</li>
              <li><kbd>Shift</kbd> Boost in either drive mode; burns HJ-77 fast</li>
              <li><kbd>Space</kbd> Hop off the rail</li>
              <li><kbd>V</kbd> Switch chase / top-down camera</li>
              <li><kbd>B</kbd>/<kbd>U</kbd> Bank / withdraw at a garage or owned property</li><li><kbd>Q</kbd> Burn one Cyan-ade: 15 seconds at 300 km/h, costs 25 hull</li>
            </ul></div>
            <div><h3>Business</h3><ul class="plain keys">
              <li><kbd>J</kbd> Contract board</li><li><kbd>N</kbd> Night Market map</li><li><kbd>R</kbd> Trade with a nearby dealer</li>
              <li><kbd>G</kbd> Garage</li><li><kbd>P</kbd> Turf & vaults</li><li><kbd>M</kbd> Move to another city</li>
              <li><kbd>F</kbd> Refuel at a turquoise HJ-77 pump</li><li><kbd>T</kbd> Call a grav-tow to the nearest pump</li>
            </ul></div>
            <div><h3>Hoverjuice (HJ-77)</h3><p class="muted">Your repulsors drink a volatile turquoise fluid that evaporates constantly, even while parked. Run dry and you sink to a crawl.
            HJ-77 is also the precursor to the street drug Cyan-ade. Precursor contracts pay big, but the leaking canisters double your evaporation.</p></div>
            <div><h3>Night Market</h3><p class="muted">Four gang leaders trade from parked cars where suitable commercial sites are available. Buy contraband where it is cheap and move it where bids are high. Quotes refresh every 150 seconds; supply shocks and street gluts can make or erase a fortune. Cargo capacity depends on your current ride.</p></div>
            <div><h3>Touch controls</h3><p class="muted">Use the analog stick in either mode: sideways steers or queues a junction turn, forward thrusts, back brakes. <b>GO</b> and <b>BRAKE</b> also control speed.
            Start in Free Hover. Use the lower <b>MAG-LOCK / UNLOCK</b> button to switch modes; <b>BOOST</b> burns extra HJ-77. <b>BURN</b> appears only when carrying Cyan-ade. Tap the fuel prompt at a pump to refuel.</p></div>
            <div><h3>Drive modes</h3><p class="muted"><b>Mag-Lock</b> snaps you between three rail lanes. Tap A/D to slide and queue a turn for 6 seconds; hold to keep your turn queued. Corner assist slows you through sharp turns. Heavy ramming can break lock. <b>Free Hover</b> carries your momentum across the road plane. Water breaks rail cohesion.</p></div>
          </div>
          <details class="fold" data-fold="testing"><summary>Testing tools</summary><div class="row test-funds"><span class="muted small">Playtesting?</span><button class="btn buy" data-act="cheat">+$5,000,000 test funds</button></div>
          <div class="row"><button class="btn buy" data-act="test-hoverghini" ${!this.save.owned.includes('hoverghini')&&this.save.money<vehicleById('hoverghini').price?'disabled':''}>${this.save.owned.includes('hoverghini')?'Drive Hoverghini':`Buy Hoverghini · ${money(vehicleById('hoverghini').price)}`}</button><span class="muted small">Test purchase. Bypasses the pink-slip unlock.</span></div>
          <div class="row"><button class="btn" data-act="test-flight">Test flight: ${this.player.testFlight?'ON':'OFF'} (Y)</button><span class="muted">Free Hover: Space / C climb / descend. Touch: RISE / DESCEND. Turning off restores street height.</span></div>
          </details><div class="row"><span class="muted">${s.deliveries} deliveries · ${money(s.earned)} earned lifetime</span><button class="btn danger ghost" data-act="reset">Reset save</button></div>`
      case 'win':
        return `<div class="win"><h1>HOVERGHINI</h1><p>From the gutter to the skyline. You own the ultimate status symbol.</p>
          <p class="muted">${s.deliveries} deliveries · ${s.holdings.length} properties · ${money(s.earned)} earned</p>
          <button class="btn buy" data-act="close">Take her for a spin</button></div>`
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

  private atOwnedHome(){
    if(!this.world)return false
    return this.save.homes.some(h=>{
      const i=this.homeBuildings.get(h.id),b=i===undefined?undefined:this.world!.city.buildings[i]
      return b ? distanceToHome(this.actor.x,this.actor.z,b)<18 : Math.hypot(this.actor.x-localHome(h,this.world!.city).x,this.actor.z-localHome(h,this.world!.city).z)<18
    })
  }

  buyHome(index:number){
    const w=this.world,b=w?.city.buildings[index]
    if(!w||!b||!residential(b,w.city))return
    const offer=houseOffer(b,w.city)
    if(this.save.homes.some(h=>h.id===offer.id))return
    if(this.save.money<offer.price){this.toast('Not enough cash for this safehouse','bad');return}
    this.save.money-=offer.price;this.save.homes.push(offer);this.homeBuildings.set(offer.id,index);this.persist()
    this.showMapBuilding(index);this.toast('Safehouse acquired. Park nearby to clear Heat and use your stash.','good')
  }

  private mapPanel(html:string){
    const panel=$('map-selection');panel.hidden=false;panel.innerHTML=html
    panel.querySelectorAll<HTMLElement>('[data-act]').forEach(el=>el.addEventListener('click',()=>this.onAction(el.dataset.act!,el.dataset.arg??'')))
  }
  private showMapBuilding(index:number,point?:{x:number;z:number}){
    const w=this.world!,b=w.city.buildings[index],h=houseOffer(b,w.city),owned=this.save.homes.some(v=>v.id===h.id),ll=worldToLatLon(w.city,point?.x??b.cx,point?.z??b.cz)
    const legacy=residential(b,w.city)?`<p>${owned?'Local safehouse access · Park nearby to stash cargo and clear Heat.':`Local safehouse access · ${money(h.price)}`}</p>${owned?`<button class="btn" data-act="home-waypoint" data-arg="${esc(h.id)}">Set waypoint</button><button class="btn ghost" data-act="stash">Stash</button><button class="btn ghost" data-act="withdraw">Withdraw</button>`:`<button class="btn buy" data-act="buy-home" data-arg="${index}" ${this.save.money<h.price?'disabled':''}>Buy local access · ${money(h.price)}</button>`}`:''
    this.mapPanel(`<strong>${esc(h.name)}</strong>${!w.city.procedural?`<p>Inspect the worldwide title and server price for this OSM footprint.</p><button class="btn" data-act="global-inspect" data-arg="${ll.lat}|${ll.lon}">Inspect global property</button>`:'<p>Simulated buildings have no global title.</p>'}${legacy}`)
  }

  mapPick(x:number,y:number){
    if(!this.fullView||!this.navigation||!this.world)return
    const cv=$<HTMLCanvasElement>('full-map'),dpr=cv.width/cv.clientWidth,v=this.fullView
    const m=this.mapMarkers().map(m=>{const p=this.navigation!.project(v,m.x,m.z);return {m,d:Math.hypot(p.x-x*dpr,p.y-y*dpr)}}).filter(v=>v.d<16*dpr).sort((a,b)=>a.d-b.d)[0]?.m
    if(m){
      if(m.id.startsWith('global:')){this.onAction('global-item',m.id.slice(7));return}
      if(m.id.startsWith('dealer:')){this.mapPanel(`<strong>${esc(m.label)}</strong><p>Parked gang dealer</p><button class="btn" data-act="locate-dealer" data-arg="${esc(m.id.slice(7))}">Set waypoint</button>`);return}
      if(m.id.startsWith('offer:')){const id=Number(m.id.slice(6)),c=this.offers.find(c=>c.id===id)!;this.mapPanel(`<strong>${esc(c.client)}</strong><p>${esc(c.type.label)} · ${money(c.pay)}</p><button class="btn" data-act="accept" data-arg="${id}">Accept contract</button>`);return}
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
    const freightTarget=this.economy.target;if(freightTarget)out.push({id:'freight-gate',x:wrapLon(freightTarget.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-freightTarget.lat)*110540,label:'Freight depot / lane gate',symbol:'D',color:'#73ffcb'})
    const district=this.crews.district,contest=district?.contest,target=this.crews.target
    const mark=(p:{lat:number;lon:number},id:string,label:string,symbol:string,color:string)=>out.push({id,x:wrapLon(p.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-p.lat)*110540,label,symbol,color})
    for(const h of district?.headquarters??[])mark(h,'crew-hq:'+h.id,`[${h.tag}] HQ`,'H',h.color)
    if(target)mark(target,'crew-gate','Next crew delivery gate','D','#73ffcb')
    else if(contest&&!contest.finished)mark(contest.course[0],'crew-gate','Crew delivery start','D','#73ffcb')
    for(const p of this.properties.nearby)out.push({id:'global:'+p.id,x:wrapLon(p.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-p.lat)*110540,label:`${p.name} · ${p.ownerId===this.properties.playerId?'Your title':p.ownerName||'Owned'}`,symbol:'◆',color:p.ownerId===this.properties.playerId?'#ffe08a':'#c4b3f4'})
    for(const d of this.dealers?.dealers??[])out.push({id:`dealer:${d.id}`,x:d.x,z:d.z,label:d.name,symbol:'D',color:'#df8dcc'})
    for(const c of this.offers){const n=w.city.nodes[c.from];if(n)out.push({id:`offer:${c.id}`,x:n.x,z:n.z,label:`${c.type.label} · ${money(c.pay)}`,symbol:'C',color:'#78c6ff'})}
    if(this.active)for(const [node,label,symbol] of [[this.active.from,'Pickup','P'],[this.active.to,'Drop-off','X']] as const){const n=w.city.nodes[node];out.push({id:label,x:n.x,z:n.z,label,symbol,color:'#ffba4b'})}
    for(const h of this.save.homes)out.push({id:h.id,...localHome(h,w.city),label:h.name,symbol:'H',color:'#94e4b2'})
    const garage=w.city.nodes[this.garageNode];if(garage)out.push({id:'garage',x:garage.x,z:garage.z,label:'Garage / stash',symbol:'H',color:'#94e4b2'})
    for(const p of w.pumps)out.push({id:`fuel:${p.x}:${p.z}`,x:p.x,z:p.z,label:'HJ-77',symbol:'F',color:'#00d8e8'})
    const race=this.multiplayer?.race,entry=race?.racers.find(p=>p.id===this.multiplayer?.id),checkpoint=entry&&race?.course[entry.checkpoint]
    if(checkpoint&&race?.status!=='finished')out.push({id:'multiplayer-checkpoint',x:wrapLon(checkpoint.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z:(w.city.lat-checkpoint.lat)*110540,label:'Race checkpoint',symbol:'R',color:'#73ffcb'})
    if(this.waypoint)out.push({id:'waypoint',...this.waypoint,symbol:'W',color:'#fff280'})
    return out
  }
  private buildMinimap(){
    const city=this.world!.city;this.navigation=new NavigationMap(city)
    this.homeBuildings.clear()
    const owned=new Set(this.save.homes.map(h=>h.id))
    if(owned.size)city.buildings.forEach((b,i)=>{const id=b.id??houseOffer(b,city).id;if(owned.has(id))this.homeBuildings.set(id,i)})
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
    const physicalStart=this.player.pos.clone();this.crashPulse=Math.max(0,this.crashPulse-dt*2);this.physicalCooldown=Math.max(0,this.physicalCooldown-dt)
    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) $('toast').classList.remove('show')
    }
    if (!this.paused) {
      const spec = this.player.spec
      if(this.introMessage>0){this.introMessage-=dt;if(this.introMessage<=0){this.player.heading+=0.6;this.toast('BURNER: Get off the fucking rail before you get liquefied, kid.','info')}}
      if(!this.economy.driving)this.campaign?.update(dt,this.player)
      if(this.campaign?.intro || this.campaign?.racing){const boss=this.campaign.boss;this.particles.emit(boss.position.x,boss.position.y,boss.position.z)}
      if(this.campaign?.racing&&this.campaign.target){const t=this.campaign.target;this.waypoint={x:t.x,z:t.z,label:`PINK SLIP · LAP ${this.campaign.lap+1}/3`}}
      if(this.campaign?.result){
        if(this.campaign.result==='win'){if(!this.save.owned.includes('hoverghini'))this.save.owned.push('hoverghini');this.save.won=true;this.persist();this.openModal('win')}
        else this.toast('The Hoverghini keeps its pink slip. Race lost.','bad')
        this.campaign.result=null;this.waypoint=null
      }
      if(this.fueling){
        if(input.throttle>0.1||Math.hypot(this.player.pos.x-this.fueling.x,this.player.pos.z-this.fueling.z)>18)this.settleFuel(true)
        else {const amount=Math.min(dt*4,this.fueling.limit-this.fueling.litres,this.player.spec.tank-this.juice);this.juice+=amount;this.fueling.litres+=amount;if(this.fueling.litres>=this.fueling.limit-0.01)this.settleFuel(false)}
      }
      const p=this.player
      const tunnel=w.isTunnel(p.pos.x,p.pos.z,p.pos.y)
      if(!this.economy.driving)this.run.update(dt,this.cargoUsed+(this.save.tutorial.stage==='deal'?1:0)+(this.active?.type.id==='cyanade'&&this.active.stage==='dropoff'?1:0),tunnel,w.gangAt(p.pos.x,p.pos.z)!==this.gang,this.save.mask==='balaclava')
      p.overclocking=this.run.overclock>0; p.limping=this.run.limp>=0
      if(!this.economy.driving)this.player.update(dt, input, w, this.juice > 0)
      this.collisionCooldown=Math.max(0,this.collisionCooldown-dt)
      if(p.impact>3 && !this.collisionCooldown) { this.run.damage(Math.min(45,p.impact*0.65),this.save.mask==='oni'); this.collisionCooldown=0.6 }
      if(p.apex) this.run.chain()
      if(this.run.limp===0) this.bust()
      const garage=w.city.nodes[this.garageNode]
      if(!this.police?.active&&p.groundSpeed<3 && (Math.hypot(p.pos.x-garage.x,p.pos.z-garage.z)<12 || this.atOwnedHome())) { this.run.heat=0; if(this.run.limp>=0)this.run.repair() }
      if(tunnel) this.route=[]

      const leak = this.save.mask==='respirator' ? 0 : this.active?.stage === 'dropoff' ? this.active.type.leak : 0
      const magEff = this.player.mode === 'mag' ? 0.7 : 1
      this.juice -= (spec.evap * (1 + leak) / this.run.flow + spec.burn * this.player.lastBurn * magEff) * dt
      if (this.juice <= 0 && this.juice + dt * spec.evap > 0) this.toast(`HJ-77 depleted! Crawl to a pump or ${isTouch() ? 'tap the prompt' : 'press T'} for a tow.`, 'bad')
      this.juice = Math.max(0, this.juice)
      this.updateContract(dt)
      this.offerTimer -= dt
      if (this.offerTimer <= 0 && !this.active) this.generateOffers()
      this.incomeTimer += dt
      if (this.incomeTimer >= 1) {
        this.earn((this.incomePerMin / 60) * this.incomeTimer)
        this.incomeTimer = 0
      }
      this.saveTimer += dt
      if (this.saveTimer > 10) { this.persist(); void this.syncOwnership(); this.saveTimer = 0 }
      if (this.waypoint && Math.hypot(this.waypoint.x - this.actor.x, this.waypoint.z - this.actor.z) < 40) {
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
        if(Math.hypot(this.actor.x-this.dealerAnchor.x,this.actor.z-this.dealerAnchor.z)>250)this.refreshDealers()
        void this.streamMap()
      }
    }
    if(!w.city.procedural){const geo=worldToLatLon(w.city,this.player.pos.x,this.player.pos.z);this.properties.setLocation(geo);this.crews.setLocation(geo);this.economy.setLocation(geo)}
    const freight=this.economy.step(this.paused?-1:input.throttle,this.paused?0:input.steer,this.multiplayer?(v)=>{this.multiplayer?.connection.send(v)}:null)
    if(freight&&!w.city.procedural){const p=this.player;p.pos.x=wrapLon(freight.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180);p.pos.z=(w.city.lat-freight.lat)*110540;p.pos.y=w.groundHeightAt(p.pos.x,p.pos.z,p.pos.y)+1;p.heading=freight.yaw;p.speed=freight.speed;p.vel.set(Math.sin(p.heading)*p.speed,Math.cos(p.heading)*p.speed);p.mesh.position.copy(p.pos);p.mesh.rotation.set(0,p.heading,0)}
    const crewTarget=this.economy.target??this.crews.target
    if(crewTarget&&!w.city.procedural){const x=wrapLon(crewTarget.lon-w.city.lon)*111320*Math.cos(w.city.lat*Math.PI/180),z=(w.city.lat-crewTarget.lat)*110540;this.crewGate.position.set(x,w.groundHeightAt(x,z,this.player.pos.y)+2,z);this.crewGate.rotation.x=-Math.PI/2;this.crewGate.scale.setScalar(this.economy.driving ? .12 : 1);this.crewGate.visible=true;if(this.crewGate.parent!==this.scene)this.scene.add(this.crewGate)}else this.crewGate.visible=false
    w.update(this.paused?0:dt)
    if(this.cityLife){this.cityLife.roadCandidates=this.traffic?.activityNodes??null;const life=this.cityLife,geo=worldToLatLon(w.city,this.actor.x,this.actor.z),district=this.crews.district,live=district?.id===districtFor(geo)&&district.expiresAt>Date.now(),gang=w.gangAt(this.actor.x,this.actor.z);life.context={gang,reputation:this.save.gangRep[gang]??0,friendlyControl:!!(live&&district.controller===this.crews.crew?.id),contested:!!(district?.id===districtFor(geo)&&district.contest&&!district.contest.finished),crewColor:live?district.color??undefined:undefined};life.update(this.paused?0:dt,this.actor,this.player.groundSpeed,this.run.heat);if(life.notice&&!this.paused){this.toast(life.notice,'info');life.notice=''}}
    const traffic=this.traffic?.update(this.paused?0:dt,this.actor,this.player.groundSpeed,this.run.heat,this.spray)
    if(!this.paused&&traffic&&!this.economy.driving){
      if(traffic.horn)this.trafficSound.honk(traffic.horn.distance,traffic.horn.side,traffic.horn.freight)

      for(let i=0;i<traffic.nearMisses;i++)this.run.chain()

    }
    if(!this.paused&&!this.economy.driving){
      const p=this.player,policeMessage=this.police?.message;if(this.police)this.police.roadCandidates=this.traffic?.policeRoads??null;this.police?.update(dt,p.pos,p.groundSpeed,this.run.heat,p.heading,[...(this.traffic?.bodies()??[]),...(this.streetObjects?.bodies()??[])]);if(this.traffic)this.traffic.sirens=!!this.police?.active
      this.streetObjects?.update(dt,p.pos,this.traffic?.activityNodes??[])
      if(this.police){if(policeMessage!==this.police.message){this.radio.policeChanged();if(this.police.state==='stop'||this.police.state==='escaped')this.toast(this.police.message,'info')}if(this.police.state==='pursuit'||this.police.state==='stop')this.trafficSound.siren(Math.min(...this.police.units.map(u=>u.pos.distanceTo(p.pos))));this.run.heat=Math.max(0,Math.min(5,this.run.heat+this.police.heatDelta));if(this.police.busted){this.bust();this.police.busted=false}}
      if(p.pos.distanceTo(physicalStart)<50){
        const body={x:p.pos.x,y:p.pos.y,z:p.pos.z,heading:p.heading,halfW:p.mesh.userData.halfW??.6,halfL:p.mesh.userData.halfL??1.3,vx:p.vel.x,vz:p.vel.y,mass:p.spec.kind==='truck'?3000:1000}
        this.physical.setBodies([...(this.traffic?.bodies()??[]),...(this.police?.bodies()??[]),...(this.streetObjects?.bodies()??[])])
        const contact=this.physical.solve(body,physicalStart,dt)
        if(contact.hits){if(p.mode==='mag')p.unsnap();const wall=clipBuildings(w,physicalStart,body,p.heading,body.halfW,body.halfL);p.pos.set(wall?.x??body.x,body.y,wall?.z??body.z);p.vel.set(wall?0:body.vx,wall?0:body.vz);p.speed=p.vel.length();p.mesh.position.copy(p.pos)}
        const severity=Math.max(contact.impact,p.impact)
        if(severity>3&&!this.physicalCooldown){if(contact.impact>3)this.run.damage(Math.min(40,contact.impact*.6),this.save.mask==='oni');this.crashPulse=Math.min(1,severity/35);this.trafficSound.crash(severity);this.police?.reportCrash(severity);this.physicalCooldown=.35;for(let i=0;i<5;i++)this.particles.emit(p.pos.x+(Math.random()-.5),p.pos.y,p.pos.z+(Math.random()-.5))}
      }
    }
    this.multiplayer?.update(dt,this.player,this.spray,w,this.paused?0:dt,buildFor(this.save.builds,this.save.current).paint)
    if(!this.paused){
      this.spray.emit(this.player,dt,this.actor,this.player.heading,this.player.groundSpeed,
        this.player.mesh.userData.halfW,this.player.mesh.userData.halfL,
        w.groundHeightAt(this.actor.x,this.actor.z,this.actor.y),this.player.boosting)
      if(this.campaign?.intro || this.campaign?.racing){
        const boss=this.campaign.boss
        this.spray.emit(boss,dt,boss.position,boss.rotation.y,60,boss.userData.halfW,boss.userData.halfL,
          w.groundHeightAt(boss.position.x,boss.position.z,boss.position.y),true)
      }
      this.spray.update(dt)
      for(const slick of this.slicks){slick.life-=dt;this.particles.emit(slick.x+(Math.random()-0.5)*5,w.groundHeightAt(slick.x,slick.z,this.actor.y)+.4,slick.z+(Math.random()-0.5)*5);if(Math.hypot(this.actor.x-slick.x,this.actor.z-slick.z)<3)this.run.hull=Math.max(0,this.run.hull-dt*2)}
      this.slicks=this.slicks.filter(s=>s.life>0)
      this.particles.update(dt)
    }
    if (this.dealers && this.marketEpoch !== this.dealers.epoch) {
      this.marketEpoch = this.dealers.epoch
      if ($('modal').dataset.view === 'market') this.openModal('market')
      this.toast('Night Market prices just shifted across the city', 'info')
    }
    this.updateMarkers(dt)
    this.hudTimer -= dt
    if (this.hudTimer <= 0) { this.updateHud(); this.drawMinimap(); this.hudTimer = 0.1 }
  }

  private updateMarkers(dt: number) {
    const t = this.target()
    this.beacon.visible = !!t
    this.arrow.visible = !!t
    if (!t) return
    const color = this.active ? (this.active.stage === 'pickup' ? 0x00f0ff : 0xff9d00) : 0x19ffe6
    this.beacon.position.set(t.x, this.world!.groundHeightAt(t.x,t.z,this.actor.y), t.z)
    this.beacon.children.forEach((c) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(color))
    this.beacon.getObjectByName('ring')!.rotation.z += dt
    ;(this.arrow.material as THREE.MeshBasicMaterial).color.setHex(color)
    const p = this.actor
    const ang = Math.atan2(t.x - p.x, t.z - p.z)
    const y = p.y + (this.player.spec.kind === 'board' ? 2.6 : 3.2)
    this.arrow.position.set(p.x + Math.sin(ang) * 3, y, p.z + Math.cos(ang) * 3)
    this.arrow.lookAt(t.x, y, t.z)
  }

  private updateHud() {
    const radioStatus=document.getElementById('radio-status');if(radioStatus)radioStatus.textContent=this.radio.status
    const s = this.save
    const p = this.player
    const turf=this.world!.gangAt(p.pos.x,p.pos.z)
    $('territory-status').textContent=`${turf} · ${turf===this.gang?'FRIENDLY':'RIVAL'} TURF`
    $('territory-status').style.color=GANG_INFO[turf].color
    if(this.territoryLast!==turf){if(this.territoryLast)this.toast(`${turf} territory · ${GANG_INFO[turf].leader}`,'info');this.territoryLast=turf}
    const training=tutorialActive(s.tutorial)
    $('tutorial-tip').hidden=!training
    document.body.classList.toggle('training',training)
    $('tutorial-tip').textContent=tutorialText(s.tutorial)
    $('money').textContent = money(s.money)
    $('income').textContent = this.incomePerMin ? `+${money(this.incomePerMin)}/min passive` : 'NO VAULTS · KEEP MOVING'
    $('vehicle-name').textContent = `${p.spec.name} · ${this.gang}`
    const delivery=this.crews.district?.contest,driver=delivery?.runs.find(r=>r.player===this.crews.player)
    $('network-status').textContent=this.economy.progress || (delivery&&!delivery.finished&&driver?`CREW DELIVERY ${driver.next}/${delivery.course.length} · ${driver.best!==null?'COMPLETE':Date.now()<delivery.startsAt?'WARMUP':driver.invalid||'FOLLOW GREEN GATES'}`:'') || this.multiplayer?.raceStatus || this.multiplayer?.status || 'LOCAL SAVE'
    const tunnel=this.world!.isTunnel(p.pos.x,p.pos.z,p.pos.y)
    $('minimap').style.visibility=tunnel?'hidden':'visible'
    $('alt').textContent=tunnel?'GPS LOST':`${Math.round(p.pos.y)} m${p.testFlight?' · TEST FLIGHT':''}`
    document.body.classList.toggle('test-flight',p.testFlight && p.mode==='free')
    $('combat-status').title=this.cityLife?.label??''
    $('combat-status').textContent = `HULL ${Math.ceil(this.run.hull)}%${this.run.heat>0?' · HEAT '+this.run.heat.toFixed(1):''}${this.run.flow>1?' · FLOW '+this.run.flow.toFixed(1)+'×':''}${this.run.limp>=0?' · LIMP '+Math.ceil(this.run.limp)+'s':''}${this.cityLife&&this.run.heat===0&&this.run.flow<=1&&this.run.limp<0?' · '+this.cityLife.label:''}`
    $('speed').textContent = String(Math.round(p.groundSpeed * 3.6))
    const mode = $('mode')
    setHtml(mode, p.mode === 'mag' ? 'MAG-LOCK' : 'FREE HOVER')
    mode.className = `mode ${p.mode}`
    $('hud').dataset.mode = p.mode
    const lock = $('touch-mode')
    lock.setAttribute('aria-pressed', String(p.mode === 'mag'))
    lock.textContent = p.mode === 'mag' ? 'UNLOCK' : 'MAG-LOCK'
    const burn = $('touch-burn') as HTMLButtonElement
    burn.hidden = !(s.contraband.cyanade > 0)
    burn.disabled = this.run.overclock > 0 || this.run.limp >= 0
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

    const c = this.active
    const panel = $('contract')
    panel.classList.toggle('idle',!c && !this.waypoint)
    panel.classList.toggle('waypoint',!c && !!this.waypoint)
    if (c) {
      panel.classList.add('show')
      const w = this.world!
      const tn = w.city.nodes[c.stage === 'pickup' ? c.from : c.to]
      const d = Math.hypot(tn.x - p.pos.x, tn.z - p.pos.z)
      const dist = d < 1000 ? Math.round(d / 5) * 5 + ' m' : (d / 1000).toFixed(1) + ' km'
      setHtml(panel, `<div class="row"><span class="pill ${c.type.id}">${c.type.label}</span><strong class="pay">${money(c.pay)}</strong></div>
        <div class="client">${esc(c.client)}</div>
        <div class="row"><span>${c.stage === 'pickup' ? 'PICKUP' : 'DROP-OFF'} · ${dist}</span>
        <span class="timer ${c.stage === 'dropoff' && c.remaining < 15 ? 'hot' : ''}">${c.tutorial?'TRAINING':c.stage === 'dropoff' ? (c.remaining > 0 ? Math.ceil(c.remaining) + 's' : 'LATE') : c.time + 's'}</span></div>`)
    } else if (this.waypoint) {
      panel.classList.add('show')
      setHtml(panel, `<div class="client">Waypoint: ${esc(this.waypoint.label)}</div><div class="muted">${touch ? 'Tap for contracts' : 'Press <kbd>J</kbd> for contracts'}</div>`)
    } else {
      panel.classList.remove('show')
      setHtml(panel, `<span class="muted">DISPATCH</span> · ${touch?'Tap for work':'<kbd>J</kbd> Find a contract'}`)
    }

    const { dist } = this.world!.nearestPump(p.pos.x, p.pos.z)
    const prompt = $('prompt')
    const market = this.dealers?.nearest(this.actor.x, this.actor.z)
    if (market?.dealer && market.dist < 22 && !this.paused) {
      setHtml(prompt, `${touch ? 'Tap to trade' : '<kbd>R</kbd> Trade'} with ${esc(market.dealer.name)} · ${market.dealer.gang}`)
      prompt.classList.add('show')
    } else if (dist < 18 && !this.paused) {
      const need = p.spec.tank - this.juice
      setHtml(prompt, this.fueling ? `Fueling ${this.fueling.litres.toFixed(1)} L · F to pay / throttle to steal` : need > 0.5 ? `${touch ? '⛽ Tap to refuel' : '<kbd>F</kbd> Refuel'} ${need.toFixed(0)} L · ${money(need * JUICE_PRICE)}` : 'Tank full')
      prompt.classList.add('show')
    } else if (this.juice <= 0 && !this.paused) {
      setHtml(prompt, `${touch ? 'Tap to call' : '<kbd>T</kbd> Call'} grav-tow (${money(30 * p.spec.payMult)})`)
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
