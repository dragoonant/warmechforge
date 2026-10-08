// Closed-form probabilities for the UI and AI (query.* back ends). No dice, no state.
import { clusterDistribution, expectedClusterHits } from './cluster'
import { hitLocationDistribution } from './hitloc'
import type { AttackDirection, HitTable, Loc } from './types'

export { clusterDistribution, expectedClusterHits, hitLocationDistribution }

const WAYS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1] // index = 2d6 total

/** P(2d6 >= tn): tn <= 2 -> 1, tn >= 13 -> 0. */
export function pAtLeast2d6(tn: number): number {
  if (tn <= 2) return 1
  if (tn > 12) return 0
  let w = 0
  for (let t = tn; t <= 12; t++) w += WAYS[t]!
  return w / 36
}

/** P(2d6 total = t). */
export const p2d6Exactly = (t: number): number => (t < 2 || t > 12 ? 0 : WAYS[t]! / 36)

/** CRIT-001: P(number of crits) as {0,1,2,3}; a 12 counts as 3 (torso) and, for limbs/head, `blowOff` is reported separately. */
export function critCountDistribution(mod = 0): { none: number; one: number; two: number; three: number } {
  const p = (lo: number, hi: number): number => {
    let s = 0
    for (let t = 2; t <= 12; t++) { const m = t + mod; if (m >= lo && m <= hi) s += WAYS[t]! / 36 }
    return s
  }
  return { none: p(-99, 7), one: p(8, 9), two: p(10, 11), three: p(12, 99) }
}
/** P(a crit check blows the limb or head off): modified 2d6 >= 12. */
export const pBlowOff = (mod = 0): number => critCountDistribution(mod).three

/** Expected damage of one hitting group set: sum over groups, no armor modelling. */
export function expectedHitDamage(opts: { damage: number; cluster?: { rackSize: number; mod?: number } }): number {
  if (!opts.cluster) return opts.damage
  return opts.damage * expectedClusterHits(opts.cluster.rackSize, opts.cluster.mod ?? 0)
}

/** Expected damage of a shot at the given TN (auto-hit/impossible handled). */
export function expectedShotDamage(tn: number, opts: { damage: number; cluster?: { rackSize: number; mod?: number } }): number {
  return pAtLeast2d6(tn) * expectedHitDamage(opts)
}

/** P(a hit lands on `loc`). */
export function pLocation(direction: AttackDirection, table: HitTable, loc: Loc, opts: { prone?: boolean; partialCover?: boolean } = {}): number {
  return hitLocationDistribution(direction, table, opts).probs[loc] ?? 0
}
