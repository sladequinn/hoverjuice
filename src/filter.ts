export type Tags = Record<string, string | number | boolean>
export type Gang = 'SHINOBI' | 'LIARS' | 'HYENAS' | 'JESTERS'
export const GANGS: Gang[] = ['SHINOBI', 'LIARS', 'HYENAS', 'JESTERS']
export function hashName(text: string) {
  let h = 2166136261
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
const protectedUses = new Set(['school', 'kindergarten', 'hospital', 'place_of_worship', 'residential', 'apartments', 'house', 'detached', 'dormitory', 'terrace', 'semidetached_house'])
export function protectedVenue(tags: Tags) {
  return ['amenity', 'building', 'landuse', 'class', 'subclass'].some(k => protectedUses.has(String(tags[k] ?? '').toLowerCase()))
}
/** Missing source tags never grant criminal eligibility. */
export function criminalEligible(tags: Tags) {
  if (protectedVenue(tags)) return false
  return Boolean(tags.shop || ['commercial', 'industrial', 'retail', 'warehouse'].includes(String(tags.building)) ||
    ['fuel', 'restaurant', 'cafe', 'bar', 'pub', 'nightclub', 'marketplace'].includes(String(tags.amenity)))
}
const brands: Record<string, string> = {
  shell: 'SHELFISH Precursor & Hydropumps',
  "mcdonald's": "McREPULSOR'S 24/7 Nutrient Sludge",
  'tim hortons': 'TIM HOVER’S Coil Coffee & Rations',
  'burger king': 'BURGER KILL Nutrient Division',
  esso: 'ESS-OFF Volatile Fuels',
}
export function grindVenue(tags: Tags) {
  const raw = String(tags.name || tags.brand || tags.shop || tags.amenity || 'Unregistered Unit')
  const brand = String(tags.brand || raw).toLowerCase().replace(/’/g, "'")
  for (const [key, name] of Object.entries(brands)) if (brand === key || brand.startsWith(key + ' ')) return name
  const stem = raw.replace(/\s+(pizzeria|pizza|restaurant|cafe|shop|store)$/i, '')
  const food = tags.cuisine || ['restaurant', 'cafe', 'fast_food'].includes(String(tags.amenity))
  const endings = food ? ['Synthetic Grill & Hover-Pies', 'Nutrient Works', 'Protein Reclamation'] : ['Salvage & Supply', 'Afterhours Exchange', 'Repulsor Surplus', 'Industrial Reclamation']
  return `${stem}’s ${endings[hashName(raw) % endings.length]}`.replace(/['’]s['’]s/g, '’s')
}
export function syndicate(tags: Tags): Gang {
  const use = String(tags.landuse || tags.amenity || tags.class || '')
  if (/industrial|rail|port|dock/.test(use)) return 'LIARS'
  if (/residential/.test(use)) return 'HYENAS'
  if (/retail|nightclub|bar|marina/.test(use)) return 'JESTERS'
  return 'SHINOBI'
}
export function buildingId(lat: number, lon: number) {
  const round = (v: number) => (Math.round(v * 1e5) / 1e5 || 0).toFixed(5)
  return `bld_${round(lat)}_${round(lon)}`
}
