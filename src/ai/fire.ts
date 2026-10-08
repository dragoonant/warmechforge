// Ranged Attack Phase planning (40-ai §8): shot options from engine previews, the multiple-choice heat knapsack over
// weapon/target/ammo, exact re-score of the candidate sets (DV with pKill, minus the soft heat cost) under the tier's heat
// cap, primary-target search and torso twist. Also the fast single-target planner the movement score uses (§6.2 Dealt).
import type {
  AttackDirection, AttackPreview, FireShot, LocalId, Loc, Twist, UnitAt, UnitId,
} from '../engine/index'
import { query } from '../engine/index'
import type { AiCtx, WeaponInfo } from './ctx'
import { attackFromPreview, targetModel, valuePerPoint, volleyValue, type AttackIn, type TargetModel } from './damage'
import { heatCapFor, heatCost } from './heat'
import { hitTable, p2d6 } from './prob'

export interface ShotOption {
  mountId: LocalId
  targetId: UnitId
  binId?: LocalId
  heat: number
  pv: AttackPreview
  attack: AttackIn
  value: number // additive single-shot value
  shots: number // ammo shots left in the bin (Infinity for energy)
  /** Rapid-fire mode (Ultra AC double tap); absent = one shot. */
  rapidShots?: number
}

export interface FirePlanResult {
  shots: ShotOption[]
  twist: Twist
  score: number
  dv: number
  heatEnd: number
  pKill: number
  /** Expected damage per target location (plan memo / analytics). */
  expectedByTarget: Record<UnitId, Partial<Record<Loc, number>>>
}

// ---------- plan memo (40-ai §8.6): damage our earlier declarations this phase are expected to do ----------
export function plannedDamage(ctx: AiCtx): Record<UnitId, Partial<Record<Loc, { f: number; r: number }>>> {
  const out: Record<UnitId, Partial<Record<Loc, { f: number; r: number }>>> = {}
  const s = ctx.state
  for (const d of s.declarations) {
    if (d.kind !== 'ranged' || !d.targetId) continue
    const a = s.units[d.attackerId]
    if (!a || a.owner !== ctx.me) continue
    const pv = query.attackPreview(s, { attackerId: d.attackerId, mountId: d.mountId, targetId: d.targetId, ...(d.binId ? { binId: d.binId } : {}), ...(d.rapidShots ? { rapidShots: d.rapidShots } : {}) })
    const perHit = pv.damage * (pv.cluster ? pv.cluster.expectedHits : 1)
    const pHit = p2d6(d.tn)
    const ht = hitTable(d.direction, d.table, d.partialCover, s.units[d.targetId]?.prone ?? false)
    const m = (out[d.targetId] ??= {})
    for (const [l, q] of Object.entries(ht.probs) as [Loc, number][]) {
      const e = pHit * perHit * q
      const cur = (m[l] ??= { f: 0, r: 0 })
      if (d.direction === 'rear') cur.r += e; else cur.f += e
    }
  }
  return out
}

/** P(kill) our earlier declarations this phase already put on each target (so later shooters stop piling on). */
export function plannedKill(ctx: AiCtx): Record<UnitId, number> {
  const out: Record<UnitId, number> = {}
  const s = ctx.state
  const byT = new Map<UnitId, { dir: AttackDirection; attacks: AttackIn[] }>()
  for (const d of s.declarations) {
    if (d.kind !== 'ranged' || !d.targetId) continue
    const a = s.units[d.attackerId]
    if (!a || a.owner !== ctx.me) continue
    const pv = query.attackPreview(s, { attackerId: d.attackerId, mountId: d.mountId, targetId: d.targetId, ...(d.binId ? { binId: d.binId } : {}), ...(d.rapidShots ? { rapidShots: d.rapidShots } : {}) })
    if (!pv.legal) continue
    const w = ctx.factsOf(d.attackerId).weapons.find((x) => x.mountId === d.mountId)
    let g = byT.get(d.targetId)
    if (!g) { g = { dir: pv.direction, attacks: [] }; byT.set(d.targetId, g) }
    g.attacks.push(attackFromPreview(pv, w ? perGroupOf(w) : 1))
  }
  for (const [t, g] of byT) out[t] = volleyValue(targetModel(ctx, t), g.dir, g.attacks).pKill
  return out
}

/** Target models for every live enemy, with the plan memo applied (cached per decision). A target already likely dead from
 *  earlier declarations, or helpless (unconscious pilot, immobile and down), is worth less than an active one. */
export function enemyModels(ctx: AiCtx): Map<UnitId, TargetModel> {
  const k = 'enemyModels'
  let v = ctx.memo.get(k) as Map<UnitId, TargetModel> | undefined
  if (v) return v
  const ranged = ctx.state.phase === 'rangedAttack'
  const planned = ranged ? plannedDamage(ctx) : {}
  const pk = ranged ? plannedKill(ctx) : {}
  v = new Map(ctx.enemiesOf().map((id) => {
    const m = targetModel(ctx, id, planned[id])
    const u = ctx.unit(id)
    let f = 1 - 0.9 * Math.min(1, pk[id] ?? 0)
    if (!u.pilot.conscious) f *= 0.7
    else if (u.prone && (u.locs.LL.destroyed || u.locs.RL.destroyed)) f *= 0.85
    m.m *= f
    return [id, m] as const
  }))
  ctx.memo.set(k, v)
  return v
}

function perGroupOf(w: WeaponInfo): number { return w.cluster?.groupSize ?? 1 }

/** Every legal (weapon, target, ammo) shot from the attacker's (hypothetical) position with this primary target and twist. */
export function shotOptions(ctx: AiCtx, attackerId: UnitId, opts: {
  attackerAt?: UnitAt; targets: { id: UnitId; at?: UnitAt; model: TargetModel }[]; primaryId: UnitId | null; fast?: boolean; skip?: Set<LocalId>
}): ShotOption[] {
  const out: ShotOption[] = []
  const weapons = ctx.factsOf(attackerId).weapons
  const u = ctx.unit(attackerId)
  for (const w of weapons) {
    if (u.attacks.firedMounts.includes(w.mountId) && ctx.state.phase === 'rangedAttack') continue
    if (opts.skip?.has(w.mountId)) continue
    for (const t of opts.targets) {
      const ammoChoices: (undefined | { binId: LocalId; shots: number })[] = w.usesAmmo ? w.ammo.map((a) => ({ binId: a.binId, shots: a.shots })) : [undefined]
      for (const a of ammoChoices) {
        // one shot, plus each rapid-fire mode the bin can feed (the preview prices the cluster roll and the heat)
        for (const rapid of [1, ...w.rapidModes]) {
          if (a && rapid > a.shots) continue
          const pv = query.attackPreview(ctx.state, {
            attackerId, mountId: w.mountId, targetId: t.id,
            ...(opts.attackerAt ? { attackerAt: opts.attackerAt } : {}), ...(t.at ? { targetAt: t.at } : {}),
            primaryTargetId: opts.primaryId, ...(a ? { binId: a.binId } : {}), ...(rapid > 1 ? { rapidShots: rapid } : {}),
          })
          if (!pv.legal || pv.pHit <= 0) break
          const attack = attackFromPreview(pv, perGroupOf(w))
          let value = opts.fast
            ? pv.expectedDamage * valuePerPoint(t.model, pv.direction)
            : volleyValue(t.model, pv.direction, [attack]).dv
          // a rapid-fire weapon jams on an attack roll of 2 (1/36): about two turns of its single-shot output lost
          if (rapid > 1) value -= (1 / 36) * 2 * w.damage
          out.push({ mountId: w.mountId, targetId: t.id, ...(a ? { binId: a.binId } : {}), heat: pv.heat, pv, attack, value, shots: a ? a.shots : Infinity, ...(rapid > 1 ? { rapidShots: rapid } : {}) })
        }
      }
    }
  }
  return out
}

interface KnapItem { mountId: LocalId; options: ShotOption[] }

/** Multiple-choice knapsack over integer heat: best additive value for every total heat T (§8.3 step 1). */
export function knapsack(items: KnapItem[], maxHeat: number): { value: number; picks: ShotOption[] }[] {
  const H = Math.max(0, Math.floor(maxHeat))
  let best: (number | null)[] = new Array<number | null>(H + 1).fill(null)
  best[0] = 0
  const back: (ShotOption | null)[][] = []
  for (const it of items) {
    const next = best.slice()
    const choice: (ShotOption | null)[] = new Array<ShotOption | null>(H + 1).fill(null)
    for (let T = 0; T <= H; T++) {
      const b = best[T]
      if (b === null || b === undefined) continue
      for (const o of it.options) {
        const T2 = T + Math.max(0, Math.round(o.heat))
        if (T2 > H) continue
        const v = b + o.value
        const cur = next[T2]
        if (cur === null || cur === undefined || v > cur + 1e-12) { next[T2] = v; choice[T2] = o }
      }
    }
    back.push(choice) // per T: the option that beat holding this weapon (null = held)
    best = next
  }
  // rebuild sets by walking back
  const out: { value: number; picks: ShotOption[] }[] = []
  for (let T = 0; T <= H; T++) {
    if (best[T] === null || best[T] === undefined) continue
    const picks: ShotOption[] = []
    let t = T
    for (let i = items.length - 1; i >= 0; i--) {
      const c = back[i]![t]
      if (c) { picks.push(c); t -= Math.max(0, Math.round(c.heat)) }
    }
    if (t !== 0) continue // inconsistent back-pointer (value tie); skip that T
    out.push({ value: best[T]!, picks: picks.reverse() })
  }
  return out
}

/** Exact value of a shot set: Σ over targets of DV(t, S_t, d_t) and the best pKill. */
export function exactValue(models: Map<UnitId, TargetModel>, shots: ShotOption[]): { dv: number; pKill: number; expected: Record<UnitId, Partial<Record<Loc, number>>> } {
  const byT = new Map<UnitId, { dir: AttackDirection; attacks: AttackIn[] }>()
  for (const s of shots) {
    let g = byT.get(s.targetId)
    if (!g) { g = { dir: s.pv.direction, attacks: [] }; byT.set(s.targetId, g) }
    g.attacks.push(s.attack)
  }
  let dv = 0, pKill = 0
  const expected: Record<UnitId, Partial<Record<Loc, number>>> = {}
  for (const [t, g] of byT) {
    const m = models.get(t)
    if (!m) continue
    const v = volleyValue(m, g.dir, g.attacks)
    dv += v.dv
    pKill = Math.max(pKill, v.pKill)
    expected[t] = v.expected
  }
  return { dv, pKill, expected }
}

/** Heat base for the end-of-turn projection: H_end(S) = max(0, base + Σ weapon heat) with the engine's own parts. */
export function heatBase(ctx: AiCtx, unitId: UnitId, plan: { mode?: 'standStill' | 'walk' | 'run' | 'jump'; hexesJumped?: number } = {}): number {
  const p = query.heatProjection(ctx.state, unitId, { ...plan, mounts: [] })
  return p.now + p.generated - p.dissipation
}

/**
 * Full fire plan for a unit at its current position (normal: knapsack + primary search; easy: greedy by damage per heat).
 * `pDying` is P(the unit is destroyed this turn) from the threat model (raises the heat cap for a last stand).
 */
export function planFire(ctx: AiCtx, unitId: UnitId, opts: { twist?: Twist; pDying?: number; attackerAt?: UnitAt; collect?: FirePlanResult[]; skip?: Set<LocalId>; extraHeat?: number; models?: Map<UnitId, TargetModel>; noSat?: boolean } = {}): FirePlanResult {
  const models = opts.models ?? enemyModels(ctx)
  const enemies = [...models.keys()]
  const twist: Twist = opts.twist ?? (ctx.unit(unitId).attacks.twist ?? 0)
  const attackerAt: UnitAt = { ...(opts.attackerAt ?? {}), ...(opts.twist !== undefined ? { twist: opts.twist } : {}) }
  const hasAt = Object.keys(attackerAt).length > 0
  const base = heatBase(ctx, unitId) + (opts.extraHeat ?? 0)
  const empty: FirePlanResult = { shots: [], twist, score: -heatCost(ctx, unitId, Math.max(0, base)), dv: 0, heatEnd: Math.max(0, base), pKill: 0, expectedByTarget: {} }
  if (!enemies.length) return empty
  const targets = enemies.map((id) => ({ id, model: models.get(id)! }))
  const pDying = opts.pDying ?? 0

  // primary candidates: the enemies with the best single-target value (at most 3)
  const singleOpts = shotOptions(ctx, unitId, { ...(hasAt ? { attackerAt } : {}), targets, primaryId: null, ...(opts.skip ? { skip: opts.skip } : {}) })
  if (!singleOpts.length) return empty
  const perTarget = new Map<UnitId, number>()
  for (const o of singleOpts) perTarget.set(o.targetId, (perTarget.get(o.targetId) ?? 0) + o.value)
  const primaries = [...perTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, ctx.tier.knapsack ? 3 : 1).map((x) => x[0])

  let best: FirePlanResult = empty
  for (const p of primaries) {
    const all = ctx.tier.knapsack
      ? shotOptions(ctx, unitId, { ...(hasAt ? { attackerAt } : {}), targets, primaryId: p, ...(opts.skip ? { skip: opts.skip } : {}) })
      : singleOpts.filter((o) => o.targetId === p)
    // ammo discipline (§8.3 step 5): weak ammo shots only when there is plenty of ammo
    const opts2 = all.filter((o) => !(o.shots < 10 && o.pv.pHit < 6 / 36))
    const sets: { picks: ShotOption[] }[] = []
    if (ctx.tier.knapsack) {
      const byMount = new Map<LocalId, ShotOption[]>()
      for (const o of opts2) { const l = byMount.get(o.mountId); if (l) l.push(o); else byMount.set(o.mountId, [o]) }
      const items = [...byMount.entries()].map(([mountId, options]) => ({ mountId, options }))
      const maxHeat = items.reduce((s, it) => s + Math.max(0, ...it.options.map((o) => o.heat)), 0)
      for (const s of knapsack(items, maxHeat)) sets.push({ picks: s.picks })
    } else {
      // easy: one target, descending damage per heat while under the cap and pHit ≥ 6/36
      const order = opts2.filter((o) => o.pv.pHit >= 6 / 36).sort((a, b) => b.pv.expectedDamage / (b.heat + 1) - a.pv.expectedDamage / (a.heat + 1))
      const used = new Set<LocalId>()
      const picks: ShotOption[] = []
      for (const o of order) {
        if (used.has(o.mountId)) continue
        const heat = picks.reduce((s, x) => s + x.heat, 0) + o.heat
        if (Math.max(0, base + heat) > ctx.tier.heatCap) continue
        picks.push(o); used.add(o.mountId)
        sets.push({ picks: picks.slice() })
      }
    }
    for (const s of sets) {
      if (!s.picks.length) continue
      if (!s.picks.some((x) => x.targetId === p)) continue // the primary must be fired at (it is the first shot)
      const heat = s.picks.reduce((a, x) => a + x.heat, 0)
      const H = Math.max(0, Math.round(base + heat))
      const ev = exactValue(models, s.picks)
      const cap = heatCapFor(ctx, unitId, { pKill: ev.pKill, pDying })
      if (H > cap && H > Math.max(0, Math.round(base))) continue
      const score = ev.dv - heatCost(ctx, unitId, H)
      if (opts.collect) opts.collect.push({ shots: [...s.picks.filter((x) => x.targetId === p), ...s.picks.filter((x) => x.targetId !== p)], twist, score, dv: ev.dv, heatEnd: H, pKill: ev.pKill, expectedByTarget: {} })
      const better = score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && H < best.heatEnd)
      if (better) {
        // primary first, the rest in mount order (stable)
        const shots = [...s.picks.filter((x) => x.targetId === p), ...s.picks.filter((x) => x.targetId !== p)]
        best = { shots, twist, score, dv: ev.dv, heatEnd: H, pKill: ev.pKill, expectedByTarget: ev.expected }
      }
    }
  }
  return !opts.noSat && ctx.tier.knapsack && best.shots.length > 1 ? desaturate(ctx, unitId, best, models, opts, base) : best
}

const SATURATED = 0.9

/** Overkill guard: once a target's kill is near certain, the surplus weapons go to the next best target. */
function desaturate(ctx: AiCtx, unitId: UnitId, plan: FirePlanResult, models: Map<UnitId, TargetModel>, opts: Parameters<typeof planFire>[2], base: number): FirePlanResult {
  const keep: ShotOption[] = []
  let released = false
  const byT = new Map<UnitId, ShotOption[]>()
  for (const s of plan.shots) { const l = byT.get(s.targetId); if (l) l.push(s); else byT.set(s.targetId, [s]) }
  const keptModels = new Map(models)
  for (const [t, list] of byT) {
    const m = models.get(t)
    if (!m || list.length < 2 || exactValue(models, list).pKill < SATURATED) { keep.push(...list); continue }
    const kept: ShotOption[] = []
    for (const o of [...list].sort((a, b) => b.value - a.value)) {
      kept.push(o)
      if (exactValue(models, kept).pKill >= SATURATED) break
    }
    if (kept.length < list.length) released = true
    keep.push(...kept)
    keptModels.set(t, { ...m, m: m.m * Math.max(0.05, 1 - exactValue(models, kept).pKill) })
  }
  if (!released) return plan
  const extraHeat = keep.reduce((a, x) => a + x.heat, 0)
  const more = planFire(ctx, unitId, { ...(opts ?? {}), twist: plan.twist, skip: new Set([...(opts?.skip ?? []), ...keep.map((x) => x.mountId)]), extraHeat: (opts?.extraHeat ?? 0) + extraHeat, models: keptModels, noSat: true })
  const shots = [...keep, ...more.shots]
  const ev = exactValue(models, shots)
  const H = Math.max(0, Math.round(base + shots.reduce((a, x) => a + x.heat, 0) - (opts?.extraHeat ?? 0)))
  return { shots, twist: plan.twist, score: ev.dv - heatCost(ctx, unitId, H), dv: ev.dv, heatEnd: H, pKill: ev.pKill, expectedByTarget: ev.expected }
}

export function toFireShots(plan: FirePlanResult): FireShot[] {
  return plan.shots.map((s) => ({ mountId: s.mountId, targetId: s.targetId, ...(s.binId ? { binId: s.binId } : {}), ...(s.rapidShots ? { rapidShots: s.rapidShots } : {}) }))
}

/**
 * Fast Dealt for a movement candidate (§6.2): best single-target additive value over the enemies under the heat allowance,
 * with the candidate's position, facing and mode. Returns the value and the weapon heat used.
 */
export function fastDealt(ctx: AiCtx, unitId: UnitId, at: UnitAt, targets: { id: UnitId; at?: UnitAt; model: TargetModel }[], allowance: number): { value: number; heat: number; best: UnitId | null } {
  let bestV = 0, bestH = 0, bestT: UnitId | null = null
  for (const t of targets) {
    const opts = shotOptions(ctx, unitId, { attackerAt: at, targets: [t], primaryId: null, fast: true })
    if (!opts.length) continue
    const byMount = new Map<LocalId, ShotOption[]>()
    for (const o of opts) { const l = byMount.get(o.mountId); if (l) l.push(o); else byMount.set(o.mountId, [o]) }
    const items = [...byMount.entries()].map(([mountId, options]) => ({ mountId, options }))
    const res = knapsackBest(items, Math.max(0, allowance))
    if (res.value > bestV) { bestV = res.value; bestH = res.heat; bestT = t.id }
  }
  return { value: bestV, heat: bestH, best: bestT }
}

/** Best additive value with total heat ≤ maxHeat (value only; no back-pointers). */
export function knapsackBest(items: KnapItem[], maxHeat: number): { value: number; heat: number } {
  const H = Math.max(0, Math.floor(maxHeat))
  let best = new Array<number>(H + 1).fill(-1)
  best[0] = 0
  for (const it of items) {
    const next = best.slice()
    for (let T = 0; T <= H; T++) {
      const b = best[T]!
      if (b < 0) continue
      for (const o of it.options) {
        const T2 = T + Math.max(0, Math.round(o.heat))
        if (T2 > H) continue
        if (b + o.value > next[T2]!) next[T2] = b + o.value
      }
    }
    best = next
  }
  let v = 0, h = 0
  for (let T = 0; T <= H; T++) if (best[T]! > v + 1e-9) { v = best[T]!; h = T }
  return { value: v, heat: h }
}
