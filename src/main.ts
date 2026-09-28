import './style.css'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { $, Game } from './game'
import type { Input } from './vehicle'

const canvas = $<HTMLCanvasElement>('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0a0418)
scene.fog = new THREE.FogExp2(0x12062a, 0.0016)
scene.add(new THREE.HemisphereLight(0x8a5cff, 0x19ffe6, 1.6))
const sun = new THREE.DirectionalLight(0xff9ad9, 2)
sun.position.set(40, 80, -30)
scene.add(sun)

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 4000)
camera.position.set(0, 30, -40)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.45, 0.5)
composer.addPass(bloom)
composer.addPass(new OutputPass())

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})

const coarse = window.matchMedia('(pointer: coarse)')
const syncTouch = () => document.body.classList.toggle('is-touch', coarse.matches || 'ontouchstart' in window)
syncTouch()
coarse.addEventListener('change', syncTouch)

const game = new Game(scene)

// ---------- input ----------
const keys = new Set<string>()
const touch = { up: false, down: false, left: false, right: false, boost: false, climb: false, dive: false }

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return
  const k = e.key.toLowerCase()
  keys.add(k)
  if (e.repeat) return
  const modal = $('modal')
  const open = modal.classList.contains('show')
  const view = modal.dataset.view
  const views: Record<string, string> = { j: 'contracts', g: 'garage', p: 'holdings', m: 'warp', h: 'help' }
  if (k === 'escape') game.closeModal()
  else if (views[k]) {
    if (open && view === views[k]) game.closeModal()
    else game.openModal(views[k])
  } else if (!open) {
    if (k === 'e') game.toggleMode()
    if (k === 'f') game.refuel()
    if (k === 't') game.tow()
  }
  if ([' ', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault()
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
window.addEventListener('blur', () => keys.clear())

document.querySelectorAll<HTMLElement>('[data-touch]').forEach((el) => {
  const k = el.dataset.touch as keyof typeof touch
  const on = (e: Event) => { e.preventDefault(); touch[k] = true; el.classList.add('held') }
  const off = (e: Event) => { e.preventDefault(); touch[k] = false; el.classList.remove('held') }
  el.addEventListener('pointerdown', on)
  el.addEventListener('pointerup', off)
  el.addEventListener('pointerleave', off)
  el.addEventListener('pointercancel', off)
})
document.querySelectorAll<HTMLElement>('[data-tap]').forEach((el) =>
  el.addEventListener('click', () => {
    const a = el.dataset.tap!
    if (a === 'mode') game.toggleMode()
    else if (a === 'prompt') game.promptAction()
    else game.openModal(a)
  }),
)
$('modal-close').addEventListener('click', () => game.closeModal())
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) game.closeModal() })

function readInput(): Input {
  const has = (...k: string[]) => k.some((x) => keys.has(x))
  return {
    throttle: has('w', 'arrowup') || touch.up ? 1 : 0,
    brake: has('s', 'arrowdown') || touch.down ? 1 : 0,
    steer: (has('a', 'arrowleft') || touch.left ? 1 : 0) - (has('d', 'arrowright') || touch.right ? 1 : 0),
    boost: has('shift') || touch.boost,
    up: has(' ') || touch.climb,
    down: has('c', 'control') || touch.dive,
  }
}

let zoom = 1
window.addEventListener('wheel', (e) => { zoom = Math.min(2.5, Math.max(0.5, zoom * (1 + Math.sign(e.deltaY) * 0.1))) }, { passive: true })

// ---------- title ----------
const title = $('title')
const cont = $('btn-continue')
if (game.hasSave) {
  cont.style.display = ''
  cont.textContent = `Continue in ${game.save.city!.name}`
  cont.addEventListener('click', () => {
    title.classList.remove('show')
    const c = game.save.city!
    void game.warp(c.name, c.lat, c.lon)
  })
}
$('btn-new').addEventListener('click', () => {
  title.classList.remove('show')
  game.openModal('warp')
})

// ---------- loop ----------
let last = performance.now()
const camTarget = new THREE.Vector3()
const camPos = new THREE.Vector3()
let orbit = 0

function frame() {
  const now = performance.now()
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  const input = readInput()
  game.update(dt, input)

  const p = game.player
  if (game.world) {
    const kind = p.spec.kind
    const dist = (kind === 'board' ? 8 : kind === 'truck' ? 14 : 10) * zoom * (1 + p.groundSpeed / 140)
    const height = (kind === 'board' ? 4 : kind === 'truck' ? 6 : 4.5) * zoom + dist * 0.15
    const back = p.mode === 'free' && p.vel.length() > 3 ? Math.atan2(p.vel.x, p.vel.y) * 0.35 + p.heading * 0.65 : p.heading
    if (game.paused) orbit += dt * 0.15
    else orbit *= 0.9
    const a = back + orbit
    camPos.set(p.pos.x - Math.sin(a) * dist, p.pos.y + height, p.pos.z - Math.cos(a) * dist)
    camera.position.lerp(camPos, Math.min(1, dt * 6))
    camTarget.lerp(new THREE.Vector3(p.pos.x + Math.sin(p.heading) * 6, p.pos.y + 1.2, p.pos.z + Math.cos(p.heading) * 6), Math.min(1, dt * 10))
    camera.lookAt(camTarget)
    const baseFov = camera.aspect < 1 ? 62 + (1 - camera.aspect) * 30 : 62
    const fov = baseFov + (p.boosting ? 12 : 0) + p.groundSpeed * 0.08
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4)
    camera.updateProjectionMatrix()
  } else {
    const t = performance.now() / 1000
    camera.position.set(Math.sin(t * 0.1) * 60, 25, Math.cos(t * 0.1) * 60)
    camera.lookAt(0, 5, 0)
  }
  composer.render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
