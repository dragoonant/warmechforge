// Movement decision (40-ai §6): score every reachable (hex, facing, mode) entry.
// U = wD·Dealt − wT·Taken − HeatCost − PSRrisk + wA·Approach + Physical + position terms (TMM, cover, rear-arc denial and
// rear-arc gain, LOS, map edge) + noise. Stage 1 scores every entry with the fast additive model against current enemy
// positions; stage 2 (normal) re-scores the best entries with sampled enemy positions, exact DV and torso-twist options.
import type { Action, MoveAction, ReachEntry, Twist, UnitAt, UnitId } from '../engine/index'
import { query, validate } from '../engine/index'
import { facingToward, hexKey, type AiCtx } from './ctx'
import { targetModel, type TargetModel } from './damage'
import { enemyModels, fastDealt, heatBase } from './fire'
import { heatCapFor, heatCost } from './heat'
import { bestMeleeFrom, directionOf, previewValue } from './physical'
import { pFail } from './prob'
import { threatAt } from './threat'

export interface MoveScore {
  entry: ReachEntry
  action: Action
  dealt: number
  taken: number
  heat: number
  psr: number
  approach: number
  physical: number
  position: number
  total: number
  pDying: number
}

const stableKey = (a: Action): string => JSON.stringify(a)
/** Hexes with a shot that always reach the stage-2 shortlist (they replace the weakest of the fast top). */
const SHOOTERS_KEPT = 6
/** Stage-2 candidates re-scored even past the decision's hard stop (a loaded machine must not fall back to fast scores). */
const MIN_RESCORED = 6

export function decideMove(ctx: AiCtx, unitId: UnitId, legal: Action[]): { action: Action; top: MoveScore[] } {
  const legalByKey = new Map(legal.map((a) => [stableKey(a), a]))
  let entries: ReachEntry[] = []
  try { entries = query.reachable(ctx.state, unitId) } catch { entries = [] }
  entries = entries.filter((e) => legalByKey.has(stableKey(e.action)))
  // MASC (10 EQUIP-021, normal tier): run entries at walk x 2, priced with the activation roll's failure risk below. They are
  // not in the legal list (legalActions lists plain moves), so the pick is validated before it is returned.
  const mascRisk = new Map<string, number>()
  if (ctx.tier.id === 'normal' && entries.length) {
    const masc = (query.sheet(ctx.state, unitId).equipment ?? []).find((x) => x.kind === 'masc' && x.state === 'ready')
    if (masc) {
      let extra: ReachEntry[] = []
      // only the hexes plain moves cannot reach (the extra MASC ring): the rest adds risk for nothing and doubles the work
      const plain = new Set(entries.map((e) => hexKey(e.hex)))
      try { extra = query.reachable(ctx.state, unitId, { masc: true }).filter((e) => e.action.masc && !plain.has(hexKey(e.hex)) && !legalByKey.has(stableKey(e.action))) } catch { extra = [] }
      // a failed roll destroys the MASC and makes a critical check on a leg; each use raises the next avoid number
      const risk = pFail(masc.avoidTn ?? null) * (12 + 0.5 * ctx.fallCost(unitId)) + 2
      for (const e of extra) { const k = stableKey(e.action); legalByKey.set(k, e.action); mascRisk.set(k, risk) }
      entries = entries.concat(extra)
    }
  }
  if (!entries.length) return { action: legal[0]!, top: [] }
  // never risk a piloting roll while passing through another unit's hex: a fall there strands the unit in a shared hex
  const occupied = new Set(ctx.state.unitOrder.filter((id) => id !== unitId && ctx.unit(id).pos && ctx.unit(id).status !== 'destroyed').map((id) => hexKey(ctx.unit(id).pos!)))
  const safe = entries.filter((e) => !e.path.some((p) => p.psr !== null && occupied.has(hexKey(p.hex))))
  if (safe.length) entries = safe
  const t = ctx.tier
  const T = ctx.tune
  const u = ctx.unit(unitId)
  const facts = ctx.factsOf(unitId)
  const own: TargetModel = targetModel(ctx, unitId)
  const models = enemyModels(ctx)
  const enemies = [...models.keys()]
  // where we will shoot at: moved enemies at their hex and TMM; unmoved ones at their hex with a walk-length TMM (§6.2)
  const targets = enemies.map((id) => {
    const e = ctx.unit(id)
    const at: UnitAt | undefined = ctx.hasMoved(id) ? undefined : { hexesMoved: Math.max(0, e.baseMp.walk), jumped: false }
    return { id, model: models.get(id)!, ...(at ? { at } : {}) }
  })
  const pref = facts.prefRange
  const baseCache = new Map<string, number>()
  const baseFor = (e: ReachEntry): number => {
    const hj = e.mode === 'jump' ? e.hexesMoved : 0
    const k = `${e.mode}:${hj}`
    let b = baseCache.get(k)
    if (b === undefined) { b = heatBase(ctx, unitId, { mode: e.mode, ...(e.mode === 'jump' ? { hexesJumped: hj } : {}) }); baseCache.set(k, b) }
    return b
  }
  const cap = heatCapFor(ctx, unitId, { pKill: 0, pDying: 0 })
  const fallU = ctx.fallCost(unitId)
  const nearestEnemyDist = (h: ReachEntry['hex']): number => {
    let d = Infinity
    for (const id of enemies) { const p = ctx.unit(id).pos; if (p) d = Math.min(d, query.distance(h, p)) }
    return d
  }
  const enemyCentre = enemies.length ? enemies.map((id) => ctx.unit(id).pos!).filter(Boolean) : []
  const nearestEnemy = (h: ReachEntry['hex']): ReachEntry['hex'] | null => {
    let best: ReachEntry['hex'] | null = null, d = Infinity
    for (const p of enemyCentre) { const x = query.distance(h, p); if (x < d) { d = x; best = p } }
    return best
  }
  const friends = ctx.friendsOf().filter((id) => id !== unitId).map((id) => ctx.unit(id).pos!).filter(Boolean)
  const withdrawing = u.status === 'withdrawing'

  const scores: MoveScore[] = []
  for (const e of entries) {
    const at: UnitAt = { hex: e.hex, facing: e.facing, mode: e.mode, twist: 0 }
    const usAt: UnitAt & { hex: ReachEntry['hex'] } = { hex: e.hex, facing: e.facing, hexesMoved: e.hexesMoved, jumped: e.mode === 'jump', prone: e.endsProne }
    const base = baseFor(e)
    let dealt = 0, dealtHeat = 0
    let physical = 0
    if (e.physical) {
      // charge / DFA declared with the move: no ranged fire this turn (E_NO_RANGED); value from the physical preview
      if (!t.chargeDfa) continue
      const tgt = ctx.unit(e.physical.targetId)
      const from = e.physical.fromHex ?? e.hex
      const pv = query.physicalPreview(ctx.state, {
        attackerId: unitId, kind: e.physical.kind, targetId: e.physical.targetId,
        attackerAt: { hex: from, facing: tgt.pos ? facingToward(from, tgt.pos) : e.facing, mode: e.mode, hexesMoved: e.hexesMoved, jumped: e.mode === 'jump' },
      })
      if (!pv.legal) continue
      if (e.physical.kind === 'dfa' && pv.pHit < t.dfaMinPHit) continue
      physical = previewValue(ctx, unitId, pv, e.physical.targetId, directionOf(ctx, unitId, e.physical.targetId, { hex: from, facing: tgt.pos ? facingToward(from, tgt.pos) : e.facing }))
      if (physical <= 0) continue
    } else if (!e.endsProne) {
      const d = fastDealt(ctx, unitId, at, targets, cap - base)
      dealt = d.value
      dealtHeat = d.heat
      if (dealt <= 0 && u.attacks.twist === 0 && !u.prone) {
        // a torso twist may bring a target into the front arc: a hex with only a twisted shot is not a hex with no shot
        for (const tw of [-1, 1] as Twist[]) {
          const x = fastDealt(ctx, unitId, { ...at, twist: tw }, targets, cap - base)
          if (x.value > dealt) { dealt = x.value; dealtHeat = x.heat }
        }
      }
    }
    const H = Math.max(0, Math.round(base + dealtHeat))
    const heat = heatCost(ctx, unitId, H) + (H > cap ? 5 * (H - cap) : 0)
    let psr = 0
    for (const r of e.psrs) psr += T.psrW * (1 - r.p) * fallU
    psr += mascRisk.get(stableKey(e.action)) ?? 0
    if (e.endsProne) psr += fallU + 20
    let taken = 0, pDying = 0, rear = 0
    if (t.wT > 0) {
      const th = threatAt(ctx, unitId, usAt, own, { fast: true, sample: false, lambda: T.lambda ?? t.lambda })
      taken = th.taken; pDying = th.pDying; rear = th.rearExposed
    }
    // position terms
    let position = 0
    const info = ctx.hexInfo(e.hex)
    if (info?.woods === 'light') position += T.woodsL
    if (info?.woods === 'heavy') position += T.woodsH
    position += T.tmmW * e.tmm
    const nb = ctx.boardNeighbours(e.hex)
    if (nb < 6) position -= 2 + (6 - nb)
    if (t.wT > 0 && rear > 0) position -= T.rearW * rear // never leave our rear to an enemy that can shoot it
    if (dealt > 0) position += 0.5 // keep LOS
    // melee from an adjacent end hex (resolved later in the Physical Attack Phase, §6.2)
    if (!e.physical && !e.endsProne) {
      for (const id of enemies) {
        const p = ctx.unit(id).pos
        if (p && query.distance(p, e.hex) === 1) physical = Math.max(physical, 0.5 * bestMeleeFrom(ctx, unitId, at, id))
      }
    }
    const dist = nearestEnemyDist(e.hex)
    let approach = enemyCentre.length ? -T.approach * Math.abs(dist - pref) : 0
    if (T.heightW && info && nearestEnemy(e.hex)) {
      // high ground: better lines of fire over hills and woods, partial cover for us (the previews price this turn only)
      const el = ctx.hexInfo(nearestEnemy(e.hex)!)?.level ?? info.level
      position += T.heightW * Math.max(-2, Math.min(2, info.level - el))
    }
    if (T.supportW && friends.length) {
      let near = 0
      for (const f of friends) if (query.distance(f, e.hex) <= 3) near++
      position += T.supportW * Math.min(2, near)
    }
    if (withdrawing) {
      // forced withdrawal (11 §3.3): head for the home edge and leave; damage dealt on the way is a bonus
      const exits = e.action.steps.some((st) => st.op === 'exit')
      approach = exits ? 40 : -T.withdrawW * ctx.edgeDistance(u.owner, e.hex)
    }
    scores.push({ entry: e, action: legalByKey.get(stableKey(e.action))!, dealt, taken, heat, psr, approach, physical, position, total: 0, pDying })
  }
  if (!scores.length) return { action: legal[0]!, top: [] }
  const maxDealt = Math.max(...scores.map((s) => s.dealt + s.physical))
  const approachW = maxDealt <= 0.01 ? T.approachFar : 1
  const wT = t.wT > 0 ? T.wT ?? t.wT : 0
  // an end hex with no shot at all, while another reachable hex has one, wastes the turn (not for withdrawals or falls)
  const noShotPen = withdrawing ? 0 : Math.max(5, 0.6 * t.wD * maxDealt)
  const total = (s: MoveScore): number => (maxDealt > 0.01 && s.dealt <= 0.01 && s.physical <= 0 && !s.entry.endsProne ? -noShotPen : 0) + t.wD * s.dealt - wT * s.taken - s.heat - s.psr + t.wA * approachW * s.approach + s.physical + s.position
  for (const s of scores) s.total = total(s)
  scores.sort((a, b) => b.total - a.total)

  // stage 2 (normal): sampled threat, exact DV and twist options for the best candidates
  if (t.fullScoreTop > 0 && t.wT > 0) {
    // the shortlist always holds the best hexes with a shot (M7 major: every one of the fast top could be a hiding hex, whose
    // fast threat assumes unmoved enemies stay put; the sampled threat below is what shows hiding does not stop their fire)
    const hasShot = (s: MoveScore): boolean => s.dealt > 0.01 || s.physical > 0
    const shooters = maxDealt > 0.01 && !withdrawing ? scores.filter(hasShot).slice(0, SHOOTERS_KEPT) : []
    const top = scores.slice(0, t.fullScoreTop - shooters.filter((s) => scores.indexOf(s) >= t.fullScoreTop).length)
    for (const s of shooters) if (!top.includes(s)) top.push(s)
    // re-score order: the fast best few, then the shooters, then the rest, so a hard stop under load still compares both kinds
    const head = top.slice(0, 4)
    const order = [...head, ...shooters.filter((s) => !head.includes(s)), ...top.filter((s) => !head.includes(s) && !shooters.includes(s))]
    const done: MoveScore[] = []
    for (const s of order) {
      // hard stop only (deterministic in practice: the work per decision is bounded); a few are always re-scored
      if (done.length >= MIN_RESCORED && ctx.timeLeft() < 0) break
      const e = s.entry
      const usAt: UnitAt & { hex: ReachEntry['hex'] } = { hex: e.hex, facing: e.facing, hexesMoved: e.hexesMoved, jumped: e.mode === 'jump', prone: e.endsProne }
      const th = threatAt(ctx, unitId, usAt, own, { fast: false, sample: t.sampleEnemies, lambda: T.lambda ?? t.lambda })
      s.taken = th.taken
      s.pDying = th.pDying
      if (!e.physical && !e.endsProne && u.attacks.twist === 0) {
        const base = baseFor(e)
        for (const tw of [-1, 1] as Twist[]) {
          const d = fastDealt(ctx, unitId, { hex: e.hex, facing: e.facing, mode: e.mode, twist: tw }, targets, cap - base)
          if (d.value > s.dealt + 1e-9) {
            const H = Math.max(0, Math.round(base + d.heat))
            s.dealt = d.value
            s.heat = heatCost(ctx, unitId, H) + (H > cap ? 5 * (H - cap) : 0)
          }
        }
      }
      s.total = total(s)
      done.push(s)
    }
    // pick only among the re-scored candidates: their Taken is on the full model, the rest still carry the fast one
    scores.length = 0
    scores.push(...done)
  }
  // noise (easy plays loose; normal only breaks ties) and a stable tie-break
  if (t.noise > 0) for (const s of scores.slice(0, 40)) s.total += t.noise * Math.max(1, Math.abs(s.total)) * (ctx.rng() * 2 - 1)
  // a hex with a shot outranks every hex without one whenever any reachable hex has a shot (M8 playtest: a 60-point exposure
  // price could still beat the no-shot term and the unit ran to a hiding hex and held fire); only the score orders within a class
  const shoots = (s: MoveScore): number => (maxDealt > 0.01 && !withdrawing && (s.dealt > 0.01 || s.physical > 0) ? 1 : 0)
  scores.sort((a, b) => shoots(b) - shoots(a) || b.total - a.total || (stableKey(a.action) < stableKey(b.action) ? -1 : 1))
  // a MASC move must pass validate (it is not a member of the legal list); otherwise take the best plain move
  const pick = scores.findIndex((s) => !mascRisk.has(stableKey(s.action)) || validate(ctx.state, s.action) === null)
  if (pick < 0) return { action: legal[0]!, top: [] }
  if (pick > 0) scores.splice(0, pick)
  return { action: scores[0]!.action as MoveAction, top: scores.slice(0, 3) }
}
