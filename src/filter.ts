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
