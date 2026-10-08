// Per-location damage marginals, P(location destroyed), pKill and the damage value DV (40-ai §4.4, §4.5).
// A volley is a list of attacks from one direction against one target; every per-attack number (pHit, damage per hit,
// cluster hits, table, partial cover, direction) comes from an engine preview. This file only does the probability.
import type { AttackDirection, AttackPreview, HitTable, Loc, UnitId } from '../engine/index'
import { clusterDistFor, groupsFor, hitTable, LOC_LIST } from './prob'
import { INWARD, type AiCtx } from './ctx'

export interface AttackIn {
  pHit: number
  table: HitTable
  partialCover: boolean
  /** Damage per hit (per missile for cluster weapons). */
  damage: number
  /** Cluster weapons: rack size, the preview's expected hits and missiles per damage group. */
  cluster: { rackSize: number; expectedHits: number; perGroup: number } | null
  /** Fixed damage groups for one hit (charge / DFA / fall damage in 5-point groups); overrides damage and cluster. */
  groups?: number[]
}

/** One location of a target as the AI sees it: remaining armor on each side, structure, and its values. */
export interface LocModel { armorF: number; armorR: number; structure: number; destroyed: boolean; ld: number; crit: number; kill: boolean }
export interface TargetModel { id: UnitId; m: number; killValue: number; prone: boolean; locs: Record<Loc, LocModel> }

const TORSO: Partial<Record<Loc, true>> = { CT: true, LT: true, RT: true }

/** The target's current locations, minus damage our earlier declarations this phase are expected to do (plan memo, §8.6). */
export function targetModel(ctx: AiCtx, id: UnitId, planned?: Partial<Record<Loc, { f: number; r: number }>>): TargetModel {
  const u = ctx.unit(id)
  const facts = ctx.factsOf(id)
  const locs = {} as Record<Loc, LocModel>
  for (const l of LOC_LIST) {
    const L = u.locs[l]
    let armorF = L.armor, armorR = L.rear ?? L.armor, structure = L.structure
    const pl = planned?.[l]
    if (pl && !L.destroyed) {
      const spillF = Math.max(0, pl.f - armorF)
      armorF = Math.max(0, armorF - pl.f)
      if (TORSO[l]) { const spillR = Math.max(0, pl.r - armorR); armorR = Math.max(0, armorR - pl.r); structure = Math.max(0, structure - spillF - spillR) }
      else { armorR = armorF; structure = Math.max(0, structure - spillF) }
    }
    armorF = Math.round(armorF); armorR = Math.round(armorR); structure = Math.round(structure)
    const lv = facts.locValue[l]
    locs[l] = { armorF, armorR, structure, destroyed: L.destroyed || structure <= 0, ld: lv.ld, crit: lv.crit, kill: lv.kill }
  }
  return { id, m: ctx.focus(id), killValue: facts.kill, prone: u.prone, locs }
}

export function attackFromPreview(pv: AttackPreview, perGroup: number): AttackIn {
  return {
    pHit: pv.legal ? pv.pHit : 0, table: pv.table, partialCover: pv.partialCover, damage: pv.damage,
    cluster: pv.cluster ? { rackSize: pv.cluster.rackSize, expectedHits: pv.cluster.expectedHits, perGroup } : null,
  }
}

/** Hit probabilities per location, with destroyed locations folded into the location their damage transfers to. */
function locProbs(direction: AttackDirection, table: HitTable, partialCover: boolean, t: TargetModel): Partial<Record<Loc, number>> {
  const ht = hitTable(direction, table, partialCover, t.prone)
  const q: Partial<Record<Loc, number>> = {}
  for (const l of LOC_LIST) {
    const p = ht.probs[l] ?? 0
    if (!p) continue
    let to: Loc | undefined = l
    while (to && t.locs[to].destroyed) to = INWARD[to]
    if (!to) continue // damage beyond a destroyed head / CT is lost
    q[to] = (q[to] ?? 0) + p
  }
  return q
}

// truncated convolution: index cap means "cap or more"
function conv(a: number[], b: number[], cap: number): number[] {
  const out = new Array<number>(cap + 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    if (ai === 0) continue
    for (let j = 0; j < b.length; j++) {
      const bj = b[j]!
      if (bj === 0) continue
      const k = Math.min(cap, i + j)
      out[k]! += ai * bj
    }
  }
  return out
}

/** Damage distribution one attack puts on a location hit with probability q per group (truncated at cap). */
function attackOnLoc(a: AttackIn, q: number, cap: number): number[] {
  const out = new Array<number>(cap + 1).fill(0)
  out[0] = 1 - a.pHit
  if (a.pHit <= 0) return out
  if (a.groups) {
    let g: number[] = [1]
    for (const dmg of a.groups) {
      const step = new Array<number>(Math.min(cap, dmg) + 1).fill(0)
      step[0] = 1 - q
      step[Math.min(cap, dmg)]! += q
      g = conv(g, step, cap)
    }
    for (let i = 0; i < g.length; i++) out[Math.min(cap, i)]! += a.pHit * g[i]!
    return out
  }
  if (!a.cluster) {
    out[0]! += a.pHit * (1 - q)
    out[Math.min(cap, a.damage)]! += a.pHit * q
    return out
  }
  const dist = clusterDistFor(a.cluster.rackSize, a.cluster.expectedHits)
  for (let k = 0; k < dist.length; k++) {
    const pk = dist[k]!
    if (!pk) continue
    let g: number[] = [1]
    for (const dmg of groupsFor(k, a.damage, a.cluster.perGroup)) {
      const step = new Array<number>(Math.min(cap, dmg) + 1).fill(0)
      step[0] = 1 - q
      step[Math.min(cap, dmg)]! += q
      g = conv(g, step, cap)
    }
    for (let i = 0; i < g.length; i++) out[Math.min(cap, i)]! += a.pHit * pk * g[i]!
  }
  return out
}

export interface VolleyValue {
  dv: number
  pKill: number
  /** Expected damage per location (for the plan memo and the ammo-bin choice). */
  expected: Partial<Record<Loc, number>>
  pDestroyed: Partial<Record<Loc, number>>
  expectedTotal: number
}

/**
 * DV(t, A, d) (40-ai §4.5): m(t) × Σ_l [E[armor dmg] + 1.5 E[structure dmg] + crit expectation + P(l destroyed) × LD(l)],
 * pKill from the kill locations. `selfValue` uses the same function for damage we take (DVself).
 */
export function volleyValue(t: TargetModel, direction: AttackDirection, attacks: readonly AttackIn[]): VolleyValue {
  const res: VolleyValue = { dv: 0, pKill: 0, expected: {}, pDestroyed: {}, expectedTotal: 0 }
  const live = attacks.filter((a) => a.pHit > 0 && (a.damage > 0 || (a.groups?.length ?? 0) > 0))
  if (!live.length) return res
  // group attacks by (table, partial cover): each has its own location probabilities
  const qCache = new Map<string, Partial<Record<Loc, number>>>()
  const qFor = (a: AttackIn): Partial<Record<Loc, number>> => {
    const k = `${a.table}|${a.partialCover ? 1 : 0}`
    let q = qCache.get(k)
    if (!q) { q = locProbs(direction, a.table, a.partialCover, t); qCache.set(k, q) }
    return q
  }
  let survive = 1
  let tacHits = 0
  for (const a of live) {
    const groups = a.groups ? a.groups.length : a.cluster ? Math.max(1, Math.ceil(a.cluster.expectedHits / Math.max(1, a.cluster.perGroup))) : 1
    tacHits += a.pHit * groups
  }
  const rear = direction === 'rear'
  for (const l of LOC_LIST) {
    const L = t.locs[l]
    if (L.destroyed) continue
    const armor = rear && TORSO[l] ? L.armorR : L.armorF
    const R = armor + L.structure
    if (R <= 0) continue
    let D: number[] = [1]
    let any = false
    for (const a of live) {
      const q = qFor(a)[l] ?? 0
      if (!q) continue
      any = true
      D = conv(D, attackOnLoc(a, q, R), R)
    }
    if (!any) continue
    let eArmor = 0, eStruct = 0, pPen = 0, eDmg = 0
    for (let d = 1; d < D.length; d++) {
      const p = D[d]!
      if (!p) continue
      eArmor += p * Math.min(d, armor)
      eStruct += p * Math.min(Math.max(0, d - armor), L.structure)
      if (d > armor) pPen += p
      eDmg += p * d
    }
    const pDes = D.length > R ? D[R]! : 0
    const blowOff = l === 'HD' || l === 'LA' || l === 'RA' || l === 'LL' || l === 'RL' ? (1 / 36) * L.ld : 0
    const critExp = pPen * ((22 / 36) * L.crit + blowOff)
    res.dv += eArmor + 1.5 * eStruct + critExp + pDes * L.ld
    res.expected[l] = eDmg
    res.pDestroyed[l] = pDes
    res.expectedTotal += eDmg
    if (L.kill) survive *= 1 - pDes
  }
  // through-armor critical chance on the "2" result (TAC), small
  const ht = hitTable(direction, 'standard', false, t.prone)
  if (ht.tac && !t.locs[ht.tac].destroyed) res.dv += tacHits * ht.pTac * (22 / 36) * t.locs[ht.tac].crit
  res.pKill = 1 - survive
  res.dv *= t.m
  return res
}

/**
 * Fast additive value of one point of expected damage on the target from a direction (stage-1 movement pre-score):
 * Σ_l q_l × (armor 1.0 / structure 1.5 + destruction value spread over the points left).
 */
export function valuePerPoint(t: TargetModel, direction: AttackDirection, table: HitTable = 'standard'): number {
  const q = locProbs(direction, table, false, t)
  const rear = direction === 'rear'
  let v = 0
  for (const l of LOC_LIST) {
    const p = q[l]
    if (!p) continue
    const L = t.locs[l]
    const armor = rear && TORSO[l] ? L.armorR : L.armorF
    const R = Math.max(1, armor + L.structure)
    v += p * ((armor > 0 ? 1 : 1.5) + (L.ld + 0.6 * L.crit) / R)
  }
  return v * t.m
}
