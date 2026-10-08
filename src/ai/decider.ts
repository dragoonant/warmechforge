// Utility AI decider (40-ai §1, §2, §10): dispatch by PendingDecision.kind, final validate of every answer, safe fallback.
// Reads only the public engine API; randomness comes from the AI's own sfc32 stream (never a global random source, never state.rng).
import type {
  Action, AiTier, ChooseAmmoAction, DeclareFireAction, DeclarePhysicalAction, Decider, DeployAction, PendingDecision,
  PlayerView, PowerChoiceAction, StandUpAction, TorsoTwistAction, Twist, UnitId,
} from '../engine/index'
import { query, validate } from '../engine/index'
import { decideRandom } from './random'
import { AiCtx, aiRng, facingToward, turnGap } from './ctx'
import { targetModel } from './damage'
import { planFire, toFireShots, type FirePlanResult } from './fire'
import { heatCapFor } from './heat'
import { decideMove, type MoveScore } from './moves'
import { decideSelect } from './order'
import { bestMeleeFrom, choiceValue } from './physical'
import { threatAt } from './threat'
import { DECISION_BUDGET_MS, TIERS, type UtilityTier } from './tiers'
import { TUNE } from './tune'

export interface AiDecideOptions {
  tier: UtilityTier
  /** Seed for the AI stream; default the game seed (deriveSeed(seed, 'ai', side, decisionSeq, tier)). */
  seed?: string
  budgetMs?: number
  /** Called for answers the AI could not build itself (bench counts them; must stay 0). */
  onEvent?: (kind: 'fallback' | 'unhandledKind', detail: string) => void
  trace?: boolean
}
export interface AiDecision { action: Action; trace?: { kind: string; top?: unknown[]; ms: number } }

const firstValid = (state: PlayerView['state'], legal: Action[]): Action => legal.find((a) => validate(state, a) === null) ?? legal[0]!

/** Synchronous decision (sim, bench, tests, worker). Always returns a member of `legal` or a composite that passes validate. */
export function decideAi(view: PlayerView, pending: PendingDecision, legal: Action[], opts: AiDecideOptions): AiDecision {
  if (legal.length === 0) throw new Error(`ai: no legal actions for ${pending.id}`)
  const state = view.state
  const tier = TIERS[opts.tier]
  const rng = aiRng(opts.seed ?? state.seed, pending.player, state.decisionSeq, tier.id)
  const ctx = new AiCtx(state, pending.player, tier, rng, opts.budgetMs ?? DECISION_BUDGET_MS)
  let action: Action
  let top: unknown[] | undefined
  try {
    switch (pending.kind) {
      case 'initiativeAck': case 'gameOver': action = legal[0]!; break
      case 'deploy': action = decideDeploy(ctx, legal); break
      case 'selectUnit': action = decideSelect(ctx, legal); break
      case 'move': {
        const r = decideMove(ctx, pending.unitId!, legal)
        action = r.action
        if (opts.trace) top = r.top.map(traceMove)
        break
      }
      case 'standUp': action = decideStand(ctx, pending, legal); break
      case 'torsoTwist': action = decideTwist(ctx, pending, legal); break
      case 'declareFire': {
        const info: FireTrace = { heatEnd: 0, pKill: 0, pDying: 0, cap: 0, dv: 0 }
        action = decideFire(ctx, pending, legal, opts, info)
        if (opts.trace) top = [info]
        break
      }
      case 'chooseAmmo': action = decideAmmo(ctx, legal); break
      case 'declarePhysical': action = decidePhysical(ctx, pending, legal); break
      case 'powerChoice': action = decidePower(legal); break
      case 'choice': action = firstValid(state, legal); break // defender choices: the engine lists its default first
      default:
        opts.onEvent?.('unhandledKind', pending.kind)
        action = firstValid(state, legal)
    }
  } catch (e) {
    opts.onEvent?.('fallback', `${pending.kind}: ${e instanceof Error ? e.message : String(e)}`)
    action = firstValid(state, legal)
  }
  if (validate(state, action) !== null) {
    opts.onEvent?.('fallback', `${pending.kind}: answer failed validate`)
    action = firstValid(state, legal)
  }
  const out: AiDecision = { action }
  if (opts.trace) out.trace = { kind: pending.kind, ...(top ? { top } : {}), ms: Math.round(performance.now() - ctx.t0) }
  return out
}

function traceMove(s: MoveScore): unknown {
  const r = (x: number): number => Math.round(x * 100) / 100
  return { hex: s.entry.label, facing: s.entry.facing, mode: s.entry.mode, total: r(s.total), dealt: r(s.dealt), taken: r(s.taken), heat: r(s.heat), psr: r(s.psr), approach: r(s.approach), physical: r(s.physical), position: r(s.position) }
}

// ---------- deployment (§10.2) ----------
function decideDeploy(ctx: AiCtx, legal: Action[]): Action {
  const deps = legal.filter((a): a is DeployAction => a.type === 'deploy')
  if (!deps.length) return legal[0]!
  const enemies = ctx.enemiesOf().map((id) => ctx.unit(id).pos!).filter(Boolean)
  const friends = ctx.friendsOf().map((id) => ctx.unit(id).pos!).filter(Boolean)
  const meanQ = friends.length ? friends.reduce((s, h) => s + h.q, 0) / friends.length : null
  let best = deps[0]!, bs = -Infinity
  for (const a of deps) {
    const info = ctx.hexInfo(a.hex)
    let s = (info && info.woods !== 'none' ? 2 : 0) + (info ? info.level : 0)
    if (meanQ !== null) s -= 0.2 * Math.abs(a.hex.q - meanQ)
    if (enemies.length) {
      const cx = { q: Math.round(enemies.reduce((t, h) => t + h.q, 0) / enemies.length), r: Math.round(enemies.reduce((t, h) => t + h.r, 0) / enemies.length) }
      s -= 0.3 * turnGap(a.facing, facingToward(a.hex, cx))
    }
    s += ctx.rng() * 1e-3
    if (s > bs) { bs = s; best = a }
  }
  return best
}

// ---------- stand up (§10.3) ----------
function decideStand(ctx: AiCtx, pending: PendingDecision, legal: Action[]): Action {
  const unitId = pending.unitId!
  const u = ctx.unit(unitId)
  const attempts = legal.filter((a): a is StandUpAction => a.type === 'standUp' && a.attempt)
  const stay = legal.find((a) => a.type === 'standUp' && !a.attempt) ?? legal[0]!
  if (!attempts.length) return stay
  const p = pending.context.psr?.p ?? query.psrPreview(ctx.state, unitId, 'stand').p
  const adj = ctx.enemiesOf().some((e) => { const q = ctx.unit(e).pos; return !!q && !!u.pos && query.distance(q, u.pos) === 1 })
  // standing restores movement, TMM and full fire; a failed attempt only costs the fall itself (the unit is already down)
  const vStand = Math.max(30, 0.5 * ctx.kill(unitId)) + 10 * (adj ? 1 : 0)
  const go = ctx.tier.id === 'easy' ? p >= 0.5 : p * vStand > (1 - p) * (ctx.fallCost(unitId) - TUNE.fallTempo)
  if (!go) return stay
  // face the nearest enemy
  let want = u.facing
  let bestD = Infinity
  for (const e of ctx.enemiesOf()) { const q = ctx.unit(e).pos; if (q && u.pos) { const d = query.distance(q, u.pos); if (d < bestD) { bestD = d; want = facingToward(u.pos, q) } } }
  let best = attempts[0]!, bg = Infinity
  for (const a of attempts) { const g = turnGap(a.facing ?? u.facing, want); if (g < bg) { bg = g; best = a } }
  return best
}

// ---------- torso twist (§8.1) ----------
function pDyingNow(ctx: AiCtx, unitId: UnitId): number {
  const u = ctx.unit(unitId)
  if (!u.pos || ctx.tier.wT <= 0) return 0
  return threatAt(ctx, unitId, { hex: u.pos, facing: u.facing }, targetModel(ctx, unitId), { fast: false, sample: false, lambda: 1 }).pDying
}

function decideTwist(ctx: AiCtx, pending: PendingDecision, legal: Action[]): Action {
  const unitId = pending.unitId!
  const twists = legal.filter((a): a is TorsoTwistAction => a.type === 'torsoTwist' && !a.flip)
  if (!twists.length) return legal[0]!
  const keep = twists.find((a) => a.twist === 0) ?? legal[0]!
  if (ctx.unit(unitId).prone) return keep
  const u = ctx.unit(unitId)
  if (ctx.tier.id === 'easy' || pending.phase === 'physicalAttack') {
    if (pending.phase === 'physicalAttack') {
      let best: Action = keep, bv = 0
      for (const a of twists) {
        let v = 0
        for (const e of ctx.enemiesOf()) { const p = ctx.unit(e).pos; if (p && u.pos && query.distance(p, u.pos) === 1) v = Math.max(v, bestMeleeFrom(ctx, unitId, { twist: a.twist }, e)) }
        if (v > bv + 0.5) { bv = v; best = a }
      }
      return best
    }
    // easy: twist toward the primary target when it is outside the front arc
    const plan0 = planFire(ctx, unitId, { twist: 0 })
    if (plan0.shots.length) return keep
    let best: Action = keep, bv = 0
    for (const a of twists) { if (a.twist === 0) continue; const p = planFire(ctx, unitId, { twist: a.twist as Twist }); if (p.score > bv) { bv = p.score; best = a } }
    return best
  }
  const pDying = pDyingNow(ctx, unitId)
  let best: Action = keep
  let bs = planFire(ctx, unitId, { twist: 0, pDying }).score
  for (const a of twists) {
    if (a.twist === 0) continue
    const p = planFire(ctx, unitId, { twist: a.twist as Twist, pDying })
    if (p.score > bs + 0.25) { bs = p.score; best = a }
  }
  return best
}

// ---------- ranged fire (§8) ----------
/** What the fire decision chose (trace / tests): projected end heat, best pKill, P(we die this turn), the cap that applied. */
export interface FireTrace { heatEnd: number; pKill: number; pDying: number; cap: number; dv: number }

function decideFire(ctx: AiCtx, pending: PendingDecision, legal: Action[], opts: AiDecideOptions, info: FireTrace): Action {
  const unitId = pending.unitId!
  const hold = legal.find((a) => a.type === 'declareFire' && a.shots.length === 0) ?? legal[0]!
  const pDying = ctx.tier.wT > 0 ? pDyingNow(ctx, unitId) : 0
  const plan: FirePlanResult = planFire(ctx, unitId, { pDying })
  info.heatEnd = plan.heatEnd; info.pKill = plan.pKill; info.pDying = pDying; info.dv = plan.dv
  info.cap = heatCapFor(ctx, unitId, { pKill: plan.pKill, pDying })
  if (!plan.shots.length) return hold
  const action: DeclareFireAction = { type: 'declareFire', decisionId: pending.id, player: pending.player, unitId, shots: toFireShots(plan) }
  if (validate(ctx.state, action) === null) return action
  // a shot the previews accepted was refused: keep the primary target's shots only
  const primary = plan.shots[0]!.targetId
  const alt: DeclareFireAction = { ...action, shots: toFireShots(plan).filter((s) => s.targetId === primary) }
  if (alt.shots.length && validate(ctx.state, alt) === null) return alt
  opts.onEvent?.('fallback', `declareFire: planned set rejected (${validate(ctx.state, action)?.code})`)
  return hold
}

// ---------- ammo (§8.5) ----------
function decideAmmo(ctx: AiCtx, legal: Action[]): Action {
  const opts = legal.filter((a): a is ChooseAmmoAction => a.type === 'chooseAmmo')
  if (!opts.length) return legal[0]!
  const u = ctx.unit(ctx.state.pending.unitId ?? '') ?? null
  const unit = u ?? Object.values(ctx.state.units).find((x) => opts.some((o) => x.bins[o.binId])) ?? null
  if (!unit) return opts[0]!
  return [...opts].sort((a, b) => {
    const ba = unit.bins[a.binId], bb = unit.bins[b.binId]
    if (!ba || !bb) return 0
    const ea = unit.locs[ba.location], eb = unit.locs[bb.location]
    const ra = ea.armor + ea.structure, rb = eb.armor + eb.structure
    return ra - rb || ba.shots - bb.shots || (a.binId < b.binId ? -1 : 1)
  })[0]!
}

// ---------- physical (§9) ----------
function decidePhysical(ctx: AiCtx, pending: PendingDecision, legal: Action[]): Action {
  const unitId = pending.unitId!
  let best: Action = legal.find((a) => a.type === 'declarePhysical' && a.attack.kind === 'none') ?? legal[0]!
  let bv = 0
  for (const a of legal) {
    if (a.type !== 'declarePhysical' || a.attack.kind === 'none') continue
    const v = choiceValue(ctx, unitId, (a as DeclarePhysicalAction).attack)
    if (v > bv + 1e-9) { bv = v; best = a }
  }
  return best
}

// ---------- power (§10.5): always restart, never shut down voluntarily ----------
function decidePower(legal: Action[]): Action {
  const restart = legal.filter((a): a is PowerChoiceAction => a.type === 'powerChoice' && a.changes.length > 0 && a.changes.every((c) => c.to === 'restart'))
  if (restart.length) return restart[0]!
  return legal.find((a) => a.type === 'powerChoice' && a.changes.length === 0) ?? legal[0]!
}

/** Decider for the game runner, sim and bench. 'random' plays the random-tier bot (src/ai/random.ts). */
export function createAiDecider(tier: AiTier, seed?: string, onEvent?: AiDecideOptions['onEvent']): Decider {
  return {
    async decide(view, pending, legal) {
      if (tier === 'random') return decideRandom(view, pending, legal, `${seed ?? view.state.seed}|${pending.player}`)
      return decideAi(view, pending, legal, { tier, ...(seed ? { seed } : {}), ...(onEvent ? { onEvent } : {}) }).action
    },
  }
}
