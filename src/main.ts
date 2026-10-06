import { crewInvite } from './spatial'
import { CITIES } from './data'
import { installHeightFog } from './materials'
import './style.css'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { $, Game } from './game'
import { createSky, Rain } from './fx'
import type { Input } from './vehicle'

installHeightFog()
const canvas = $<HTMLCanvasElement>('scene')
const renderer = new THREE.WebGLRenderer({ canvas, stencil: true, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.85

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x1b1d2e, 0.0012)
scene.add(new THREE.HemisphereLight(0x8c98aa, 0x12151c, 1.6))
const sun = new THREE.DirectionalLight(0xff9d00, 1.5)
sun.position.set(40, 80, -30)
scene.add(sun)
const sky = createSky()
scene.add(sky)
const rain = new Rain()
scene.add(rain.mesh)

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 4000)
camera.position.set(0, 30, -40)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.3, 0.88)
composer.addPass(bloom)
composer.addPass(new OutputPass())

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', resize)
resize()

const coarse = window.matchMedia('(pointer: coarse), (max-width: 760px)')
const syncTouch = () => document.body.classList.toggle('is-touch', coarse.matches || 'ontouchstart' in window)
syncTouch()
coarse.addEventListener('change', syncTouch)

const game = new Game(scene)
;(window as unknown as { hoverghini: Game }).hoverghini = game

// ---------- input ----------
const keys = new Set<string>()
const touch = { up: false, down: false, left: false, right: false, boost: false }
const stick = { x: 0, y: 0, active: false }

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return
  const k = e.key.toLowerCase()
  keys.add(k)
  if (e.repeat) return
  const modal = $('modal')
  const open = modal.classList.contains('show')
  const view = modal.dataset.view
  const views: Record<string, string> = { j: 'contracts', n: 'market', g: 'garage', k: 'masks', p: 'holdings', m: 'warp', h: 'help' }
  if (k === 'escape') {
    if ($('map-overlay').classList.contains('show')) game.toggleMap(false)
    else game.closeModal()
  }
  else if (views[k]) {
    if (open && view === views[k]) game.closeModal()
    else game.openModal(views[k])
  } else if (!open) {
    if (k === 'e') game.toggleMode()
    if (k === 'f') game.refuel()
    if (k === 't') game.tow()
    if (k === 'v') game.cycleCamera()
    if (k === 'q') game.overclock()
    if (k === 'r') game.openDealer()
    if (k === 'b') game.stash()
    if (k === 'u') game.stash(true)
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
    else if (a === 'cam') game.cycleCamera()
    else if (a === 'map') game.toggleMap()
    else if (a === 'overclock') game.overclock()
    else game.openModal(a)
  }),
)
$('map-close').addEventListener('click', () => game.toggleMap(false))
$('map-plus').addEventListener('click', () => game.zoomMap(1.35))
$('map-minus').addEventListener('click', () => game.zoomMap(1 / 1.35))
$('modal-close').addEventListener('click', () => game.closeModal())
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) game.closeModal() })

const stickEl = $('stick')
const knob = $('stick-knob')
let stickId = -1
const STICK_R = 46
function moveStick(e: PointerEvent) {
  const r = stickEl.getBoundingClientRect()
  let dx = e.clientX - (r.left + r.width / 2)
  let dy = e.clientY - (r.top + r.height / 2)
  const d = Math.hypot(dx, dy)
  if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d }
  knob.style.transform = `translate(${dx}px, ${dy}px)`
  stick.x = dx / STICK_R
  stick.y = -dy / STICK_R
}
stickEl.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  stickId = e.pointerId
  stickEl.setPointerCapture(e.pointerId)
  stick.active = true
  moveStick(e)
})
stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e) })
const releaseStick = (e: PointerEvent) => {
  if (e.pointerId !== stickId) return
  stickId = -1
  stick.active = false
  stick.x = stick.y = 0
  knob.style.transform = ''
}
stickEl.addEventListener('pointerup', releaseStick)
stickEl.addEventListener('pointercancel', releaseStick)

let smoothSteer = 0
function readInput(dt: number): Input {
  const has = (...k: string[]) => k.some((x) => keys.has(x))
  const keySteer = (has('a', 'arrowleft') || touch.left ? 1 : 0) - (has('d', 'arrowright') || touch.right ? 1 : 0)
  const free = game.player.mode === 'free'
  smoothSteer += (keySteer - smoothSteer) * Math.min(1, dt * (free ? 7 : 30))
  const sx = stick.active ? stick.x : 0
  const sy = stick.active ? stick.y : 0
  const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88)
  const steer = stick.active ? -Math.sign(sx) * Math.pow(Math.abs(dz(sx)), 1.4) : smoothSteer
  const kUp = has('w', 'arrowup') || touch.up
  const kDown = has('s', 'arrowdown') || touch.down
  return {
      throttle: Math.max(kUp ? 1 : 0, dz(sy) > 0 ? dz(sy) : 0),
      brake: Math.max(kDown ? 1 : 0, dz(sy) < -0.4 ? 1 : 0),
      steer,
      boost: has('shift') || touch.boost,
      up: has(' '),
      down: false,
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

// ---------- camera ----------
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
let last = performance.now()
let camYaw = 0
let orbit = 0
const camTarget = new THREE.Vector3()
const camPos = new THREE.Vector3()
const lookAt = new THREE.Vector3()

/** Pull the camera in front of any tower between it and the subject. */
function unblock(from: THREE.Vector3, to: THREE.Vector3) {
  const w = game.world
  if (!w) return to
  const steps = 10
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = from.x + (to.x - from.x) * t
    const y = from.y + (to.y - from.y) * t
    const z = from.z + (to.z - from.z) * t
    if (w.hitBuilding(x, z, y) >= 0) {
      const k = Math.max(0.15, (i - 1) / steps)
      return to.set(from.x + (to.x - from.x) * k, Math.max(to.y, from.y + 2), from.z + (to.z - from.z) * k)
    }
  }
  return to
}

function updateCamera(dt: number) {
  const p = game.player
  const subject = game.actor
  const top = game.save.cam === 'top'
  const speed = p.groundSpeed

  let targetYaw = p.heading
  if (p.mode === 'free' && p.vel.length() > 8) {
    const va = Math.atan2(p.vel.x, p.vel.y)
    targetYaw = p.heading + Math.max(-0.35, Math.min(0.35, wrap(va - p.heading))) * 0.6
  }
  const yawRate = top ? 1.2 : 4.5
  camYaw += wrap(targetYaw - camYaw) * Math.min(1, dt * yawRate)
  if (game.paused) orbit += dt * 0.15
  else orbit *= Math.pow(0.02, dt)
  const yaw = camYaw + orbit

  const kind = p.spec.kind
  let dist: number, height: number
  if (top) {
    dist = 7 * zoom
    height = (kind === 'truck' ? 38 : 28) * zoom + speed * 0.25
    dist = 7 * zoom
  } else {
    dist = (kind === 'board' ? 8 : kind === 'truck' ? 14 : 10) * zoom * (1 + speed / 140)
    height = (kind === 'board' ? 4 : kind === 'truck' ? 6 : 4.5) * zoom + dist * 0.15
  }
  camTarget.set(subject.x, subject.y + 1.2, subject.z)
  camPos.set(camTarget.x - Math.sin(yaw) * dist, camTarget.y + height, camTarget.z - Math.cos(yaw) * dist)
  if (!top) unblock(camTarget, camPos)
  camera.position.lerp(camPos, Math.min(1, dt * 9))
  const lead = top ? 3 : 6
  const heading = p.heading
  lookAt.lerp(new THREE.Vector3(camTarget.x + Math.sin(heading) * lead, camTarget.y, camTarget.z + Math.cos(heading) * lead), Math.min(1, dt * 8))
  camera.lookAt(lookAt)
  const baseFov = camera.aspect < 1 ? 62 + (1 - camera.aspect) * 30 : 62
  const fov = (top ? baseFov - 8 : baseFov) + (p.boosting ? 12 : 0) + speed * 0.08
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 4)
  camera.updateProjectionMatrix()
}

// ---------- loop ----------
function frame() {
  const now = performance.now()
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  const input = readInput(dt)
  game.update(dt, input)

  if (game.world) updateCamera(dt)
  else {
    const t = now / 1000
    camera.position.set(Math.sin(t * 0.1) * 60, 25, Math.cos(t * 0.1) * 60)
    camera.lookAt(0, 5, 0)
  }
  sky.position.copy(camera.position)
  rain.update(dt, camera.position)
  composer.render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

const invite=crewInvite(location.hash)
const invitedCity=CITIES.find(c=>c.name.toLowerCase().replace(/ /g,'-')===invite.city.toLowerCase())
if(invitedCity){title.classList.remove('show');void game.warp(invitedCity.name,invitedCity.lat,invitedCity.lon)}
