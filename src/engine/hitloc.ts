// Hit location tables, TAC and the location roll (10 §8, HITLOC-001..010).
import type { HitLocated } from './events'
import type { ArmorSide, AttackDirection, AttackId, HitTable, Loc, UnitId } from './types'
import type { HitTableView } from './index'
import type { Work } from './dice'
import { roll1d6, roll2d6 } from './dice'

export type Column = 'left' | 'front' | 'right'

/** HITLOC-003: 2d6 → location, per column. Rear attacks use 'front' and hit rear armor. */
export const HIT_TABLE: Readonly<Record<Column, Readonly<Record<number, Loc>>>> = {
  left: { 2: 'LT', 3: 'LL', 4: 'LA', 5: 'LA', 6: 'LL', 7: 'LT', 8: 'CT', 9: 'RT', 10: 'RA', 11: 'RL', 12: 'HD' },
  front: { 2: 'CT', 3: 'RA', 4: 'RA', 5: 'RL', 6: 'RT', 7: 'CT', 8: 'LT', 9: 'LL', 10: 'LA', 11: 'LA', 12: 'HD' },
  right: { 2: 'RT', 3: 'RL', 4: 'RA', 5: 'RA', 6: 'RL', 7: 'RT', 8: 'CT', 9: 'LT', 10: 'LA', 11: 'LL', 12: 'HD' },
}
/** HITLOC-006 (2026 reversed): 1d6 → location. */
export const PUNCH_TABLE: Readonly<Record<Column, readonly Loc[]>> = {
  left: ['LA', 'LA', 'CT', 'LT', 'LT', 'HD'],
  front: ['RA', 'RT', 'CT', 'LT', 'LA', 'HD'],
  right: ['RA', 'RA', 'CT', 'RT', 'RT', 'HD'],
}
/** HITLOC-007: 1d6 → leg. */
export const KICK_TABLE: Readonly<Record<Column, readonly Loc[]>> = {
  left: ['LL', 'LL', 'LL', 'LL', 'LL', 'LL'],
  front: ['RL', 'RL', 'RL', 'LL', 'LL', 'LL'],
  right: ['RL', 'RL', 'RL', 'RL', 'RL', 'RL'],
}

export const columnFor = (d: AttackDirection): Column => (d === 'left' ? 'left' : d === 'right' ? 'right' : 'front')
export const isTorso = (l: Loc): boolean => l === 'CT' || l === 'LT' || l === 'RT'
/** HITLOC-008: attacks on a prone 'Mech use the standard table (DFA callers pass table 'standard' with direction 'rear'). */
export const effectiveTable = (table: HitTable, prone: boolean): HitTable => (prone ? 'standard' : table)
export const sideFor = (loc: Loc, direction: AttackDirection): ArmorSide => (direction === 'rear' && isTorso(loc) ? 'rear' : 'front')

/** Pure lookup. `total` is the 2d6 total (standard) or the d6 face (punch/kick). */
export function locationFor(table: HitTable, direction: AttackDirection, total: number): Loc {
  const col = columnFor(direction)
  if (table === 'standard') return HIT_TABLE[col][total]!
  if (table === 'punch') return PUNCH_TABLE[col][total - 1]!
  return KICK_TABLE[col][total - 1]!
}

const WAYS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]

/** Closed-form location distribution for the UI and AI (query.hitTable). TAC = the natural-2 location (standard table only). */
export function hitLocationDistribution(direction: AttackDirection, table: HitTable, opts: { prone?: boolean; partialCover?: boolean } = {}): HitTableView {
  const t = effectiveTable(table, !!opts.prone)
  const probs: Partial<Record<Loc, number>> = {}
  const add = (l: Loc, p: number): void => { probs[l] = (probs[l] ?? 0) + p }
  if (t === 'standard') {
    for (let r = 2; r <= 12; r++) add(locationFor('standard', direction, r), WAYS[r]! / 36)
  } else {
    for (let r = 1; r <= 6; r++) add(locationFor(t, direction, r), 1 / 6)
  }
  if (opts.partialCover) { delete probs.LL; delete probs.RL } // leg hits are absorbed by the cover (LOS-032)
  return { probs, tac: t === 'standard' ? locationFor('standard', direction, 2) : null, pTac: t === 'standard' ? 1 / 36 : 0 }
}

export interface LocationRollInput {
  attackId: AttackId | null
  unitId: UnitId // the unit hit
  attackerId?: UnitId
  table: HitTable
  direction: AttackDirection
  prone?: boolean
  group: number
  damage: number
  floatingCrits?: boolean
}
export interface LocationRoll { location: Loc; side: ArmorSide; tac: boolean; tacLocation: Loc | null; table: HitTable; roll: number }

/** Rolls the location for one damage group and emits HitLocated (HITLOC-002). Punch/kick: no TAC. */
export function rollHitLocation(w: Work, p: LocationRollInput): LocationRoll {
  const table = effectiveTable(p.table, !!p.prone)
  const purpose = table === 'standard' ? 'hitLocation' : table === 'punch' ? 'punchLocation' : 'kickLocation'
  const spec: Parameters<typeof roll2d6>[1] = { purpose, unitId: p.unitId }
  if (p.attackId) spec.attackId = p.attackId
  if (p.attackerId) spec.targetId = p.attackerId
  const r = table === 'standard' ? roll2d6(w, spec) : roll1d6(w, spec)
  const location = locationFor(table, p.direction, r.total)
  const tac = table === 'standard' && r.total === 2
  let tacLocation: Loc | null = tac ? location : null
  if (tac && p.floatingCrits) {
    // HITLOC-005: the TAC check goes to a location found by re-rolling on the same column, repeating on a 2
    for (;;) {
      const rr = roll2d6(w, { purpose: 'hitLocation', unitId: p.unitId, reason: 'floatingCrit' })
      if (rr.total !== 2) { tacLocation = locationFor('standard', p.direction, rr.total); break }
    }
  }
  const side = sideFor(location, p.direction)
  const ev: HitLocated = {
    type: 'HitLocated', attackId: p.attackId, unitId: p.unitId, group: p.group, damage: p.damage, table, direction: p.direction,
    roll: r.total, location, side, tac,
  }
  w.ev.push(ev)
  return { location, side, tac, tacLocation, table, roll: r.total }
}
