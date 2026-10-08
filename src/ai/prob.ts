// Closed-form dice math for the AI (40-ai §4): thin memoised wrappers over the engine's numbers. The engine owns every
// table (query.hitTable, query.clusterTable, the 2d6 helpers in src/engine/prob.ts); this file only caches and combines them.
import { query } from '../engine/index'
import type { AttackDirection, HitTable, HitTableView, Loc } from '../engine/index'
import { pAtLeast2d6, p2d6Exactly } from '../engine/prob'

export { pAtLeast2d6, p2d6Exactly }

/** P(2d6 ≥ tn) (attacks: TN ≤ 2 hits, TN > 12 misses; PSRs and avoid rolls use the same table). */
export const p2d6 = (tn: number): number => pAtLeast2d6(tn)
/** P(a 2d6 roll against `tn` fails). */
export const pFail = (tn: number | null): number => (tn === null ? 0 : 1 - pAtLeast2d6(tn))

const hitTables = new Map<string, HitTableView>()
/** query.hitTable, memoised (pure). */
export function hitTable(direction: AttackDirection, table: HitTable, partialCover = false, prone = false): HitTableView {
  const k = `${direction}|${table}|${partialCover ? 1 : 0}|${prone ? 1 : 0}`
  let v = hitTables.get(k)
  if (!v) { v = query.hitTable(direction, table, { partialCover, prone }); hitTables.set(k, v) }
  return v
}

const clusterTables = new Map<string, number[]>()
/** query.clusterTable, memoised: P(hits = k) for k = 0..rack. */
export function clusterTable(rack: number, mod: number): number[] {
  const k = `${rack}|${mod}`
  let v = clusterTables.get(k)
  if (!v) { v = query.clusterTable(rack, mod); clusterTables.set(k, v) }
  return v
}
export const meanOf = (dist: readonly number[]): number => dist.reduce((s, p, k) => s + p * k, 0)

const fitted = new Map<string, number[]>()
/**
 * The hits distribution behind an attack preview's `cluster.expectedHits`: the engine's cluster table whose mean matches
 * the preview (the preview already folds Artemis, the weapon's cluster modifier and Streak into that mean).
 */
export function clusterDistFor(rack: number, expectedHits: number): number[] {
  const key = `${rack}|${expectedHits.toFixed(4)}`
  let v = fitted.get(key)
  if (v) return v
  if (expectedHits >= rack - 1e-9) {
    v = Array.from({ length: rack + 1 }, (_, i) => (i === rack ? 1 : 0)) // Streak: every missile hits
  } else {
    let best: number[] = clusterTable(rack, 0), err = Infinity
    for (let m = -6; m <= 6; m++) {
      const d = clusterTable(rack, m)
      const e = Math.abs(meanOf(d) - expectedHits)
      if (e < err) { err = e; best = d }
    }
    v = best
  }
  fitted.set(key, v)
  return v
}

/** Damage groups for `hits` missiles of `dmg` each, `perGroup` missiles a group, full groups first (HITLOC-010 shape). */
export function groupsFor(hits: number, dmg: number, perGroup: number): number[] {
  const out: number[] = []
  const g = Math.max(1, perGroup)
  let left = hits
  while (left > 0) { const n = Math.min(g, left); out.push(n * dmg); left -= n }
  return out
}

export const LOC_LIST: readonly Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']
