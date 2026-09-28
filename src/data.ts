export type VehicleKind = 'board' | 'compact' | 'truck' | 'luxury' | 'super'

export interface VehicleSpec {
  id: string
  name: string
  tagline: string
  kind: VehicleKind
  price: number
  /** top speed in m/s */
  maxSpeed: number
  /** m/s^2 */
  accel: number
  /** rad/s */
  turn: number
  /** 0..1, how much sideways velocity survives per second in Free Hover (higher = driftier) */
  drift: number
  /** litres of HJ-77 */
  tank: number
  /** litres per second lost to evaporation, always (even parked) */
  evap: number
  /** litres per second at full throttle */
  burn: number
  boost: number
  /** contract pay multiplier (cargo class) */
  payMult: number
  /** maximum Free Hover altitude in metres */
  maxAlt: number
  body: number
  glow: number
}

export const VEHICLES: VehicleSpec[] = [
  {
    id: 'board',
    name: 'Gutter Hoverboard',
    tagline: 'Scavenged repulsor deck. Leaks like a sieve, rides like a dream.',
    kind: 'board',
    price: 0,
    maxSpeed: 24,
    accel: 9,
    turn: 2.6,
    drift: 0.55,
    tank: 18,
    evap: 0.0112,
    burn: 0.0225,
    boost: 1.6,
    payMult: 1,
    maxAlt: 6,
    body: 0x1b1f2e,
    glow: 0x19ffe6,
  },
  {
    id: 'neonic',
    name: 'Neonic',
    tagline: 'A shit box with a paint job. Three repulsors, two of them work.',
    kind: 'compact',
    price: 2500,
    maxSpeed: 32,
    accel: 10,
    turn: 2.2,
    drift: 0.5,
    tank: 30,
    evap: 0.0175,
    burn: 0.035,
    boost: 1.55,
    payMult: 1.7,
    maxAlt: 10,
    body: 0x7a2dff,
    glow: 0xff2bd6,
  },
  {
    id: 'z150',
    name: 'Sky-Duty Z150',
    tagline: 'Freight-rated hover truck. Slow to turn, pays in bulk.',
    kind: 'truck',
    price: 9000,
    maxSpeed: 30,
    accel: 7,
    turn: 1.5,
    drift: 0.35,
    tank: 70,
    evap: 0.03,
    burn: 0.065,
    boost: 1.4,
    payMult: 3.2,
    maxAlt: 18,
    body: 0xffa600,
    glow: 0xffd84a,
  },
  {
    id: 'hovercedes',
    name: 'Hovercedes-Benz',
    tagline: 'Executive-class calm. VIP clients only tip in German engineering.',
    kind: 'luxury',
    price: 30000,
    maxSpeed: 44,
    accel: 13,
    turn: 2.2,
    drift: 0.45,
    tank: 60,
    evap: 0.025,
    burn: 0.055,
    boost: 1.6,
    payMult: 4.6,
    maxAlt: 40,
    body: 0xc9d4e8,
    glow: 0x5ad1ff,
  },
  {
    id: 'goblin',
    name: 'Repuls-Royce Goblin',
    tagline: 'Hand-stitched grav-leather. The hood ornament is a tiny gremlin.',
    kind: 'luxury',
    price: 90000,
    maxSpeed: 52,
    accel: 15,
    turn: 2.1,
    drift: 0.45,
    tank: 90,
    evap: 0.035,
    burn: 0.075,
    boost: 1.65,
    payMult: 7,
    maxAlt: 80,
    body: 0x14532d,
    glow: 0x7dffb0,
  },
  {
    id: 'hoverarrari',
    name: 'Hoverarrari',
    tagline: 'Rosso Plasma. Twin-turbo repulsors and a waitlist of rivals.',
    kind: 'super',
    price: 250000,
    maxSpeed: 72,
    accel: 22,
    turn: 2.6,
    drift: 0.62,
    tank: 80,
    evap: 0.05,
    burn: 0.1125,
    boost: 1.8,
    payMult: 10,
    maxAlt: 140,
    body: 0xff1e3c,
    glow: 0xff7a1e,
  },
  {
    id: 'hoverghini',
    name: 'Hoverghini',
    tagline: 'The ultimate status symbol. Angles sharp enough to cut the skyline.',
    kind: 'super',
    price: 1000000,
    maxSpeed: 95,
    accel: 30,
    turn: 2.8,
    drift: 0.68,
    tank: 120,
    evap: 0.07,
    burn: 0.15,
    boost: 1.9,
    payMult: 15,
    maxAlt: 320,
    body: 0xd4ff00,
    glow: 0x19ffe6,
  },
]

export const vehicleById = (id: string) => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0]

export interface CityPreset {
  name: string
  area: string
  lat: number
  lon: number
}

export const CITIES: CityPreset[] = [
  { name: 'Tokyo', area: 'Shibuya Crossing', lat: 35.6595, lon: 139.7005 },
  { name: 'New York', area: 'Midtown Manhattan', lat: 40.7549, lon: -73.984 },
  { name: 'Hong Kong', area: 'Central', lat: 22.2819, lon: 114.1582 },
  { name: 'Seoul', area: 'Gangnam', lat: 37.4979, lon: 127.0276 },
  { name: 'London', area: 'The City', lat: 51.5138, lon: -0.0891 },
  { name: 'Dubai', area: 'Downtown', lat: 25.1972, lon: 55.2744 },
  { name: 'Singapore', area: 'Marina Bay', lat: 1.2834, lon: 103.8514 },
  { name: 'Chicago', area: 'The Loop', lat: 41.8826, lon: -87.6278 },
  { name: 'Paris', area: 'Opéra', lat: 48.8719, lon: 2.3316 },
  { name: 'Shanghai', area: 'Lujiazui', lat: 31.2378, lon: 121.5055 },
  { name: 'Los Angeles', area: 'Downtown', lat: 34.0488, lon: -118.2518 },
  { name: 'São Paulo', area: 'Avenida Paulista', lat: -23.5614, lon: -46.6559 },
]

export const JUICE_PRICE = 1.6

export interface ContractType {
  id: string
  label: string
  blurb: string
  payMult: number
  timeMult: number
  /** extra evaporation while carrying, as a multiple of the vehicle's own rate */
  leak: number
}

export const CONTRACT_TYPES: ContractType[] = [
  { id: 'parcel', label: 'Parcel', blurb: 'Sealed data-shards for a mid-tier corp.', payMult: 1, timeMult: 1, leak: 0 },
  { id: 'express', label: 'Express', blurb: 'Organ cooler. The clock is not a suggestion.', payMult: 1.6, timeMult: 0.7, leak: 0 },
  {
    id: 'cyanade',
    label: 'HJ-77 Precursor',
    blurb: 'Unmarked canisters for a Cyan-ade cook. Leaking fumes double your HJ-77 evaporation.',
    payMult: 2.5,
    timeMult: 0.9,
    leak: 1,
  },
]

export const LANDMARK_NAMES = [
  'Kessler Arcology',
  'Neon Spire',
  'Mirrorshade Tower',
  'Chromeheart Plaza',
  'Voltaic Exchange',
  'Glasswing Hotel',
  'Obsidian Needle',
  'Halcyon Datavault',
  'Pulsewave Center',
  'Synthcore HQ',
  'Umbra Heights',
  'Lumen Bazaar',
]
