// Derived values (20-data-schema section 6.2). Pure functions over data records; never stored in JSON.
import type { Ammo, Damage, Loc, Mech, Tables, Weapon, WeaponFlag } from './types'

/** Engine-integral heat sinks: min(count, floor(rating / 25)). */
export function engineHeldSinks(mech: Mech): number {
  return Math.min(mech.heatSinks.count, Math.floor(mech.engine.rating / 25))
}
export function heatDissipation(mech: Mech): number {
  return mech.heatSinks.count * (mech.heatSinks.type === 'double' ? 2 : 1)
}
/** Internal structure points of one location. */
export function internalStructure(tables: Tables, tonnage: number, loc: Loc): number {
  const row = tables.internalStructure[String(tonnage)]
  if (!row) throw new Error(`no internal structure row for ${tonnage} t`)
  if (loc === 'HD') return row.HD
  if (loc === 'CT') return row.CT
  if (loc === 'LT' || loc === 'RT') return row.sideTorso
  if (loc === 'LA' || loc === 'RA') return row.arm
  return row.leg
}
/** Max armor for one location (head 9, others twice the structure). */
export function maxArmor(tables: Tables, tonnage: number, loc: Loc): number {
  return loc === 'HD' ? 9 : 2 * internalStructure(tables, tonnage, loc)
}
/** Base BV scaled by the pilot skill pair, rounded half up. */
export function adjustedBv(tables: Tables, bv: number, gunnery: number, piloting: number): number {
  const m = tables.bvSkillMultiplier.rows[gunnery]?.[piloting]
  if (m === undefined) throw new Error(`no BV multiplier for ${gunnery}/${piloting}`)
  return Math.floor(bv * m + 0.5 + 1e-9)
}
/** The weapon profile with the loaded ammo's overrides applied (20 section 3.5). */
export function effectiveProfile(weapon: Weapon, ammo?: Ammo): Weapon {
  const out: Weapon = { ...weapon }
  const o = ammo?.override
  if (!o) return out
  if (o.damage !== undefined) out.damage = o.damage as Damage
  if (o.ranges) out.ranges = o.ranges
  if (o.toHitMod !== undefined) out.toHitMod = o.toHitMod
  if (o.cluster) out.cluster = o.cluster
  let flags: WeaponFlag[] = [...(out.flags ?? [])]
  if (o.noCluster) { delete out.cluster; flags = flags.filter((f) => f !== 'cluster') }
  if (o.addFlags) for (const f of o.addFlags) if (!flags.includes(f)) flags.push(f)
  if (o.removeFlags) flags = flags.filter((f) => !o.removeFlags!.includes(f))
  if (o.cluster && !flags.includes('cluster')) flags.push('cluster')
  out.flags = flags
  return out
}
/** Display name; stock stand-ins carry the (stock) label. */
export function mechDisplayName(m: Mech): string {
  return `${m.chassis} ${m.model}${m.stock ? ' (stock)' : ''}`
}
