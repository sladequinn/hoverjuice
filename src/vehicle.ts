import {laneOffset,MAX_LANE_OFFSET} from './streets'
import { OVERCLOCK_SPEED } from './dynamics'
import * as THREE from 'three'
import {softDisc} from './art'
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { VEHICLE_SCALE, type VehicleSpec } from './data'
import type { World } from './world'
import { buildCharacter, setCharacterMask } from './character'

export interface Input {
  throttle: number
  brake: number
  steer: number
  boost: boolean
  up: boolean
  down: boolean
}

export type FlightMode = 'mag' | 'free'

const HOVER = 1.3
const SWAY_MAX = MAX_LANE_OFFSET

function wedge(w: number, h: number, l: number, taper: number) {
  const g = new THREE.BoxGeometry(w, h, l, 1, 1, 4)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i)
    if (y > 0 && z > 0) p.setY(i, y - (z / (l / 2)) * h * taper)
  }
  g.computeVertexNormals()
  return g
}

export function buildVehicleMesh(spec: VehicleSpec, maskId = 'balaclava') {
  const g = new THREE.Group()
  const body = new THREE.MeshStandardMaterial({ color: spec.body, metalness: 0.22, roughness: 0.48, emissive: spec.body, emissiveIntensity: 0.025 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x414b56, metalness: 0.2, roughness: 0.55 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x517b8c, metalness: 0.25, roughness: 0.2, emissive: 0x14303b })
  const glow = new THREE.MeshBasicMaterial({ color: spec.glow })
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    g.add(m)
    return m
  }
  let halfW = 1, halfL = 2
  switch (spec.kind) {
    case 'board': {
      const deck=wedge(0.85,0.18,2.3,0.45),vertices=deck.getAttribute('position')
      for(let i=0;i<vertices.count;i++)vertices.setX(i,vertices.getX(i)*(1-0.35*Math.pow(Math.abs(vertices.getZ(i))/1.15,3)))
      deck.computeVertexNormals();add(deck,body)
      add(new THREE.BoxGeometry(0.46,0.03,1.3),dark,0,0.11,0)
      for(const z of [-0.7,0.7])add(new THREE.CylinderGeometry(0.25,0.18,0.18,10),dark,0,-0.14,z)
      add(new THREE.BoxGeometry(0.8, 0.04, 2.15), glow, 0, -0.08, 0)
      const rider = buildCharacter(maskId)
      const u = rider.userData
      u.legL.rotation.set(-0.5, 0, 0.1)
      u.legL.position.z=.23
      u.legR.rotation.set(-0.5, 0, -0.1)
      u.legR.position.z=-.23
      u.armL.rotation.set(-0.4, 0, 0.35)
      u.armR.rotation.set(0.2, 0, -0.3)
      rider.rotation.y = 0.9
      rider.position.y = 0.1
      rider.name = 'rider'
      g.add(rider)
      halfW = 0.4; halfL = 1
      break
    }
    case 'compact': {
      add(new RoundedBoxGeometry(2.02,0.52,4.35,1,0.13),body,0,0.28,0)
      add(wedge(1.83,0.25,1.35,0.55),body,0,0.64,1.38)
      const cabin=new THREE.BoxGeometry(1.65,.48,2.05)
      const cp=cabin.attributes.position
      for(let i=0;i<cp.count;i++)if(cp.getY(i)>0){cp.setX(i,cp.getX(i)*.75);cp.setZ(i,cp.getZ(i)*.48-.12)}
      cabin.computeVertexNormals()
      add(cabin,glass,0,.88,-.08)
      add(new THREE.BoxGeometry(1.25,.045,.98),body,0,1.13,-.2)
      add(new RoundedBoxGeometry(1.85,0.24,0.88,1,0.06),body,0,0.61,-1.55)
      add(new THREE.BoxGeometry(1.84,0.19,0.15),dark,0,0.28,-2.23)
      add(new THREE.BoxGeometry(1.75,0.06,0.06),new THREE.MeshBasicMaterial({color:0xd85131}),0,0.58,-2.2)
      for(const side of [-1,1]){
        add(new RoundedBoxGeometry(0.25,0.42,2.7,1,0.09),dark,side*.99,0.22,-0.25)
        add(new THREE.CylinderGeometry(0.2,0.2,0.5,12),dark,side*0.87,0.15,-1.85).rotation.x=Math.PI/2
        add(new THREE.TorusGeometry(0.13,0.035,5,12),glow,side*0.87,0.15,-2.12).rotation.y=Math.PI
        add(new THREE.BoxGeometry(0.5,0.075,0.05),new THREE.MeshBasicMaterial({color:0xe7cf9b}),side*0.61,0.56,2.19)
        add(new THREE.BoxGeometry(0.045,0.06,1.65),body,side*0.79,0.76,-0.1)
      }
      halfW=1.12;halfL=2.25;break
    }
    case 'truck': {
      add(new RoundedBoxGeometry(2.12, 0.54, 4.75, 1, 0.12), body, 0, 0.32, 0)
      add(wedge(1.98, 0.38, 1.85, 0.52), body, 0, 0.68, 1.32)
      const truckCabin = new THREE.BoxGeometry(1.78, 0.54, 1.95)
      const tcp = truckCabin.attributes.position
      for (let i = 0; i < tcp.count; i++) if (tcp.getY(i) > 0) { tcp.setX(i, tcp.getX(i) * 0.82); tcp.setZ(i, tcp.getZ(i) * 0.62 + 0.08) }
      truckCabin.computeVertexNormals()
      add(truckCabin, glass, 0, 0.96, 0.35)
      add(new THREE.BoxGeometry(1.42, 0.06, 1.15), body, 0, 1.24, 0.38)
      add(new RoundedBoxGeometry(1.94, 0.36, 1.95, 1, 0.08), dark, 0, 0.66, -1.32)
      for (const side of [-1, 1]) {
        add(new RoundedBoxGeometry(0.26, 0.42, 3.85, 1, 0.08), dark, side * 1.04, 0.26, -0.1)
        add(new THREE.CylinderGeometry(0.22, 0.22, 0.52, 12), dark, side * 0.84, 0.2, -2.18).rotation.x = Math.PI / 2
        add(new THREE.BoxGeometry(0.48, 0.08, 0.06), new THREE.MeshBasicMaterial({ color: 0xe7cf9b }), side * 0.72, 0.58, 2.38)
        add(new THREE.BoxGeometry(0.08, 0.14, 1.85), body, side * 0.96, 0.82, -1.32)
      }
      add(new THREE.BoxGeometry(2.18, 0.06, 4.45), glow, 0, 0.12, 0)
      add(new THREE.BoxGeometry(1.88, 0.07, 0.06), new THREE.MeshBasicMaterial({ color: 0xd85131 }), 0, 0.58, -2.38)
      halfW = 1.12; halfL = 2.42
      break
    }
    case 'luxury': {
      add(new RoundedBoxGeometry(1.96, 0.5, 4.88, 1, 0.14), body, 0, 0.32, 0)
      add(wedge(1.86, 0.34, 2.1, 0.48), body, 0, 0.64, 1.35)
      add(new RoundedBoxGeometry(1.82, 0.26, 1.25, 1, 0.08), body, 0, 0.62, -1.72)
      const luxCabin = new THREE.BoxGeometry(1.58, 0.5, 2.25)
      const lcp = luxCabin.attributes.position
      for (let i = 0; i < lcp.count; i++) if (lcp.getY(i) > 0) { lcp.setX(i, lcp.getX(i) * 0.78); lcp.setZ(i, lcp.getZ(i) * 0.58 - 0.1) }
      luxCabin.computeVertexNormals()
      add(luxCabin, glass, 0, 0.92, -0.28)
      add(new THREE.BoxGeometry(1.22, 0.05, 1.18), body, 0, 1.18, -0.36)
      add(new THREE.BoxGeometry(1.18, 0.32, 0.08), new THREE.MeshStandardMaterial({ color: 0xd8e2e6, metalness: 0.9, roughness: 0.15 }), 0, 0.48, 2.46)
      for (const side of [-1, 1]) {
        add(new RoundedBoxGeometry(0.22, 0.36, 3.6, 1, 0.08), dark, side * 0.96, 0.22, -0.1)
        add(new THREE.CylinderGeometry(0.19, 0.19, 0.48, 12), dark, side * 0.78, 0.18, -2.28).rotation.x = Math.PI / 2
        add(new THREE.BoxGeometry(0.42, 0.07, 0.05), glow, side * 0.68, 0.58, 2.46)
      }
      add(new THREE.BoxGeometry(2.02, 0.05, 4.55), glow, 0, 0.12, 0)
      add(new THREE.BoxGeometry(1.76, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xd85131 }), 0, 0.58, -2.45)
      halfW = 1; halfL = 2.5
      break
    }
    case 'super': {
      add(new RoundedBoxGeometry(2.14, 0.42, 4.65, 1, 0.12), body, 0, 0.28, 0)
      add(wedge(2.18, 0.42, 2.4, 0.72), body, 0, 0.54, 1.15)
      add(wedge(1.92, 0.28, 1.6, 0.4), body, 0, 0.58, -1.45)
      const canopy = add(wedge(1.26, 0.44, 1.95, 0.78), glass, 0, 0.86, -0.22)
      canopy.scale.set(1, 1, 1)
      for (const side of [-1, 1]) {
        add(new RoundedBoxGeometry(0.28, 0.34, 2.85, 1, 0.08), dark, side * 1.02, 0.24, -0.25)
        add(new THREE.CylinderGeometry(0.21, 0.21, 0.52, 12), dark, side * 0.74, 0.2, -2.18).rotation.x = Math.PI / 2
        add(new THREE.BoxGeometry(0.1, 0.38, 0.14), dark, side * 0.82, 0.76, -2.22)
        add(new THREE.BoxGeometry(0.1, 0.05, 1.8), glow, side * 1.08, 0.44, 0.95).rotation.y = -side * 0.2
      }
      add(new THREE.BoxGeometry(2.26, 0.08, 0.48), dark, 0, 0.96, -2.24)
      add(new THREE.BoxGeometry(2.22, 0.05, 4.35), glow, 0, 0.08, 0)
      add(new THREE.BoxGeometry(1.82, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xff1e3c }), 0, 0.56, -2.38)
      halfW = 1.1; halfL = 2.4
      break
    }
  }
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>()
  for(const child of [...g.children])if(child instanceof THREE.Mesh){
    child.updateMatrix();const geo=(child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone()).applyMatrix4(child.matrix)
    const material=child.material as THREE.Material,list=batches.get(material)??[];list.push(geo);batches.set(material,list);child.geometry.dispose();g.remove(child)
  }
  for(const [material,geometries] of batches){const merged=mergeGeometries(geometries);if(merged)g.add(new THREE.Mesh(merged,material));geometries.forEach(geo=>geo.dispose())}
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ color: spec.glow, map:softDisc, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  pad.rotation.x = -Math.PI / 2
  pad.scale.set(halfW * 1.6, halfL * 1.2, 1)
  pad.name = 'pad'
  g.add(pad)
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({color:0x000000,map:softDisc,transparent:true,opacity:0.6,depthWrite:false}))
  shadow.name='contact-shadow';shadow.rotation.x=-Math.PI/2;shadow.scale.set(halfW*1.3,halfL*1.15,1);g.add(shadow)
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(halfW * 0.5, 3, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: spec.glow, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  flame.rotation.x = -Math.PI / 2
  flame.position.set(0, 0.5, -halfL - 1.5)
  flame.name = 'flame'
  flame.visible = false
  g.add(flame)

  // Procedural 3D visual damage markers (scorch seams, arcing repulsor nodes, and shunt shield cage).
  const dmgGroup = new THREE.Group()
  dmgGroup.name = 'damage-markers'
  dmgGroup.visible = false
  const scorchMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, wireframe: true, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })
  const scorchL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, halfL * 1.15), scorchMat)
  scorchL.position.set(-halfW * 0.96, 0.36, 0.1)
  scorchL.name = 'damage-scorch-l'
  const scorchR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, halfL * 1.15), scorchMat)
  scorchR.position.set(halfW * 0.96, 0.36, -0.1)
  scorchR.name = 'damage-scorch-r'
  const arcMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  const arcFront = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), arcMat)
  arcFront.position.set(halfW * 0.55, 0.48, halfL * 0.72)
  arcFront.name = 'damage-arc-front'
  const arcRear = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), scorchMat)
  arcRear.position.set(-halfW * 0.55, 0.42, -halfL * 0.78)
  arcRear.name = 'damage-arc-rear'
  const shieldMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  const shield = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2.18, 0.75, halfL * 2.08), shieldMat)
  shield.position.set(0, 0.44, 0)
  shield.name = 'damage-shield'
  dmgGroup.add(scorchL, scorchR, arcFront, arcRear, shield)
  g.add(dmgGroup)

  g.scale.setScalar(VEHICLE_SCALE)
  g.userData.halfL = halfL * VEHICLE_SCALE
  g.userData.halfW = halfW * VEHICLE_SCALE

  return g
}

/** Builds an instanced-ready vertex-colored BufferGeometry from the existing vehicle inventory. */
export function buildTrafficFleetGeometry(fleetIndex: number, specs: readonly VehicleSpec[]): THREE.BufferGeometry {
  const targetKinds: VehicleSpec['kind'][] = ['compact', 'luxury', 'super']
  const wantedKind = targetKinds[fleetIndex % targetKinds.length]
  const baseSpec = specs.find((s) => s.kind === wantedKind) ?? specs[Math.min(fleetIndex + 1, specs.length - 1)] ?? specs[0]
  const group = buildVehicleMesh({ ...baseSpec, body: 0xffffff, glow: 0x00f0ff })
  const parts: THREE.BufferGeometry[] = []
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue
    if (child.name === 'pad' || child.name === 'contact-shadow' || child.name === 'flame') continue
    const geo = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone())
    geo.translate(0, -0.35, 0)
    const mat = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
    const c = new THREE.Color(mat.color ? mat.color.getHex() : 0xffffff)
    const count = geo.attributes.position.count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r
      colors[i + 1] = c.g
      colors[i + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    parts.push(geo)
  }
  const merged = mergeGeometries(parts)!
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      const m = obj.material
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m.dispose()
    }
  })
  parts.forEach((p) => p.dispose())
  return merged
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export class Player {
  spec: VehicleSpec
  mesh: THREE.Group
  mask: string
  pos = new THREE.Vector3()
  vel = new THREE.Vector2()
  heading = 0
  speed = 0
  mode: FlightMode = 'mag'
  edgeA = 0
  edgeB = 0
  edgeS = 0
  nextNode = -1
  targetAlt = HOVER
  bank = 0
  boosting = false
  gliding = false
  bump = 0
  lastBurn = 0
  laneIndex = 1
  overclocking = false
  limping = false
  impact = 0
  apex = false
  curbScrape = false
  testFlight = false
  private turnRequest = 0
  private turnMemory = 0
  private steerLatch = 0
  /** lateral offset from the conduit centreline in Mag-Lock (metres, + is left) */
  sway = 0
  private swayV = 0
  private hopY = 0
  private hopV = 0
  private glideFuel = 1.6
  private reverseLatch = false
  private brakeHold = 0
  private shuntRoll = 0
  private shuntPitch = 0
  private shieldFlash = 0
  private damageTime = 0

  constructor(spec: VehicleSpec, mask: string) {
    this.spec = spec
    this.mask = mask
    this.mesh = buildVehicleMesh(spec, mask)
  }

  get airborne() {
    return this.hopY > 0.65
  }

  applyShunt(side: number, intensity = 1) {
    const dir = side || (Math.random() > 0.5 ? 1 : -1)
    this.shuntRoll = Math.max(-0.55, Math.min(0.55, this.shuntRoll + dir * 0.34 * intensity))
    this.shuntPitch = Math.max(-0.22, Math.min(0.22, 0.12 * intensity))
    this.shieldFlash = Math.min(1, 0.65 + 0.35 * intensity)
    this.bump = Math.min(1, this.bump + 0.35 * intensity)
  }

  updateDamageVisuals(hull: number, dt: number, impactPulse = 0) {
    this.damageTime += dt
    if (impactPulse > 0) this.shieldFlash = Math.min(1, Math.max(this.shieldFlash, 0.45 + impactPulse * 0.02))
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2.4)
    const dmgGroup = this.mesh.getObjectByName('damage-markers') as THREE.Group | undefined
    if (!dmgGroup) return
    const dmgRatio = Math.max(0, Math.min(1, (100 - hull) / 100))
    const showAny = dmgRatio > 0.12 || this.shieldFlash > 0.02
    dmgGroup.visible = showAny
    if (!showAny) return

    const flicker = 0.55 + 0.45 * Math.sin(this.damageTime * 28) * Math.cos(this.damageTime * 17)
    const scorchL = dmgGroup.getObjectByName('damage-scorch-l') as THREE.Mesh | undefined
    const scorchR = dmgGroup.getObjectByName('damage-scorch-r') as THREE.Mesh | undefined
    const arcFront = dmgGroup.getObjectByName('damage-arc-front') as THREE.Mesh | undefined
    const arcRear = dmgGroup.getObjectByName('damage-arc-rear') as THREE.Mesh | undefined
    const shield = dmgGroup.getObjectByName('damage-shield') as THREE.Mesh | undefined

    if (scorchL && scorchR) {
      scorchL.visible = dmgRatio > 0.15
      scorchR.visible = dmgRatio > 0.3
      const mat = scorchL.material as THREE.MeshBasicMaterial
      mat.opacity = Math.min(0.92, dmgRatio * 0.95 * flicker + this.shieldFlash * 0.4)
    }
    if (arcFront) {
      arcFront.visible = dmgRatio > 0.25 || this.shieldFlash > 0.1
      arcFront.rotation.x += dt * 11
      arcFront.rotation.y -= dt * 14
      arcFront.scale.setScalar(0.65 + (dmgRatio * 0.65 + this.shieldFlash * 0.5) * flicker)
    }
    if (arcRear) {
      arcRear.visible = dmgRatio > 0.45 || this.shieldFlash > 0.25
      arcRear.rotation.z += dt * 15
      arcRear.scale.setScalar(0.6 + dmgRatio * 0.75 * flicker)
    }
    if (shield) {
      shield.visible = this.shieldFlash > 0.02
      const sm = shield.material as THREE.MeshBasicMaterial
      sm.color.setHex(hull < 40 ? 0xff5a1f : 0x00f0ff)
      sm.opacity = this.shieldFlash * 0.58 * (0.7 + 0.3 * Math.sin(this.damageTime * 36))
    }
  }

  setSpec(spec: VehicleSpec) {
    const parent = this.mesh.parent
    const riderVisible = this.mesh.getObjectByName('rider')?.visible ?? true
    const old=this.mesh
    parent?.remove(old)
    // Rider materials are shared by every character; only dispose its private geometry.
    const rider=old.getObjectByName('rider')
    if(rider){old.remove(rider);rider.traverse(obj=>{if(obj instanceof THREE.Mesh)obj.geometry.dispose()})}
    const materials=new Set<THREE.Material>()
    old.traverse(obj=>{if(obj instanceof THREE.Mesh){obj.geometry.dispose();for(const mat of Array.isArray(obj.material)?obj.material:[obj.material])materials.add(mat)}})
    materials.forEach(mat=>mat.dispose())
    this.mesh = buildVehicleMesh(spec, this.mask)
    this.mesh.position.copy(old.position);this.mesh.quaternion.copy(old.quaternion)
    parent?.add(this.mesh)
    this.spec = spec
    this.showRider(riderVisible)
  }

  setMask(id: string) {
    this.mask = id
    const rider = this.mesh.getObjectByName('rider') as THREE.Group | undefined
    if (rider) setCharacterMask(rider, id)

  }

  showRider(v: boolean) {
    const rider = this.mesh.getObjectByName('rider')
    if (rider) rider.visible = v
  }

  get groundSpeed() {
    return this.mode === 'mag' ? Math.abs(this.speed) : this.vel.length()
  }

  get parked() {
    return this.groundSpeed < 3 && this.pos.y < 4
  }

  placeAtNode(world: World, node: number) {
    const n = world.city.nodes[node]
    const b = n.adj[0] ?? node
    this.edgeA = node
    this.edgeB = b
    this.edgeS = 0
    this.speed = 0
    this.turnRequest = this.turnMemory = this.steerLatch = 0
    this.sway = this.swayV = 0
    this.hopY = this.hopV = 0
    this.gliding = false
    this.brakeHold = 0
    this.reverseLatch = false
    this.laneIndex = 1
    this.vel.set(0, 0)
    this.mode = 'mag'
    this.pos.set(n.x, (n.y ?? 0) + HOVER, n.z)
    const m = world.city.nodes[b]
    this.heading = Math.atan2(m.x - n.x, m.z - n.z)
    this.targetAlt = HOVER
  }

  /** Snap onto the closest conduit segment. Returns false if none is close enough. */
  snap(world: World, range = 65) {
    if (world.isWater(this.pos.x,this.pos.z) && world.groundHeightAt(this.pos.x,this.pos.z,this.pos.y) < world.terrainHeightAt(this.pos.x,this.pos.z)-1) return false
    const nodes = world.city.nodes
    let best = -1, bestB = -1, bd = range, bt = 0
    const px = this.pos.x, pz = this.pos.z
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      if (Math.abs(a.x - px) > 400 || Math.abs(a.z - pz) > 400) continue
      for (const j of a.adj) {
        if (j < i) continue
        const b = nodes[j]
        const dx = b.x - a.x, dz = b.z - a.z
        const l2 = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2))
        const d = Math.hypot(a.x + dx * t - px, a.z + dz * t - pz)
        const height = (a.y ?? 0) * (1-t) + (b.y ?? 0) * t
        if (Math.abs(height + HOVER - this.pos.y) < 16 && d < bd) { bd = d; best = i; bestB = j; bt = t }
      }
    }
    if (best < 0) return false
    const a = nodes[best], b = nodes[bestB]
    const dir = Math.atan2(b.x - a.x, b.z - a.z)
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const moveHeading = this.vel.length() > 3 ? Math.atan2(this.vel.x, this.vel.y) : this.heading
    const fwd = Math.abs(wrap(dir - moveHeading)) <= Math.PI / 2
    if (fwd) { this.edgeA = best; this.edgeB = bestB; this.edgeS = bt * len }
    else { this.edgeA = bestB; this.edgeB = best; this.edgeS = (1 - bt) * len }
    this.speed = Math.max(0, this.vel.length() * Math.max(0.35, Math.abs(Math.cos(wrap(dir - moveHeading)))))
    const cx = a.x + (b.x - a.x) * bt, cz = a.z + (b.z - a.z) * bt
    const h = fwd ? dir : dir + Math.PI
    const side = (this.pos.x - cx) * Math.cos(h) - (this.pos.z - cz) * Math.sin(h)
    this.sway = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, side))
    this.laneIndex = Math.max(0, Math.min(2, 1 - Math.round(this.sway / Math.max(.01,laneOffset(Math.min(world.city.nodes[this.edgeA].width??5,world.city.nodes[this.edgeB].width??5),this.mesh.userData.halfW)))))
    this.swayV = 0
    this.mode = 'mag'
    this.turnRequest=this.turnMemory=this.steerLatch=0
    this.brakeHold = 0
    this.reverseLatch = false
    return true
  }

  /** Leave the conduit. Returns true if the exit was fast enough to slingshot. */
  unsnap() {
    this.turnRequest=this.turnMemory=this.steerLatch=0
    this.mode = 'free'
    const sling = this.speed > 12
    const v = this.speed * (sling ? 1.25 : 1)
    this.vel.set(Math.sin(this.heading) * v, Math.cos(this.heading) * v)
    this.vel.x += Math.cos(this.heading) * this.swayV
    this.vel.y -= Math.sin(this.heading) * this.swayV
    this.targetAlt = Math.max(this.pos.y, HOVER)
    this.hopY = this.hopV = 0
    this.gliding = false
    return sling
  }

  private chooseNext(world: World, steer: number, edgeA = this.edgeA, edgeB = this.edgeB) {
    const nodes = world.city.nodes
    const a = nodes[edgeA], b = nodes[edgeB]
    const inAng = Math.atan2(b.x - a.x, b.z - a.z)
    const opts = b.adj.filter((c) => c !== edgeA)
    if (!opts.length) return edgeA
    let best = opts[0], bestScore = -Infinity
    for (const c of opts) {
      const n = nodes[c]
      const rel = wrap(Math.atan2(n.x - b.x, n.z - b.z) - inAng)
      const requested = Math.abs(steer) > 0.16 && Math.sign(rel) === Math.sign(steer) && Math.abs(rel) > 0.2 && Math.abs(rel) < 2.85
      // Penalize accidental acute hairpins (> 150 deg) when cruising straight unless no other forward option exists.
      const straightScore = Math.abs(rel) > 2.62 ? -6 - Math.abs(rel) : -Math.abs(rel)
      const score = requested ? 4 - Math.abs(Math.abs(rel) - Math.PI / 2) : straightScore
      if (score > bestScore) { bestScore = score; best = c }
    }
    return best
  }

  /** Returns a descriptor for the upcoming junction turn: -1 right, 0 straight, 1 left, 2 dead end. */
  nextTurn(world: World) {
    const nodes = world.city.nodes
    let edgeA=this.edgeA, edgeB=this.edgeB, distance=-this.edgeS
    for(let step=0;step<24;step++) {
      const a=nodes[edgeA], b=nodes[edgeB]
      distance+=Math.hypot(b.x-a.x,b.z-a.z)
      const next=this.chooseNext(world,this.turnRequest,edgeA,edgeB)
      if(next===edgeA)return {dir:2,junction:false}
      const c=nodes[next]
      const rel=wrap(Math.atan2(c.x-b.x,c.z-b.z)-Math.atan2(b.x-a.x,b.z-a.z))
      if(b.adj.length>2 || Math.abs(rel)>0.38)return {dir:rel>0.2?1:rel< -0.2?-1:0,junction:true}
      if(distance>140)break
      edgeA=edgeB;edgeB=next
    }
    return {dir:0,junction:false}
  }

  private stepHopAndGlide(dt: number, input: Input, hasJuice: boolean) {
    this.gliding = false
    if (input.up && this.hopY <= 0.12 && hasJuice) {
      this.hopV = 11.2
      this.glideFuel = 1.65
    }
    if (input.up && this.hopY > 0.25 && this.hopV <= 0.5 && this.glideFuel > 0 && hasJuice) {
      this.gliding = true
      this.glideFuel = Math.max(0, this.glideFuel - dt)
      this.hopV = Math.max(-2.6, this.hopV - 8.5 * dt)
    } else {
      this.hopV -= 25 * dt
    }
    if (input.down && this.hopY > 0) this.hopV -= 24 * dt
    this.hopY = Math.max(0, this.hopY + this.hopV * dt)
    if (this.hopY === 0) {
      this.hopV = Math.max(0, this.hopV)
      this.glideFuel = 1.65
    }
  }

  update(dt: number, input: Input, world: World, hasJuice: boolean) {
    const s = this.spec
    this.impact = 0; this.apex = false; this.curbScrape = false
    const power = this.limping ? 0.2 : hasJuice ? 1 : 0.4
    const cap = this.limping ? 0.18 : hasJuice ? 1 : 0.45
    this.boosting = false
    let burn = 0.02

    if (this.mode === 'mag') {
      const oldA=this.edgeA, oldB=this.edgeB, oldS=this.edgeS, oldX=this.pos.x, oldZ=this.pos.z
      const steer = Math.abs(input.steer)>(this.steerLatch ? 0.14 : 0.2) ? Math.sign(input.steer) : 0
      this.turnMemory=Math.max(0,this.turnMemory-dt)
      if(steer){this.turnRequest=steer;this.turnMemory=6}
      else if(!this.turnMemory)this.turnRequest=0
      const boost = !this.limping && ((input.boost && hasJuice && input.throttle > 0) || this.overclocking)
      this.boosting = boost
      const top = this.overclocking ? OVERCLOCK_SPEED : s.maxSpeed * 1.1 * cap * (boost ? s.boost : 1)
      this.speed += input.throttle * s.accel * 1.1 * power * (boost ? s.boost * 1.4 : 1) * dt
      burn += input.throttle * (boost ? 2.2 : 0.7)
      if (input.brake === 0) {
        this.reverseLatch = false
        this.brakeHold = 0
      }
      if (input.brake > 0 && !this.reverseLatch) {
        if (this.speed > 0.6) {
          this.speed = Math.max(0, this.speed - s.accel * 2.1 * dt)
          this.brakeHold = 0
        } else {
          this.speed = 0
          this.brakeHold += dt
          // Require holding brake at a stop for 0.45s (with no throttle) before executing a 180 flip.
          if (this.brakeHold >= 0.45 && input.throttle === 0) {
            this.reverseLatch = true
            this.brakeHold = 0
            const t = this.edgeA
            this.edgeA = this.edgeB
            this.edgeB = t
            const na = world.city.nodes[this.edgeA], nb = world.city.nodes[this.edgeB]
            this.edgeS = Math.hypot(nb.x - na.x, nb.z - na.z) - this.edgeS
            this.speed = 0
            this.sway = -this.sway
            this.laneIndex = 2 - this.laneIndex
            this.swayV = 0
          }
        }
      }
      this.speed *= Math.pow(0.8, dt)
      if (this.speed > top) this.speed += (top - this.speed) * Math.min(1, dt * 2)
      this.speed = this.overclocking ? OVERCLOCK_SPEED : Math.max(this.speed, 0)
      this.nextNode = this.chooseNext(world, this.turnRequest)
      let remaining = this.speed * dt
      const nodes = world.city.nodes
      for (let guard = 0; guard < 20; guard++) {
        const a = nodes[this.edgeA], b = nodes[this.edgeB]
        const len = Math.hypot(b.x - a.x, b.z - a.z)
        if (this.edgeS + remaining < len) { this.edgeS += remaining; break }
        remaining -= len - this.edgeS
        const next = this.chooseNext(world, this.turnRequest)
        const c = nodes[next]
        const signedTurn = wrap(Math.atan2(c.x-b.x,c.z-b.z)-Math.atan2(b.x-a.x,b.z-a.z))
        const turn = Math.abs(signedTurn)
        if(turn>0.35) {
          if(this.speed>24)this.apex=true
          // Magnetic corner assist sheds speed smoothly rather than ejecting the player.
          const cornerSpeed=next===this.edgeA?10:Math.max(16,38/Math.sqrt(turn))
          const before=this.speed
          this.speed=Math.min(this.speed,cornerSpeed)
          remaining*=this.speed/Math.max(before,0.001)
        }
        // A junction on the wrong side must not swallow the queued turn.
        if(b.adj.length>2 && turn>0.2 && Math.sign(signedTurn)===this.turnRequest){this.turnRequest=0;this.turnMemory=0}
        this.edgeA = this.edgeB
        this.edgeB = next
        this.edgeS = 0
      }
      if ((this.mode as FlightMode) === 'free') { this.mesh.position.copy(this.pos); return }
      const a = nodes[this.edgeA], b = nodes[this.edgeB]
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const t = this.edgeS / len
      const target = Math.atan2(b.x - a.x, b.z - a.z)
      const diff = wrap(target - this.heading)
      this.heading += diff * Math.min(1, dt * 10)

      if(steer && steer!==this.steerLatch) {
        const prevLane = this.laneIndex
        this.laneIndex=Math.max(0,Math.min(2,this.laneIndex-steer))
        if (this.laneIndex !== prevLane) this.shuntRoll += steer * 0.18
      }
      this.steerLatch=steer
      const oldSway=this.sway
      const chassisHalfWidth=this.mesh.userData.halfW as number
      const laneWidth=laneOffset(Math.min(a.width??5,b.width??5),chassisHalfWidth)
      this.sway += (((1-this.laneIndex)*laneWidth)-this.sway)*(1-Math.exp(-24*dt))
      this.swayV=(this.sway-oldSway)/Math.max(dt,0.001)
      if ((this.laneIndex === 0 || this.laneIndex === 2) && laneWidth > 0.25 && this.speed > 26 && Math.abs(Math.abs(this.sway) - laneWidth) < 0.18) {
        this.curbScrape = true
      }
      const lx = Math.cos(target), lz = -Math.sin(target)
      this.pos.x = a.x + (b.x - a.x) * t + lx * this.sway
      this.pos.z = a.z + (b.z - a.z) * t + lz * this.sway
      this.bank += (Math.max(-0.7, Math.min(0.7, -diff * 1.2 - this.swayV * 0.06)) - this.bank) * Math.min(1, dt * 9)

      this.stepHopAndGlide(dt, input, hasJuice)
      const railY=(a.y??0)*(1-t)+(b.y??0)*t
      const surfaceY=world.surfaceHeightAt(this.pos.x,this.pos.z,railY)
      const hoverY = surfaceY + (hasJuice ? HOVER : 0.55) + this.hopY + Math.sin(performance.now() / 300) * 0.05
      this.pos.y = Math.max(surfaceY+.65,this.pos.y + (hoverY - this.pos.y) * Math.min(1, dt * (this.hopY > 0 ? 22 : 6)))
      this.vel.set(Math.sin(this.heading) * this.speed, Math.cos(this.heading) * this.speed)
      if(world.hitBuilding(this.pos.x,this.pos.z,this.pos.y-0.5)>=0) {
        const cx=a.x+(b.x-a.x)*t, cz=a.z+(b.z-a.z)*t
        if(world.hitBuilding(cx,cz,this.pos.y-0.5)<0){
          this.pos.x=cx;this.pos.z=cz;this.sway=this.swayV=0;this.laneIndex=1
        } else {
          this.impact=Math.min(12,this.speed);this.speed=0;this.vel.set(0,0)
          this.edgeA=oldA;this.edgeB=oldB;this.edgeS=oldS;this.pos.x=oldX;this.pos.z=oldZ
        }
      }
    } else {
      const spd = this.vel.length()
      const turnScale = 0.55 + 0.45 * Math.min(1, spd / 10)
      this.heading += input.steer * s.turn * turnScale * dt
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading)
      const boost = !this.limping && ((input.boost && hasJuice && input.throttle > 0) || this.overclocking)
      this.boosting = boost
      const thrust = input.throttle * s.accel * power * (boost ? s.boost * 1.6 : 1)
      this.vel.x += fx * thrust * dt
      this.vel.y += fz * thrust * dt
      burn += input.throttle * (boost ? 2.6 : 1)
      let fwd = this.vel.x * fx + this.vel.y * fz
      let lat = this.vel.x * fz - this.vel.y * fx
      lat *= Math.pow(world.isWater(this.pos.x,this.pos.z) ? 0.94 : s.drift * 0.35, dt)
      fwd *= Math.pow(0.82, dt)
      if (input.brake > 0) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), s.accel * 1.6 * input.brake * dt)
      const top = this.overclocking ? OVERCLOCK_SPEED : s.maxSpeed * (boost ? s.boost : 1) * cap
      if(this.overclocking) fwd=OVERCLOCK_SPEED
      if (fwd > top) fwd += (top - fwd) * Math.min(1, dt * 2)
      if (fwd < -top * 0.3) fwd = -top * 0.3
      this.vel.set(fx * fwd + fz * lat, fz * fwd - fx * lat)
      this.bank += (Math.max(-0.6, Math.min(0.6, -input.steer * 0.35 - lat * 0.03)) - this.bank) * Math.min(1, dt * 5)

      const ground=world.groundHeightAt(this.pos.x,this.pos.z,this.pos.y)+HOVER
      if(this.testFlight && hasJuice) {
        this.hopY = 0; this.hopV = 0; this.gliding = false
        this.targetAlt=Math.max(ground,Math.min(ground+250,this.targetAlt+((input.up?1:0)-(input.down?1:0))*22*dt))
      } else {
        this.stepHopAndGlide(dt, input, hasJuice)
        this.targetAlt=ground + this.hopY
      }
      const nx = this.pos.x + this.vel.x * dt
      const nz = this.pos.z + this.vel.y * dt
      const hit = world.hitBuilding(nx, nz, this.pos.y - 0.5)
      if (hit >= 0) {
        this.impact = spd
        const hx = world.hitBuilding(nx, this.pos.z, this.pos.y - 0.5) >= 0
        const hz = world.hitBuilding(this.pos.x, nz, this.pos.y - 0.5) >= 0
        if (!hx) { this.pos.x = nx; this.vel.y *= -0.25; this.vel.x *= 0.7 }
        else if (!hz) { this.pos.z = nz; this.vel.x *= -0.25; this.vel.y *= 0.7 }
        else this.vel.multiplyScalar(-0.3)
        this.bump = Math.min(1, this.bump + spd / 25)
      } else {
        this.pos.x = nx
        this.pos.z = nz
      }
      if (world.city.procedural) {
        const lim = world.city.radius * 1.25
        const r = Math.hypot(this.pos.x, this.pos.z)
        if (r > lim) {
          this.pos.x *= lim / r
          this.pos.z *= lim / r
          this.vel.multiplyScalar(0.5)
        }
      }
      const floor = world.groundHeightAt(this.pos.x, this.pos.z, this.pos.y) + HOVER
      const desired=this.testFlight?Math.max(floor,this.targetAlt):floor + this.hopY
      let y = desired + Math.sin(performance.now() / 300) * 0.06
      if(y<this.pos.y && world.hitBuilding(this.pos.x,this.pos.z,y-0.5)>=0)y=this.pos.y
      this.pos.y = Math.max(floor-.06,this.pos.y + (y - this.pos.y) * Math.min(1, dt * (this.hopY > 0 ? 18 : 3)))
      this.speed = this.vel.length()
      this.nextNode = -1
    }

    this.bump = Math.max(0, this.bump - dt * 2)
    this.shuntRoll *= Math.exp(-9 * dt)
    this.shuntPitch *= Math.exp(-8 * dt)
    this.lastBurn = burn + (this.gliding ? 0.35 : 0)
    this.mesh.position.copy(this.pos)
    this.mesh.rotation.set(0, this.heading, 0)
    this.mesh.rotateZ(this.bank + this.shuntRoll)
    const hopPitch = this.hopY > 0.1 ? Math.max(-0.18, Math.min(0.24, this.hopV * 0.022 + (this.gliding ? 0.1 : 0))) : 0
    this.mesh.rotateX(-Math.min(0.12, input.throttle * 0.08) - hopPitch + this.shuntPitch + (this.bump > 0 ? Math.sin(performance.now() / 30) * this.bump * 0.1 : 0))
    const flame = this.mesh.getObjectByName('flame')
    if (flame) {
      flame.visible = this.boosting || this.gliding
      flame.scale.setScalar((this.gliding ? 0.65 : 0.8) + Math.random() * 0.5)
    }
    const pad = this.mesh.getObjectByName('pad') as THREE.Mesh | undefined
    if (pad) {
      pad.position.y = (world.surfaceHeightAt(this.pos.x,this.pos.z,this.pos.y-1.3)-this.pos.y + 0.1) / VEHICLE_SCALE
      const shadow=this.mesh.getObjectByName('contact-shadow');if(shadow)shadow.position.y=pad.position.y-0.01
      ;(pad.material as THREE.MeshBasicMaterial).opacity = (hasJuice ? (this.gliding ? 0.14 : 0.055) + Math.random() * 0.015 : 0.04) * (this.spec.kind === 'board' ? 0.25 : 1)
    }
  }
}

