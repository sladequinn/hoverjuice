import * as THREE from 'three'
import type { World } from './world'

interface Agent {
  mesh: THREE.Group
  a: number
  b: number
  previous: number
  distance: number
  speed: number
  seed: number
}

const PALETTE = [0xff2e88, 0x00f0ff, 0xffc400, 0x8a5cff, 0xff5d2e, 0x39ff6a]

function trafficCar(seed: number) {
  const root = new THREE.Group()
  const color = PALETTE[seed % PALETTE.length]
  const body = new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.24 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x090b18, metalness: 0.75, roughness: 0.2 })
  const glow = new THREE.MeshBasicMaterial({ color })
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    root.add(mesh)
  }
  add(new THREE.BoxGeometry(1.45, 0.42, 2.8), body, 0, 0.45, 0)
  add(new THREE.BoxGeometry(1.1, 0.38, 1.25), dark, 0, 0.83, -0.2)
  add(new THREE.BoxGeometry(1.5, 0.055, 2.65), glow, 0, 0.2, 0)
  add(new THREE.BoxGeometry(0.35, 0.09, 0.06), new THREE.MeshBasicMaterial({ color: 0xf4fdff }), 0.42, 0.49, 1.42)
  add(new THREE.BoxGeometry(0.35, 0.09, 0.06), new THREE.MeshBasicMaterial({ color: 0xf4fdff }), -0.42, 0.49, 1.42)
  add(new THREE.BoxGeometry(0.8, 0.07, 0.06), new THREE.MeshBasicMaterial({ color: 0xff164c }), 0, 0.48, -1.42)
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  pad.rotation.x = -Math.PI / 2
  pad.scale.set(1.1, 1.75, 1)
  pad.position.y = 0.08
  root.add(pad)
  return root
}

/** Lightweight ambient hover traffic that follows the live road graph. */
export class TrafficSystem {
  group = new THREE.Group()
  private agents: Agent[] = []
  private world: World

  constructor(world: World) {
    this.world = world
    this.ensurePopulation()
  }

  private spawn(seed: number) {
    const nodes = this.world.city.nodes
    if (nodes.length < 2) return
    let a = (seed * 7919) % nodes.length
    for (let tries = 0; tries < nodes.length && (!nodes[a].main || !nodes[a].adj.length); tries++) a = (a + 37) % nodes.length
    const b = nodes[a].adj[seed % nodes[a].adj.length]
    if (b === undefined) return
    const mesh = trafficCar(seed)
    this.group.add(mesh)
    this.agents.push({ mesh, a, b, previous: a, distance: 0, speed: 11 + (seed % 9), seed })
  }

  ensurePopulation() {
    const desired = Math.min(42, Math.max(16, Math.floor(this.world.city.nodes.length / 110)))
    while (this.agents.length < desired) this.spawn(this.agents.length + 1)
  }

  update(dt: number, player: THREE.Vector3) {
    const nodes = this.world.city.nodes
    for (const car of this.agents) {
      const a = nodes[car.a], b = nodes[car.b]
      if (!a || !b) continue
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const nearPlayer = Math.hypot(player.x - car.mesh.position.x, player.z - car.mesh.position.z) < 11
      const wanted = nearPlayer ? 4 : 11 + (car.seed % 9)
      car.speed += (wanted - car.speed) * Math.min(1, dt * 2)
      car.distance += car.speed * dt
      while (car.distance >= len) {
        car.distance -= len
        const arrived = car.b
        const opts = nodes[arrived].adj.filter((n) => n !== car.a)
        car.previous = car.a
        car.a = arrived
        car.b = opts.length ? opts[(car.seed + Math.floor(performance.now() / 5000)) % opts.length] : car.previous
        car.seed = (car.seed * 16807) % 2147483647
        break
      }
      const na = nodes[car.a], nb = nodes[car.b]
      const edgeLen = Math.hypot(nb.x - na.x, nb.z - na.z) || 1
      const t = Math.min(1, car.distance / edgeLen)
      const heading = Math.atan2(nb.x - na.x, nb.z - na.z)
      const lane = car.seed % 2 ? 2.2 : -2.2
      car.mesh.position.set(
        na.x + (nb.x - na.x) * t + Math.cos(heading) * lane,
        1.15 + Math.sin(performance.now() * 0.004 + car.seed) * 0.08,
        na.z + (nb.z - na.z) * t - Math.sin(heading) * lane,
      )
      car.mesh.rotation.y = heading
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }
}
