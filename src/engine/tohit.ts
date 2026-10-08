// Ranged to-hit: target number with a full modifier breakdown (10 §6-§7, TOHIT-001..036).
// computeRangedTn is pure over explicit inputs; rangedToHit reads the attacker/target from state.
import type { Loc, Mod, MoveMode, RangeBand, UnitId, UnitState, Woods, GameState, LocalId } from './types'
import { pAtLeast2d6 } from './prob'

/** TOHIT-014: target movement modifier by hexes moved. */
export function tmmForHexes(hexes: number): number {
  if (hexes <= 2) return 0
  if (hexes <= 4) return 1
  if (hexes <= 6) return 2
  if (hexes <= 9) return 3
  if (hexes <= 17) return 4
  if (hexes <= 24) return 5
  return 6
}
/** TOHIT-023: attacker heat modifier (ranged only). */
export function heatToHit(heat: number): number {
  if (heat >= 24) return 4
  if (heat >= 17) return 3
  if (heat >= 13) return 2
  if (heat >= 8) return 1
  return 0
}
/** TOHIT-012: attacker movement modifier by mode (not distance). */
export function attackerMoveMod(mode: MoveMode | null): number {
  return mode === 'walk' ? 1 : mode === 'run' ? 2 : mode === 'jump' ? 3 : 0
}
/** TOHIT-010: range bracket for a distance (inclusive upper bounds). */
export function rangeBand(distance: number, ranges: { short: number; medium: number; long: number }): RangeBand {
  if (distance <= ranges.short) return 'short'
  if (distance <= ranges.medium) return 'medium'
  if (distance <= ranges.long) return 'long'
  return 'out'
}
export const rangeMod = (band: RangeBand): number => (band === 'medium' ? 2 : band === 'long' ? 4 : 0)
/** TOHIT-011: minimum range penalty (min - range + 1 at range <= min), else 0. */
export const minRangeMod = (distance: number, min: number): number => (min > 0 && distance <= min ? min - distance + 1 : 0)

export interface AimedInput {
  at: Loc
  targetImmobile: boolean
  tc: boolean // a targeting computer linked to the weapon
  pulse?: boolean // pulse weapons never take the TC bonus on an aimed shot
}
/** TOHIT-030/034: is an aimed shot legal for this weapon and target? */
export function aimedShotLegal(a: AimedInput & { weaponAllowsAim: boolean; partialCover?: boolean }): boolean {
  if (!a.weaponAllowsAim) return false // missiles, cluster, MG arrays, indirect
  if (a.partialCover && (a.at === 'LL' || a.at === 'RL')) return false // TOHIT-036: legs cannot be named under partial cover
  if (a.targetImmobile) return true
  if (!a.tc) return false
  if (a.pulse) return false
  return a.at !== 'HD' // TC vs a mobile target: no head
}

export interface RangedTnInput {
  gunnery: number
  distance: number
  band: RangeBand
  minRange?: number
  weaponMod?: number // data toHitMod (TOHIT-029), incl. ammo override
  attackerMode: MoveMode | null
  attackerProne?: boolean
  attackerHeat?: number
  /** Null = empty-hex target: only range-type lines apply. */
  target: { tmm: number; jumped: boolean; prone: boolean; adjacent: boolean; immobile: boolean; woods: Woods } | null
  interveningWoods?: number // sum of woods points from LOS (TOHIT-021)
  partialCover?: boolean
  secondary?: boolean // TOHIT-024
  sensorCrits?: number // TOHIT-025
  armCrits?: { shoulder: boolean; upperArm: boolean } | null // weapon in an arm (TOHIT-026/027)
  targetingComputer?: boolean // linked, eligible weapon (TOHIT-031)
  aimed?: AimedInput | null
  extra?: Mod[] // hook lines (TOHIT-029 and friends)
}
export interface TnResult {
  tn: number
  mods: Mod[]
  legal: boolean // TN <= 12 and no sensor lockout (TOHIT-002/007)
  autoHit: boolean // TN <= 2
  pHit: number
}

/** TOHIT-001: TN = gunnery + all modifiers. Zero-value lines are omitted (the gunnery line is always first). */
export function computeRangedTn(i: RangedTnInput): TnResult {
  const mods: Mod[] = [{ code: 'gunnery', value: i.gunnery }]
  const add = (m: Mod): void => { if (m.value !== 0) mods.push(m) }
  add({ code: 'weapon', value: i.weaponMod ?? 0 })
  add({ code: 'range', value: rangeMod(i.band), detail: i.band })
  add({ code: 'minRange', value: minRangeMod(i.distance, i.minRange ?? 0) })
  add({ code: 'attackerMove', value: attackerMoveMod(i.attackerMode), detail: i.attackerMode ?? 'standStill' })
  if (i.attackerProne) add({ code: 'attackerProne', value: 2 })
  add({ code: 'heat', value: heatToHit(i.attackerHeat ?? 0) })
  const t = i.target
  const aimed = i.aimed ?? null
  if (t) {
    const headAim = aimed?.at === 'HD' && t.immobile
    if (t.immobile) {
      if (!headAim) add({ code: 'targetImmobile', value: -4 }) // TOHIT-017/034: head aim gets +3 instead
    } else {
      add({ code: 'tmm', value: t.tmm })
      if (t.jumped) add({ code: 'targetJumped', value: 1 })
    }
    if (t.prone) add({ code: 'targetProne', value: t.adjacent ? -2 : 1 })
    add({ code: 'woodsTarget', value: t.woods === 'light' ? 1 : t.woods === 'heavy' ? 2 : 0 })
  }
  add({ code: 'woodsIntervening', value: i.interveningWoods ?? 0 })
  if (i.partialCover && !aimed) add({ code: 'partialCover', value: 1 }) // TOHIT-036: not applied on aimed shots
  if (i.secondary) add({ code: 'secondaryTarget', value: 1 })
  const sensors = i.sensorCrits ?? 0
  if (sensors === 1) add({ code: 'sensors', value: 2 })
  const arm = i.armCrits
  if (arm?.shoulder) add({ code: 'shoulder', value: 4 })
  else if (arm?.upperArm) add({ code: 'upperArm', value: 1 })
  if (aimed) {
    if (aimed.at === 'HD' && aimed.targetImmobile) add({ code: 'aimedShot', value: 3, detail: 'head' })
    else if (!aimed.targetImmobile) add({ code: 'aimedShot', value: 3, detail: 'targeting computer, mobile target' })
    else if (aimed.tc && !aimed.pulse) add({ code: 'aimedShot', value: -1, detail: 'targeting computer' })
  } else if (i.targetingComputer) {
    add({ code: 'targetingComputer', value: -1 })
  }
  for (const m of i.extra ?? []) add(m)
  const tn = mods.reduce((a, m) => a + m.value, 0)
  const legal = tn <= 12 && sensors < 2
  return { tn, mods, legal, autoHit: tn <= 2 && legal, pHit: legal ? pAtLeast2d6(tn) : 0 }
}

// ---------- reading state ----------
const hitSlots = (u: UnitState, loc: Loc, token: string): number => u.slots[loc].filter((s) => s.hit && s.token === token).length
export const sensorCrits = (u: UnitState): number => Object.values(u.slots).reduce((a, sl) => a + sl.filter((s) => s.hit && s.token === 'sensors').length, 0)

/** Actuator crits for a weapon mounted in an arm (TOHIT-026..028); null for non-arm weapons. */
export function armCritsFor(u: UnitState, mountLoc: Loc): { shoulder: boolean; upperArm: boolean } | null {
  if (mountLoc !== 'LA' && mountLoc !== 'RA') return null
  return { shoulder: hitSlots(u, mountLoc, 'shoulder') > 0, upperArm: hitSlots(u, mountLoc, 'upperArm') > 0 }
}

export interface RangedToHitRequest {
  attackerId: UnitId
  mountId: LocalId
  targetId: UnitId | null
  distance: number
  band: RangeBand
  minRange?: number
  weaponMod?: number
  interveningWoods?: number
  targetWoods?: Woods
  partialCover?: boolean
  secondary?: boolean
  targetingComputer?: boolean
  aimed?: AimedInput | null
  extra?: Mod[]
  targetImmobile?: boolean // default: snapshot in ledger.immobileAtStart (TOHIT-018)
}

/** Builds the TN for one ranged shot from game state (attacker and target facts come from the units). */
export function rangedToHit(state: GameState, req: RangedToHitRequest): TnResult {
  const a = state.units[req.attackerId]!
  const mount = a.mounts[req.mountId]
  const t = req.targetId ? state.units[req.targetId] : null
  const target = t
    ? {
        tmm: t.move.tmm - (t.move.jumped ? 1 : 0), // MoveRecord.tmm already includes the TOHIT-015 jump point
        jumped: t.move.jumped,
        prone: t.prone,
        adjacent: req.distance <= 1,
        immobile: req.targetImmobile ?? state.ledger.immobileAtStart.includes(t.id),
        woods: req.targetWoods ?? ('none' as Woods),
      }
    : null
  const input: RangedTnInput = {
    gunnery: a.pilot.gunnery, distance: req.distance, band: req.band, attackerMode: a.move.mode,
    attackerProne: a.prone, attackerHeat: a.heat, target, sensorCrits: sensorCrits(a),
    armCrits: mount ? armCritsFor(a, mount.location) : null,
  }
  if (req.minRange !== undefined) input.minRange = req.minRange
  if (req.weaponMod !== undefined) input.weaponMod = req.weaponMod
  if (req.interveningWoods !== undefined) input.interveningWoods = req.interveningWoods
  if (req.partialCover !== undefined) input.partialCover = req.partialCover
  if (req.secondary !== undefined) input.secondary = req.secondary
  if (req.targetingComputer !== undefined) input.targetingComputer = req.targetingComputer
  if (req.aimed !== undefined) input.aimed = req.aimed
  if (req.extra !== undefined) input.extra = req.extra
  return computeRangedTn(input)
}
