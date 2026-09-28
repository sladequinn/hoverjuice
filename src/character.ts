import * as THREE from 'three'
import type { World } from './world'

export interface MaskSpec {
  id: string
  name: string
  price: number
  blurb: string
}

export const MASKS: MaskSpec[] = [
  { id: 'none', name: 'Bare Face', price: 0, blurb: 'Brave. Or stupid.' },
  { id: 'rooster', name: 'Rooster', price: 0, blurb: 'The classic. Wakes the whole block.' },
  { id: 'pig', name: 'Pig', price: 0, blurb: 'Snout first, questions later.' },
  { id: 'rabbit', name: 'Rabbit', price: 800, blurb: 'Quick feet, long ears, twitchy nose.' },
  { id: 'owl', name: 'Owl', price: 1200, blurb: 'Sees every delivery. Judges most of them.' },
  { id: 'frog', name: 'Frog', price: 1500, blurb: 'Bulging eyes for the Cyan-ade stare.' },
  { id: 'bear', name: 'Bear', price: 2500, blurb: 'Hug-shaped menace.' },
  { id: 'cat', name: 'Alley Cat', price: 3000, blurb: 'Nine lives, zero traffic tickets.' },
  { id: 'duck', name: 'Duck', price: 3500, blurb: 'Waddles into the VIP lounge anyway.' },
  { id: 'panda', name: 'Panda', price: 5000, blurb: 'Endangered? Not on these streets.' },
  { id: 'horse', name: 'Horse', price: 6000, blurb: 'Long face for long shifts.' },
  { id: 'wolf', name: 'Wolf', price: 8000, blurb: 'Runs with the courier pack.' },
  { id: 'tiger', name: 'Tiger', price: 12000, blurb: 'Stripes earned the hard way.' },
  { id: 'fox', name: 'Kitsune', price: 18000, blurb: 'Nine-tailed shrine fox, painted in blood red.' },
  { id: 'shark', name: 'Shark', price: 25000, blurb: 'Smells HJ-77 from a mile away.' },
  { id: 'skull', name: 'Skull', price: 40000, blurb: 'Memento mori, express shipping.' },
  { id: 'oni', name: 'Oni', price: 60000, blurb: 'Demon of the night market.' },
  { id: 'robot', name: 'Chrome Visor', price: 90000, blurb: 'Full-face chrome with a scanning visor.' },
  { id: 'unicorn', name: 'Unicorn', price: 150000, blurb: 'Rare. Glittery. Deeply unsettling.' },
]

const mats = new Map<number, THREE.Material>()
function mat(color: number, emissive = false) {
  const key = color + (emissive ? 0x1000000 : 0)
  let m = mats.get(key)
  if (!m) {
    m = emissive
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, flatShading: true })
    mats.set(key, m)
  }
  return m
}

type V3 = [number, number, number]
function part(g: THREE.Group, geo: THREE.BufferGeometry, color: number, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], glow = false) {
  const m = new THREE.Mesh(geo, mat(color, glow))
  m.position.set(...pos)
  m.rotation.set(...rot)
  m.scale.set(...scale)
  g.add(m)
  return m
}
const sphere = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d)
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const cone = (r: number, h: number, s = 6) => new THREE.ConeGeometry(r, h, s)
const cyl = (rt: number, rb: number, h: number, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s)

function eyes(g: THREE.Group, color: number, y: number, z: number, spread = 0.08, r = 0.035) {
  part(g, sphere(r, 0), color, [spread, y, z])
  part(g, sphere(r, 0), color, [-spread, y, z])
}

/** Builds a mask centred on the head origin, facing +z. Head radius is roughly 0.22. */
export function buildMask(id: string) {
  const g = new THREE.Group()
  const skin = 0xf2c7a5
  switch (id) {
    case 'none':
      part(g, sphere(0.21), skin, [0, 0, 0])
      eyes(g, 0x111111, 0.03, 0.18, 0.07, 0.025)
      part(g, box(0.36, 0.1, 0.4), 0x2a1a12, [0, 0.16, -0.02])
      break
    case 'rooster':
      part(g, sphere(0.24), 0xf6f1e8, [0, 0, 0])
      part(g, cone(0.07, 0.2, 5), 0xffc21a, [0, -0.02, 0.28], [Math.PI / 2, 0, 0])
      for (let i = 0; i < 3; i++) part(g, sphere(0.06, 0), 0xe0162b, [0, 0.24 + (i === 1 ? 0.04 : 0), -0.08 + i * 0.08])
      part(g, sphere(0.05, 0), 0xe0162b, [0, -0.13, 0.2], [0, 0, 0], [1, 1.5, 1])
      eyes(g, 0x111111, 0.06, 0.2, 0.1)
      break
    case 'pig':
      part(g, sphere(0.24), 0xff9fb8, [0, 0, 0])
      part(g, cyl(0.08, 0.09, 0.08, 10), 0xff7aa0, [0, -0.03, 0.24], [Math.PI / 2, 0, 0])
      part(g, sphere(0.018, 0), 0x5a1830, [0.03, -0.03, 0.285])
      part(g, sphere(0.018, 0), 0x5a1830, [-0.03, -0.03, 0.285])
      part(g, cone(0.07, 0.12, 3), 0xff7aa0, [0.14, 0.2, 0], [0, 0, -0.5])
      part(g, cone(0.07, 0.12, 3), 0xff7aa0, [-0.14, 0.2, 0], [0, 0, 0.5])
      eyes(g, 0x111111, 0.07, 0.2)
      break
    case 'rabbit':
      part(g, sphere(0.23), 0xfafafa, [0, 0, 0])
      part(g, box(0.07, 0.36, 0.04), 0xfafafa, [0.07, 0.36, -0.02], [0, 0, -0.12])
      part(g, box(0.07, 0.36, 0.04), 0xfafafa, [-0.07, 0.36, -0.02], [0, 0, 0.12])
      part(g, box(0.035, 0.26, 0.045), 0xffa6c9, [0.075, 0.36, -0.01], [0, 0, -0.12])
      part(g, box(0.035, 0.26, 0.045), 0xffa6c9, [-0.075, 0.36, -0.01], [0, 0, 0.12])
      part(g, sphere(0.03, 0), 0xff5fa2, [0, -0.02, 0.23])
      part(g, box(0.06, 0.06, 0.02), 0xffffff, [0, -0.1, 0.21])
      eyes(g, 0xd6135f, 0.06, 0.19)
      break
    case 'owl':
      part(g, sphere(0.25), 0x7a5230, [0, 0, 0])
      part(g, cyl(0.075, 0.075, 0.03, 12), 0xffd23f, [0.09, 0.04, 0.22], [Math.PI / 2, 0, 0])
      part(g, cyl(0.075, 0.075, 0.03, 12), 0xffd23f, [-0.09, 0.04, 0.22], [Math.PI / 2, 0, 0])
      eyes(g, 0x111111, 0.04, 0.245, 0.09, 0.03)
      part(g, cone(0.03, 0.09, 4), 0xff8a00, [0, -0.06, 0.25], [Math.PI / 2 + 0.4, 0, 0])
      part(g, cone(0.05, 0.14, 4), 0x4f3319, [0.15, 0.24, 0], [0, 0, -0.35])
      part(g, cone(0.05, 0.14, 4), 0x4f3319, [-0.15, 0.24, 0], [0, 0, 0.35])
      break
    case 'frog':
      part(g, sphere(0.24), 0x3fcf4a, [0, -0.02, 0], [0, 0, 0], [1.1, 0.85, 1])
      part(g, sphere(0.075), 0x3fcf4a, [0.1, 0.18, 0.08])
      part(g, sphere(0.075), 0x3fcf4a, [-0.1, 0.18, 0.08])
      part(g, sphere(0.045, 0), 0xfff27a, [0.1, 0.19, 0.14])
      part(g, sphere(0.045, 0), 0xfff27a, [-0.1, 0.19, 0.14])
      eyes(g, 0x111111, 0.19, 0.18, 0.1, 0.022)
      part(g, box(0.26, 0.015, 0.02), 0x1b5e20, [0, -0.08, 0.215])
      break
    case 'bear':
      part(g, sphere(0.25), 0x7b4a24, [0, 0, 0])
      part(g, sphere(0.07), 0x7b4a24, [0.17, 0.19, 0])
      part(g, sphere(0.07), 0x7b4a24, [-0.17, 0.19, 0])
      part(g, sphere(0.1), 0xd9a066, [0, -0.06, 0.18], [0, 0, 0], [1, 0.8, 0.8])
      part(g, sphere(0.035, 0), 0x1a0e06, [0, -0.02, 0.26])
      eyes(g, 0x111111, 0.07, 0.21)
      break
    case 'cat':
      part(g, sphere(0.23), 0x1c1c24, [0, 0, 0])
      part(g, cone(0.08, 0.16, 3), 0x1c1c24, [0.13, 0.22, 0], [0, 0, -0.35])
      part(g, cone(0.08, 0.16, 3), 0x1c1c24, [-0.13, 0.22, 0], [0, 0, 0.35])
      part(g, sphere(0.04, 0), 0x39ff6a, [0.08, 0.05, 0.19], [0, 0, 0], [1, 1.3, 0.5], true)
      part(g, sphere(0.04, 0), 0x39ff6a, [-0.08, 0.05, 0.19], [0, 0, 0], [1, 1.3, 0.5], true)
      part(g, sphere(0.022, 0), 0xff7aa0, [0, -0.04, 0.225])
      for (const s of [1, -1]) for (const dy of [-0.05, -0.08]) part(g, box(0.18, 0.006, 0.006), 0xeeeeee, [s * 0.12, dy, 0.19], [0, 0, s * (dy + 0.065) * 3])
      break
    case 'duck':
      part(g, sphere(0.23), 0xffe23a, [0, 0, 0])
      part(g, box(0.18, 0.04, 0.16), 0xff8a00, [0, -0.05, 0.25])
      eyes(g, 0x111111, 0.07, 0.2)
      part(g, box(0.03, 0.08, 0.1), 0xffe23a, [0, 0.25, -0.02], [0.4, 0, 0])
      break
    case 'panda':
      part(g, sphere(0.25), 0xf7f7f7, [0, 0, 0])
      part(g, sphere(0.07), 0x111111, [0.17, 0.19, 0])
      part(g, sphere(0.07), 0x111111, [-0.17, 0.19, 0])
      part(g, sphere(0.06, 0), 0x111111, [0.09, 0.04, 0.19], [0, 0, -0.5], [1, 1.4, 0.6])
      part(g, sphere(0.06, 0), 0x111111, [-0.09, 0.04, 0.19], [0, 0, 0.5], [1, 1.4, 0.6])
      eyes(g, 0xffffff, 0.05, 0.23, 0.09, 0.015)
      part(g, sphere(0.035, 0), 0x111111, [0, -0.05, 0.24])
      break
    case 'horse':
    case 'unicorn': {
      const c = id === 'horse' ? 0x8b5a2b : 0xfdf6ff
      part(g, sphere(0.22), c, [0, 0.03, -0.02])
      part(g, box(0.18, 0.18, 0.3), c, [0, -0.07, 0.2], [0.25, 0, 0])
      part(g, box(0.19, 0.08, 0.08), id === 'horse' ? 0x3b2410 : 0xffc8f0, [0, -0.13, 0.34], [0.25, 0, 0])
      part(g, cone(0.045, 0.13, 4), c, [0.1, 0.25, -0.05], [0, 0, -0.2])
      part(g, cone(0.045, 0.13, 4), c, [-0.1, 0.25, -0.05], [0, 0, 0.2])
      part(g, box(0.05, 0.1, 0.38), id === 'horse' ? 0x2a1606 : 0xff6ad5, [0, 0.2, -0.1])
      eyes(g, 0x111111, 0.08, 0.14, 0.12)
      if (id === 'unicorn') part(g, cone(0.035, 0.3, 8), 0xffd84a, [0, 0.3, 0.1], [0.5, 0, 0], [1, 1, 1], true)
      break
    }
    case 'wolf':
      part(g, sphere(0.23), 0x7d8594, [0, 0, 0])
      part(g, cone(0.08, 0.26, 5), 0x7d8594, [0, -0.05, 0.27], [Math.PI / 2, 0, 0])
      part(g, sphere(0.03, 0), 0x111111, [0, -0.05, 0.4])
      part(g, cone(0.065, 0.18, 3), 0x5c6370, [0.12, 0.23, -0.02], [0, 0, -0.25])
      part(g, cone(0.065, 0.18, 3), 0x5c6370, [-0.12, 0.23, -0.02], [0, 0, 0.25])
      part(g, sphere(0.03, 0), 0xffd23f, [0.08, 0.06, 0.2], [0, 0, 0], [1, 0.6, 0.5], true)
      part(g, sphere(0.03, 0), 0xffd23f, [-0.08, 0.06, 0.2], [0, 0, 0], [1, 0.6, 0.5], true)
      break
    case 'tiger':
      part(g, sphere(0.24), 0xff8a1e, [0, 0, 0])
      for (const [x, y, rz] of [[0, 0.2, 0], [0.12, 0.15, -0.6], [-0.12, 0.15, 0.6], [0.2, 0, -1.3], [-0.2, 0, 1.3]] as V3[])
        part(g, box(0.03, 0.12, 0.05), 0x111111, [x, y, 0.13 - Math.abs(x) * 0.4], [0, 0, rz])
      part(g, sphere(0.1), 0xffffff, [0, -0.08, 0.17], [0, 0, 0], [1.2, 0.7, 0.8])
      part(g, sphere(0.03, 0), 0xff7aa0, [0, -0.03, 0.25])
      part(g, sphere(0.06), 0xff8a1e, [0.16, 0.18, 0])
      part(g, sphere(0.06), 0xff8a1e, [-0.16, 0.18, 0])
      eyes(g, 0x2e7d32, 0.06, 0.2)
      break
    case 'fox':
      part(g, sphere(0.22), 0xfaf5ee, [0, 0, 0])
      part(g, cone(0.09, 0.24, 4), 0xfaf5ee, [0, -0.04, 0.26], [Math.PI / 2, Math.PI / 4, 0])
      part(g, sphere(0.025, 0), 0x111111, [0, -0.04, 0.38])
      part(g, cone(0.07, 0.22, 3), 0xfaf5ee, [0.12, 0.26, -0.02], [0, 0, -0.2])
      part(g, cone(0.07, 0.22, 3), 0xfaf5ee, [-0.12, 0.26, -0.02], [0, 0, 0.2])
      part(g, cone(0.04, 0.14, 3), 0xe0162b, [0.12, 0.27, 0.01], [0, 0, -0.2])
      part(g, cone(0.04, 0.14, 3), 0xe0162b, [-0.12, 0.27, 0.01], [0, 0, 0.2])
      part(g, box(0.1, 0.02, 0.02), 0xe0162b, [0.09, 0.06, 0.2], [0, 0, 0.35])
      part(g, box(0.1, 0.02, 0.02), 0xe0162b, [-0.09, 0.06, 0.2], [0, 0, -0.35])
      part(g, box(0.03, 0.08, 0.02), 0xe0162b, [0, 0.14, 0.2])
      break
    case 'shark':
      part(g, sphere(0.24), 0x5b7fa6, [0, 0, 0])
      part(g, sphere(0.2), 0xe8eef5, [0, -0.08, 0.06], [0, 0, 0], [1, 0.6, 1])
      part(g, cone(0.08, 0.24, 3), 0x44658a, [0, 0.3, -0.05], [-0.3, 0, 0], [0.35, 1, 1])
      for (let i = -3; i <= 3; i++) part(g, cone(0.015, 0.04, 3), 0xffffff, [i * 0.03, -0.1, 0.22], [Math.PI, 0, 0])
      eyes(g, 0x111111, 0.05, 0.19, 0.14)
      break
    case 'skull':
      part(g, sphere(0.24), 0xefe8d8, [0, 0.02, 0])
      part(g, sphere(0.06, 0), 0x111111, [0.08, 0.03, 0.19], [0, 0, 0], [1, 1.1, 0.5])
      part(g, sphere(0.06, 0), 0x111111, [-0.08, 0.03, 0.19], [0, 0, 0], [1, 1.1, 0.5])
      part(g, cone(0.03, 0.05, 3), 0x111111, [0, -0.06, 0.22], [Math.PI, 0, 0])
      for (let i = -2; i <= 2; i++) part(g, box(0.025, 0.04, 0.02), 0xffffff, [i * 0.03, -0.14, 0.19])
      break
    case 'oni':
      part(g, sphere(0.24), 0xd81b3a, [0, 0, 0])
      part(g, cone(0.04, 0.2, 6), 0xf6e7c1, [0.12, 0.25, 0], [0, 0, -0.35])
      part(g, cone(0.04, 0.2, 6), 0xf6e7c1, [-0.12, 0.25, 0], [0, 0, 0.35])
      part(g, sphere(0.04, 0), 0xffe600, [0.08, 0.05, 0.2], [0, 0, 0], [1.3, 0.7, 0.5], true)
      part(g, sphere(0.04, 0), 0xffe600, [-0.08, 0.05, 0.2], [0, 0, 0], [1.3, 0.7, 0.5], true)
      part(g, box(0.2, 0.05, 0.03), 0x3a0010, [0, -0.1, 0.2])
      part(g, cone(0.02, 0.07, 3), 0xffffff, [0.06, -0.06, 0.215])
      part(g, cone(0.02, 0.07, 3), 0xffffff, [-0.06, -0.06, 0.215])
      part(g, box(0.3, 0.03, 0.04), 0x111111, [0, 0.13, 0.19], [0, 0, 0])
      break
    case 'robot':
      part(g, sphere(0.24, 2), 0xc9d2de, [0, 0, 0])
      part(g, box(0.34, 0.07, 0.1), 0x19ffe6, [0, 0.04, 0.19], [0, 0, 0], [1, 1, 1], true)
      part(g, cyl(0.01, 0.01, 0.16), 0x9aa3b0, [0.14, 0.28, 0])
      part(g, sphere(0.025, 0), 0xff2e88, [0.14, 0.37, 0], [0, 0, 0], [1, 1, 1], true)
      part(g, box(0.1, 0.02, 0.02), 0x2b3440, [0, -0.1, 0.22])
      break
  }
  return g
}

const JACKET = 0xcfc6d8
const SLEEVE = 0xff2e88
const JEANS = 0x2a3a7a
const skinTone = 0xf2c7a5

/** Low-poly courier with pivoting limbs. Feet at y=0, facing +z. */
export function buildCharacter(maskId: string) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const limb = (x: number, y: number, len: number, w: number, color: number, lower: number) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, 0)
    const m = new THREE.Mesh(box(w, len, w), mat(color))
    m.position.y = -len / 2
    pivot.add(m)
    const end = new THREE.Mesh(box(w * 1.05, 0.12, w * 1.3), mat(lower))
    end.position.set(0, -len, w * 0.15)
    pivot.add(end)
    body.add(pivot)
    return pivot
  }
  const legL = limb(0.1, 0.9, 0.82, 0.15, JEANS, 0x151515)
  const legR = limb(-0.1, 0.9, 0.82, 0.15, JEANS, 0x151515)
  const torso = new THREE.Mesh(box(0.42, 0.56, 0.24), mat(JACKET))
  torso.position.y = 1.18
  body.add(torso)
  const stripe = new THREE.Mesh(box(0.43, 0.06, 0.25), mat(SLEEVE))
  stripe.position.y = 0.95
  body.add(stripe)
  const letter = new THREE.Mesh(box(0.1, 0.12, 0.02), mat(SLEEVE))
  letter.position.set(0.1, 1.3, 0.125)
  body.add(letter)
  const armL = limb(0.28, 1.42, 0.62, 0.12, SLEEVE, skinTone)
  const armR = limb(-0.28, 1.42, 0.62, 0.12, SLEEVE, skinTone)
  const neck = new THREE.Mesh(cyl(0.06, 0.07, 0.1), mat(skinTone))
  neck.position.y = 1.5
  body.add(neck)
  const head = new THREE.Group()
  head.position.y = 1.72
  head.add(buildMask(maskId))
  body.add(head)
  root.userData = { legL, legR, armL, armR, body, head }
  return root
}

export function setCharacterMask(root: THREE.Group, maskId: string) {
  const head = root.userData.head as THREE.Group
  head.clear()
  head.add(buildMask(maskId))
}

/** Animate limbs: phase in radians, amount 0..1 */
export function poseCharacter(root: THREE.Group, phase: number, amount: number, air = false) {
  const u = root.userData
  const s = Math.sin(phase) * 0.9 * amount
  if (air) {
    u.legL.rotation.x = -0.6
    u.legR.rotation.x = 0.3
    u.armL.rotation.x = -2.4
    u.armR.rotation.x = -2.2
  } else {
    u.legL.rotation.x = s
    u.legR.rotation.x = -s
    u.armL.rotation.x = -s * 0.9
    u.armR.rotation.x = s * 0.9
  }
  u.body.position.y = Math.abs(Math.cos(phase)) * 0.06 * amount
  u.body.rotation.x = amount * 0.18
}

export interface FootInput {
  moveX: number
  moveY: number
  sprint: boolean
  jump: boolean
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export class Character {
  mesh: THREE.Group
  pos = new THREE.Vector3()
  vel = new THREE.Vector2()
  heading = 0
  yVel = 0
  grounded = true
  private phase = 0

  constructor(maskId: string) {
    this.mesh = buildCharacter(maskId)
    this.mesh.visible = false
  }

  setMask(id: string) {
    setCharacterMask(this.mesh, id)
  }

  get speed() {
    return this.vel.length()
  }

  update(dt: number, input: FootInput, world: World, camYaw: number) {
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw)
    const rx = -fz, rz = fx
    let dx = fx * input.moveY + rx * input.moveX
    let dz = fz * input.moveY + rz * input.moveX
    const mag = Math.min(1, Math.hypot(dx, dz))
    if (mag > 0.05) {
      const l = Math.hypot(dx, dz)
      dx /= l
      dz /= l
      const target = Math.atan2(dx, dz)
      this.heading += wrap(target - this.heading) * Math.min(1, dt * 14)
    }
    const top = (input.sprint ? 10.5 : 6.5) * mag
    const want = new THREE.Vector2(Math.sin(this.heading) * top, Math.cos(this.heading) * top)
    const k = this.grounded ? 12 : 3
    this.vel.lerp(want, Math.min(1, dt * k))

    if (input.jump && this.grounded) {
      this.yVel = 7.5
      this.grounded = false
    }
    this.yVel -= 22 * dt
    const nx = this.pos.x + this.vel.x * dt
    const nz = this.pos.z + this.vel.y * dt
    const y = this.pos.y + 0.4
    if (world.hitBuilding(nx, nz, y) < 0) {
      this.pos.x = nx
      this.pos.z = nz
    } else if (world.hitBuilding(nx, this.pos.z, y) < 0) {
      this.pos.x = nx
      this.vel.y = 0
    } else if (world.hitBuilding(this.pos.x, nz, y) < 0) {
      this.pos.z = nz
      this.vel.x = 0
    } else this.vel.set(0, 0)
    const floor = world.groundHeightAt(this.pos.x, this.pos.z, this.pos.y)
    this.pos.y += this.yVel * dt
    if (this.pos.y <= floor) {
      this.pos.y = floor
      this.yVel = 0
      this.grounded = true
    } else if (this.pos.y > floor + 0.05) this.grounded = false

    const spd = this.vel.length()
    this.phase += dt * (4 + spd * 1.3)
    poseCharacter(this.mesh, this.phase, Math.min(1, spd / 6), !this.grounded)
    this.mesh.position.copy(this.pos)
    this.mesh.rotation.y = this.heading
  }
}
