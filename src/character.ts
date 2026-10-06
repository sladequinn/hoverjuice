import * as THREE from 'three'

export interface MaskSpec { id: string; name: string; price: number; blurb: string }
export const MASKS: MaskSpec[] = [
  { id: 'balaclava', name: 'Street Balaclava', price: 0, blurb: 'SHINOBI cut. Slows Heat gain in rival turf.' },
  { id: 'glitcher', name: 'Glitcher Visor', price: 1200, blurb: 'Patrol telemetry and black-market access.' },
  { id: 'respirator', name: 'Iron Lung Respirator', price: 2500, blurb: 'Seals chemical cargo against leakage.' },
  { id: 'oni', name: 'Ceramic Oni', price: 6000, blurb: 'HYENAS ceramic. Halves ramming damage.' },
  { id: 'liar', name: 'White Lie', price: 4000, blurb: 'LIARS issue. A blank white face with nothing to confess.' },
  { id: 'jester', name: 'Jester', price: 4000, blurb: 'JESTERS issue. The last laugh costs extra.' },
]
export const validMask = (id: string) => MASKS.some(m => m.id === id) ? id : 'balaclava'
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
const cyl = (rt: number, rb: number, h: number, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s)

function eyes(g: THREE.Group, color: number, y: number, z: number, spread = 0.08, r = 0.035) {
  part(g, sphere(r, 0), color, [spread, y, z])
  part(g, sphere(r, 0), color, [-spread, y, z])
}

export function buildMask(id: string) {
  const g = new THREE.Group()
  const white = ['oni', 'liar', 'jester'].includes(id)
  part(g, sphere(0.23), white ? 0xd1d0c7 : 0x12151c, [0, 0, 0], [0, 0, 0], [1, 1.15, 0.8])
  eyes(g, id === 'glitcher' ? 0x00f0ff : 0x08090c, 0.04, 0.19, 0.085, 0.045)
  if (id === 'glitcher') part(g, box(0.37, 0.085, 0.045), 0x00f0ff, [0, 0.04, 0.2], [0, 0, 0], [1, 1, 1], true)
  if (id === 'respirator') {
    for (const x of [-0.12, 0.12]) part(g, cyl(0.065, 0.065, 0.1), 0x767c7e, [x, -0.1, 0.22], [Math.PI / 2, 0, 0])
  }
  if (id === 'oni') for (const x of [-0.15, 0.15]) part(g, new THREE.ConeGeometry(0.055, 0.18, 4), 0x8a8274, [x, 0.24, 0])
  if (id === 'liar') part(g, sphere(0.045), 0x08090c, [0, -0.1, 0.19])
  if (id === 'jester') {
    part(g, sphere(0.05), 0x7b1fa2, [0, -0.02, 0.22])
    part(g, box(0.19, 0.02, 0.03), 0x7b1fa2, [0, -0.12, 0.2])
  }
  return g
}
const JEANS = 0x1b1d2e, JACKET = 0x12151c, SLEEVE = 0x484a47, skinTone = 0xba9680
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
