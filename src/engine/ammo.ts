// Ammunition: bins, draw, explosion numbers, CASE lookup (10 §12, AMMO-001..030). The explosion itself runs in damage.ts.
// The engine never imports src/data: records are read from the DataBundle as these loose shapes.
import type { AmmoSpent } from './events'
import type { DataBundle, DataRecord, Id, LocalId, Loc, UnitId, UnitState } from './types'
import type { Work } from './dice'
import { unitOf } from './dice'

export interface WeaponRec extends DataRecord {
  name?: string
  category?: 'energy' | 'ballistic' | 'missile'
  heat?: number
  damage: number | { short?: number; medium?: number; long?: number }
  cluster?: { rackSize: number; groupSize: number }
  ranges?: { short: number; medium: number; long: number; min?: number }
  toHitMod?: number
  clusterMod?: number
  slots?: number | 'perMech'
  ammo?: Id[]
  flags?: string[]
  rapidFire?: { modes: number[] }
}
export interface AmmoRec extends DataRecord {
  name?: string
  shotsPerTon?: number
  explodes?: boolean
  explosionPerShot?: number
  override?: Partial<WeaponRec> & { noCluster?: boolean; addFlags?: string[]; removeFlags?: string[] }
}
export interface EquipRec extends DataRecord {
  name?: string
  kind?: string
  slots?: number | 'perMech'
  explodes?: boolean
  heatSink?: { dissipation: number }
}

export const weaponRec = (data: DataBundle, id: Id): WeaponRec | null => (data.weapons[id] as WeaponRec | undefined) ?? null
export const ammoRec = (data: DataBundle, id: Id): AmmoRec | null => (data.ammo[id] as AmmoRec | undefined) ?? null
export const equipRec = (data: DataBundle, id: Id): EquipRec | null => (data.equipment[id] as EquipRec | undefined) ?? null
/** Name for events: any record's `name`. */
export const recName = (data: DataBundle, id: Id): string | null => ((data.byId[id] as { name?: string } | undefined)?.name ?? null)

/** Weapon fields with the ammo's overrides applied (20 §3.5). */
export function effectiveProfile(weapon: WeaponRec, ammo: AmmoRec | null): WeaponRec {
  const o = ammo?.override
  if (!o) return weapon
  const { noCluster, addFlags, removeFlags, ...rest } = o
  const p: WeaponRec = { ...weapon, ...rest } as WeaponRec
  if (noCluster) { delete p.cluster; p.flags = (p.flags ?? []).filter((f) => f !== 'cluster') }
  if (addFlags) p.flags = [...new Set([...(p.flags ?? []), ...addFlags])]
  if (removeFlags) p.flags = (p.flags ?? []).filter((f) => !removeFlags.includes(f))
  return p
}
export const hasFlag = (w: WeaponRec, f: string): boolean => !!w.flags?.includes(f)

// ---------- bins ----------
/** Bins of the unit that hold ammo this weapon can fire and still have shots. */
export function binsFor(u: UnitState, weapon: WeaponRec): UnitState['bins'][string][] {
  const ok = new Set(weapon.ammo ?? [])
  return Object.values(u.bins).filter((b) => ok.has(b.ammo) && b.shots > 0 && !b.exploded)
}
/**
 * AMMO-001 default bin (00 §9.4): fewest shots, ties by record order. Returns null if none.
 * `needsChoice` is true when the usable bins hold two or more ammo types (the player picks).
 */
export function defaultBin(u: UnitState, weapon: WeaponRec, need = 1): { binId: LocalId | null; needsChoice: boolean } {
  const bins = binsFor(u, weapon).filter((b) => b.shots >= need)
  if (bins.length === 0) return { binId: null, needsChoice: false }
  const types = new Set(bins.map((b) => b.ammo))
  const sorted = [...bins].sort((a, b) => a.shots - b.shots) // stable: ties keep record order
  return { binId: sorted[0]!.id, needsChoice: types.size > 1 }
}

/** AMMO-001: spend shots from one bin at declaration. Returns false (no change) if the bin cannot supply them. */
export function spendAmmo(w: Work, unitId: UnitId, binId: LocalId, shots = 1): boolean {
  const bin = unitOf(w, unitId).bins[binId]
  if (!bin || bin.exploded || bin.shots < shots) return false
  bin.shots -= shots
  const ev: AmmoSpent = { type: 'AmmoSpent', unitId, binId, shots, left: bin.shots }
  w.ev.push(ev)
  return true
}

// ---------- explosion numbers (AMMO-010/020) ----------
export const EXPLOSION_CAP = 20
export const CASE_CAP = 10

/** Damage a bin would deal before caps: shots left x damage per shot. Gauss-type ammo (explodes false) deals 0. */
export function binExplosionRaw(data: DataBundle, u: UnitState, binId: LocalId): number {
  const bin = u.bins[binId]
  if (!bin || bin.exploded || bin.shots <= 0) return 0
  const a = ammoRec(data, bin.ammo)
  if (!a || a.explodes === false) return 0
  return bin.shots * (a.explosionPerShot ?? 0)
}
/** Per-shot value used for the heat-explosion choice (AMMO-030). */
export const perShot = (data: DataBundle, ammoId: Id): number => ammoRec(data, ammoId)?.explosionPerShot ?? 0

/** CASE protection at a location: 'caseII' beats 'case'; only intact mounts count (AMMO-013: data decides, never assumed). */
export function caseAt(data: DataBundle, u: UnitState, loc: Loc): 'none' | 'case' | 'caseII' {
  let found: 'none' | 'case' | 'caseII' = 'none'
  for (const m of Object.values(u.mounts)) {
    if (m.destroyed || m.location !== loc) continue
    const kind = equipRec(data, m.item)?.kind
    if (kind === 'caseII') return 'caseII'
    if (kind === 'case') found = 'case'
  }
  return found
}

/** Does this location hold something that can explode (CRIT-005): a bin with shots that explodes, or an intact explosive component. */
export function hasExplosive(data: DataBundle, u: UnitState, loc: Loc): boolean {
  return u.slots[loc].some((s) => isExplosiveSlot(data, u, s.token))
}
export function isExplosiveSlot(data: DataBundle, u: UnitState, token: string): boolean {
  if (!token.startsWith('#')) return false
  const id = token.slice(1)
  const bin = u.bins[id]
  if (bin) return binExplosionRaw(data, u, id) > 0
  const m = u.mounts[id]
  if (m && !m.destroyed) return !!(weaponRec(data, m.item)?.flags?.includes('explodes') || equipRec(data, m.item)?.explodes)
  return false
}

/**
 * AMMO-030 bin choice for a heat explosion: highest damage per shot, then most shots, then (RULING) the first in record
 * order: the heat module has no decision to hand the controller. Pure: no dice.
 */
export function pickHeatExplosionBin(data: DataBundle, u: UnitState): LocalId | null {
  const bins = Object.values(u.bins).filter((b) => b.shots > 0 && !b.exploded && binExplosionRaw(data, u, b.id) > 0)
  if (bins.length === 0) return null
  bins.sort((a, b) => perShot(data, b.ammo) - perShot(data, a.ammo) || b.shots - a.shots)
  return bins[0]!.id
}
