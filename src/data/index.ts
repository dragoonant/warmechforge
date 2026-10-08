// Builds the DataBundle the engine receives (the engine never imports src/data).
import type { DataBundle } from '../engine/types'
import { RAW } from './raw'
import type { Ammo, Equipment, Force, GameMap, Mech, Mission, Pilot, Spa, Tables, Weapon } from './types'

export * from './types'
export * from './derive'
export { RAW, RAW_FILES } from './raw'

export interface TypedBundle extends DataBundle {
  weapons: Record<string, Weapon>
  ammo: Record<string, Ammo>
  equipment: Record<string, Equipment>
  mechs: Record<string, Mech>
  pilots: Record<string, Pilot>
  spas: Record<string, Spa>
  maps: Record<string, GameMap>
  forces: Record<string, Force>
  missions: Record<string, Mission>
  tables: Tables
}

/** Stable string hash (cyrb53) used for the content version. */
function hash53(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

type Rec = { id: string }
function index<T extends Rec>(list: readonly T[], byId: Record<string, Rec>, kind: string): Record<string, T> {
  const out: Record<string, T> = {}
  for (const r of list) {
    if (byId[r.id]) throw new Error(`duplicate data id ${r.id} (${kind})`)
    byId[r.id] = r
    out[r.id] = r
  }
  return out
}

/** Builds the bundle; throws on a duplicate id or a dangling reference. `version` is a content hash. */
export function loadBundle(raw: typeof RAW = RAW): TypedBundle {
  const byId: Record<string, Rec> = {}
  const weapons = index(raw.weapons, byId, 'weapon')
  const ammo = index(raw.ammo, byId, 'ammo')
  const equipment = index(raw.equipment, byId, 'equipment')
  const mechs = index(raw.mechs, byId, 'mech')
  const pilots = index(raw.pilots, byId, 'pilot')
  const spas = index(raw.spas, byId, 'spa')
  const maps = index(raw.maps, byId, 'map')
  const forces = index(raw.forces, byId, 'force')
  const missions = index(raw.missions, byId, 'mission')

  const dangling = (from: string, id: string | undefined, table: Record<string, unknown>): void => {
    if (id !== undefined && !table[id]) throw new Error(`dangling reference ${id} in ${from}`)
  }
  for (const w of raw.weapons) for (const a of w.ammo ?? []) dangling(w.id, a, ammo)
  for (const a of raw.ammo) for (const w of a.weapons) dangling(a.id, w, weapons)
  for (const p of raw.pilots) for (const s of p.spas) dangling(p.id, s, spas)
  for (const m of raw.mechs) {
    for (const mt of m.mounts) if (!weapons[mt.item] && !equipment[mt.item]) throw new Error(`dangling reference ${mt.item} in ${m.id}`)
    for (const b of m.ammoBins) {
      dangling(m.id, b.ammo, ammo)
      for (const o of b.options ?? []) dangling(m.id, o, ammo)
    }
  }
  for (const f of raw.forces) for (const u of f.units) { dangling(f.id, u.mech, mechs); dangling(f.id, u.pilot, pilots) }
  for (const m of raw.missions) {
    if (m.map !== 'choose') dangling(m.id, m.map, maps)
    for (const s of m.sides) if (s.force !== 'pick') dangling(m.id, s.force, forces)
  }

  const version = hash53(stable(raw))
  return { version, byId, weapons, ammo, equipment, mechs, pilots, spas, maps, forces, missions, tables: raw.tables }
}
