// Expected damage the damage pipeline lands (00 §6, damage.ts resolveGroupW / applyDamageW), for the previews
// (query.attackPreview / firePreview / physicalPreview / threat). Each damage group is followed through the hit location
// distribution, partial cover (leg hits absorbed, LOS-032), aimed shots (HITLOC-006), transfer through destroyed locations
// (DMG-003) and ferro-lamellor (EQUIP-014: floor(4/5 x damage) at every location whose struck armor still stands), exactly as
// the pipeline applies them to the current state. "Landed" = the points that reach the target after cover and ferro-lamellor,
// counting points lost beyond a destroyed head / centre torso (sum of DamageApplied.damage - transferred).
import { clusterDistribution, clusterGroups } from './cluster'
import { isLamellor, TRANSFER } from './damage'
import { hitLocationDistribution, isTorso, sideFor } from './hitloc'
import type { AttackDirection, DataBundle, HitTable, Loc, UnitState } from './types'

export interface LandingSpec {
  direction: AttackDirection
  table: HitTable
  /** The pipeline's partial-cover flag for this attack (ranged only). */
  partialCover?: boolean
  /** Aimed shot location (HITLOC-006): forced on a d6 of 4+, else the normal table (legs re-rolled under partial cover). */
  aimedAt?: Loc | null
}

/** One damage group's possible outcomes: the probability of each group list given the attack hits. */
export interface GroupOutcome { p: number; groups: readonly number[] }

/** Points of one group of `amount` that land when it strikes `loc` (damage.ts applyDamageW, read-only replay). */
export function landedAt(u: UnitState, loc: Loc, direction: AttackDirection, amount: number, lam: boolean): number {
  const rearAttack = sideFor(loc, direction) === 'rear' // the pipeline keeps the first location's side for transfers
  let cur: Loc | null = loc
  let amt = amount
  let landed = 0
  for (let guard = 0; amt > 0 && cur !== null && guard < 8; guard++) {
    const L = u.locs[cur]
    const next: Loc | null = TRANSFER[cur] ?? null
    if (!L) break
    if (L.destroyed) {
      if (!next) { landed += amt; break }
      cur = next
      continue
    }
    const armor = rearAttack && isTorso(cur) ? L.rear ?? 0 : L.armor
    if (lam && armor > 0) {
      amt = Math.floor((amt * 4) / 5)
      if (amt <= 0) break
    }
    const rest = amt - Math.min(amt, armor)
    const sdmg = Math.min(rest, L.structure)
    const excess = rest - sdmg
    const transfers = L.structure - sdmg === 0 && excess > 0 && next !== null
    landed += transfers ? amt - excess : amt
    if (!transfers) break
    amt = excess
    cur = next
  }
  return landed
}

/** Where one group lands: P(location) after aimed shots and partial cover (absorbed leg hits are simply missing). */
export function landingOdds(u: UnitState, spec: LandingSpec): Partial<Record<Loc, number>> {
  const prone = !!u.prone
  if (spec.aimedAt) {
    const rest = hitLocationDistribution(spec.direction, spec.table, { prone, partialCover: !!spec.partialCover }).probs
    const total = Object.values(rest).reduce((a, p) => a + (p ?? 0), 0) || 1
    const out: Partial<Record<Loc, number>> = {}
    for (const [l, p] of Object.entries(rest) as [Loc, number][]) out[l] = (0.5 * p) / total // legs re-rolled: renormalised
    out[spec.aimedAt] = (out[spec.aimedAt] ?? 0) + 0.5
    return out
  }
  return hitLocationDistribution(spec.direction, spec.table, { prone, partialCover: !!spec.partialCover }).probs
}

/** Does ferro-lamellor cut weapon / physical damage against this unit (EQUIP-014)? */
export const lamellorTarget = (data: DataBundle, u: UnitState): boolean => isLamellor(data, u.mechId)

/**
 * Expected landed damage per successful hit for the given group outcomes, plus the expected points ferro-lamellor stops.
 * Without ferro-lamellor every group lands in full wherever it strikes, so only the cover-absorbed share is removed.
 */
export function expectedLanded(data: DataBundle, u: UnitState, spec: LandingSpec, outcomes: readonly GroupOutcome[]): { landed: number; stopped: number; nominal: number } {
  const odds = landingOdds(u, spec)
  const lam = lamellorTarget(data, u)
  let nominal = 0
  for (const o of outcomes) for (const g of o.groups) nominal += o.p * g
  if (!lam) {
    const share = Object.values(odds).reduce((a, p) => a + (p ?? 0), 0)
    return { landed: nominal * share, stopped: 0, nominal }
  }
  const memo = new Map<number, { landed: number; reached: number }>()
  const perGroup = (amount: number): { landed: number; reached: number } => {
    let v = memo.get(amount)
    if (v) return v
    let landed = 0, reached = 0
    for (const [l, p] of Object.entries(odds) as [Loc, number][]) {
      if (!p) continue
      reached += p * amount
      landed += p * landedAt(u, l, spec.direction, amount, true)
    }
    v = { landed, reached }
    memo.set(amount, v)
    return v
  }
  let landed = 0, reached = 0
  for (const o of outcomes) {
    if (!o.p) continue
    for (const g of o.groups) { const v = perGroup(g); landed += o.p * v.landed; reached += o.p * v.reached }
  }
  return { landed, stopped: Math.max(0, reached - landed), nominal }
}

/** Group outcomes of a ranged hit: one group, or the cluster roll's distribution split into groups (CLUS-003, HITLOC-010). */
export function rangedOutcomes(damage: number, cluster: { rackSize: number; perGroup: number; mod: number; streak: boolean } | null): GroupOutcome[] {
  if (!cluster) return damage > 0 ? [{ p: 1, groups: [damage] }] : []
  if (cluster.streak) return [{ p: 1, groups: clusterGroups(cluster.rackSize, damage, cluster.perGroup) }]
  return clusterDistribution(cluster.rackSize, cluster.mod)
    .map((p, k) => ({ p, groups: clusterGroups(k, damage, cluster.perGroup) }))
    .filter((o) => o.p > 0)
}
