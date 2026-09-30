import * as THREE from 'three'
import type { World } from './world'

interface Enemy {
  mesh: THREE.Group
  pos: THREE.Vector3
  health: number
  cooldown: number
  alive: boolean
}

interface Bolt {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  hostile: boolean
}

function gangDrone(seed: number) {
  const g = new THREE.Group()
  const armor = new THREE.MeshStandardMaterial({ color: seed % 2 ? 0x6b1638 : 0x321873, metalness: 0.75, roughness: 0.28 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x090714, metalness: 0.6, roughness: 0.3 })
  const red = new THREE.MeshBasicMaterial({ color: 0xff244f })
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(1.05, 0), armor)
  body.scale.set(1.15, 0.7, 1)
  body.position.y = 1.25
  g.add(body)
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.08), red)
  eye.position.set(0, 1.35, 0.78)
  g.add(eye)
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.5), dark)
    wing.position.set(side * 1.1, 1.25, 0)
    wing.rotation.z = side * 0.18
    g.add(wing)
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.8, 8), red)
    gun.rotation.x = Math.PI / 2
    gun.position.set(side * 1.1, 1.05, 0.45)
    g.add(gun)
  }
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.07, 6, 24),
    new THREE.MeshBasicMaterial({ color: 0xff244f, transparent: true, opacity: 0.65 }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.35
  g.add(ring)
  return g
}

/** Projectile combat and roaming gang drones. Q/FIRE launches plasma from any ride or on foot. */
export class CombatSystem {
  group = new THREE.Group()
  private world: World
  private enemies: Enemy[] = []
  private bolts: Bolt[] = []
  private fireCooldown = 0
  private spawnCursor = 0

  constructor(world: World) {
    this.world = world
    this.ensurePopulation()
  }

  ensurePopulation() {
    const target = Math.min(18, Math.max(8, Math.floor(this.world.city.nodes.length / 300)))
    let attempts = 0
    while (this.enemies.length < target && attempts++ < target * 20) {
      const seed = ++this.spawnCursor
      const candidates = this.world.city.nodes.filter((n) => n.main && n.adj.length)
      if (!candidates.length) break
      const n = candidates[(seed * 3571) % candidates.length]
      if (Math.hypot(n.x, n.z) < 140) continue
      const mesh = gangDrone(seed)
      const pos = new THREE.Vector3(n.x, 2.5, n.z)
      mesh.position.copy(pos)
      this.group.add(mesh)
      this.enemies.push({ mesh, pos, health: 3, cooldown: 1 + (seed % 5) * 0.4, alive: true })
    }
  }

  fire(origin: THREE.Vector3, heading: number, onFoot: boolean) {
    if (this.fireCooldown > 0) return false
    this.fireCooldown = onFoot ? 0.22 : 0.13
    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(onFoot ? 0.12 : 0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x50ffff }),
    )
    mesh.position.copy(origin).addScaledVector(dir, onFoot ? 1 : 2.5)
    mesh.position.y += onFoot ? 1.25 : 0.6
    this.group.add(mesh)
    this.bolts.push({ mesh, vel: dir.multiplyScalar(onFoot ? 85 : 125), life: 1.8, hostile: false })
    return true
  }

  private enemyFire(enemy: Enemy, target: THREE.Vector3) {
    const dir = target.clone().sub(enemy.pos).normalize()
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), new THREE.MeshBasicMaterial({ color: 0xff244f }))
    mesh.position.copy(enemy.pos)
    this.group.add(mesh)
    this.bolts.push({ mesh, vel: dir.multiplyScalar(42), life: 3, hostile: true })
  }

  update(dt: number, actor: THREE.Vector3, reward: (amount: number) => void, hurt: () => void) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt)
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue
      const dx = actor.x - enemy.pos.x, dz = actor.z - enemy.pos.z
      const dist = Math.hypot(dx, dz)
      if (dist < 150) {
        enemy.mesh.rotation.y = Math.atan2(dx, dz)
        if (dist > 24) {
          const step = Math.min(5.5 * dt, dist - 24)
          const nx = enemy.pos.x + dx / dist * step, nz = enemy.pos.z + dz / dist * step
          if (this.world.hitBuilding(nx, nz, enemy.pos.y) < 0) {
            enemy.pos.x = nx
            enemy.pos.z = nz
          }
        }
        enemy.cooldown -= dt
        if (enemy.cooldown <= 0 && dist < 105) {
          this.enemyFire(enemy, actor.clone().add(new THREE.Vector3(0, 1, 0)))
          enemy.cooldown = 1.5 + Math.random() * 1.3
        }
      }
      enemy.pos.y = 2.5 + Math.sin(performance.now() * 0.004 + enemy.pos.x) * 0.25
      enemy.mesh.position.copy(enemy.pos)
      enemy.mesh.children[enemy.mesh.children.length - 1].rotation.z += dt * 2
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]
      bolt.life -= dt
      bolt.mesh.position.addScaledVector(bolt.vel, dt)
      let remove = bolt.life <= 0 || this.world.hitBuilding(bolt.mesh.position.x, bolt.mesh.position.z, bolt.mesh.position.y) >= 0
      if (bolt.hostile) {
        if (bolt.mesh.position.distanceTo(actor) < 2.1) {
          hurt()
          remove = true
        }
      } else {
        for (const enemy of this.enemies) {
          if (!enemy.alive || bolt.mesh.position.distanceTo(enemy.pos) > 2.2) continue
          enemy.health--
          remove = true
          if (enemy.health <= 0) {
            enemy.alive = false
            enemy.mesh.visible = false
            reward(150)
          }
          break
        }
      }
      if (remove) {
        this.group.remove(bolt.mesh)
        bolt.mesh.geometry.dispose()
        ;(bolt.mesh.material as THREE.Material).dispose()
        this.bolts.splice(i, 1)
      }
    }
  }

  get remaining() { return this.enemies.filter((e) => e.alive).length }

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
