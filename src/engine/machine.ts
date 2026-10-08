// The phase machine (00 §5, §9): createGame, step, validate and legalActions on top of the rules modules.
// index.ts exposes these as the public API. Pure: state in, { state, events, pending } out; every roll goes through roll().
import type {
  Action, ChooseAmmoAction, DeclareFireAction, DeclarePhysicalAction, FireShot, PowerChoiceAction, SelectUnitAction,
  TorsoTwistAction,
} from './actions'
import type { GameEvent } from './events'
import { applyDeploy, legalDeployActions, validateDeploy } from './deploy'
import { beginPhase, finishSelection, selectUnit, selectionDeps, startSelection, eligibleUnits } from './initiative'
import { collectHooks } from './hooks'
import { isImmobile } from './movement'
import { distance } from './hex'
import { consciousnessChecks } from './pilot'
import { fallDeps, resolvePsrs } from './psr'
import { heatDeps } from './heat'
import { applyDamage, explodeBin } from './damage'
import { pickHeatExplosionBin } from './ammo'
import { bundleFor } from './bundles'
import { heatApply } from './phases/heat'
import { finishInitiativePhase, startInitiativePhase } from './phases/initiative'
import {
  applyMovementAction, firstDecisionKind, legalMovementActions, movementDecision, validateMovementAction,
} from './phases/movement'
import {
  applyTorsoTwist, declareFire, legalShots, parkDeclaration, resolveRanged, resumeDeclareFire, startRangedPhase,
  twistOptionsFor,
} from './phases/ranged'
import type { FireOutcome } from './phases/ranged'
import {
  bookCommitted, declarePhysical, hasCommitted, physicalTwistAvailable, resolvePhysical, startPhysicalPhase,
} from './phases/physical'
import { applyPowerChoice, powerQueries, runEndPhaseA, surrenderCheck } from './phases/end'
import { displacementStep, legalPhysicalChoices, physicalTargets } from './physical'
import { createInitialState, isProblems, placementQueue, placementZone, toPlace } from './scenario'
import type {
  DataBundle, DecisionContext, Hex, DecisionKind, DecisionOption, GameResult, GameSetup, GameState, PendingDecision, PhaseId,
  PhaseStep, PlayerId, Rejection, StepResult, UnitId,
} from './types'
import { applyDoomed, checkVictory, endGame, refreshStatus } from './victory'

// Late-bound collaborators (psr.ts and heat.ts cannot import damage.ts without a cycle). damage.ts also sets them at load.
fallDeps.applyDamage = (state, i) => applyDamage(state, i)
heatDeps.explodeAmmo = (state, unitId, binId) => explodeBin(state, unitId, binId, 'heat')
heatDeps.pickBin = (state, unitId) => pickHeatExplosionBin(bundleFor(state), state.units[unitId]!)

// MOVE-008 immobility (0 MP in every mode) for the selection order; the initiative module's default only knows power/pilot.
selectionDeps.movementImmobile = (state, u) => isImmobile(state, u)

interface Run { s: GameState; ev: GameEvent[]; data: DataBundle }
const push = (r: Run, x: { state: GameState; events: GameEvent[] }): void => { r.s = x.state; r.ev.push(...x.events) }

// ---------- decisions ----------
type NewDecision = Omit<PendingDecision, 'id'>
function raise(r: Run, d: NewDecision): void {
  const id = `d:${r.s.decisionSeq + 1}`
  const options = d.options?.map((o) => ({ ...o, action: { ...o.action, decisionId: id } as Action }))
  const pending: PendingDecision = { ...d, id, ...(options ? { options } : {}) }
  r.s = { ...r.s, decisionSeq: r.s.decisionSeq + 1, pending }
}
/** A decision with one possible answer: consumes a decision id, emits DecisionAutoResolved, no log entry (00 §9.2). */
function autoResolve(r: Run, kind: DecisionKind, optionId: string): void {
  const id = `d:${r.s.decisionSeq + 1}`
  r.s = { ...r.s, decisionSeq: r.s.decisionSeq + 1 }
  r.ev.push({ type: 'DecisionAutoResolved', decisionId: id, kind, optionId })
}
const base = (s: GameState, kind: DecisionKind, player: PlayerId, unitId: UnitId | null, context: DecisionContext): NewDecision => ({
  player, kind, phase: s.phase, step: s.step, unitId, context, canPass: false,
})
const opt = (id: string, label: string, action: Action): DecisionOption => ({ id, label, action })

// ---------- end of a phase (00 §5.4 a-e) ----------
function closePhase(r: Run): boolean {
  const phase = r.s.phase
  r.s = { ...r.s, damageWindow: 'immediate' }
  push(r, applyDoomed(r.s))
  push(r, consciousnessChecks(r.s))
  push(r, resolvePsrs(r.s, { when: ['now', 'endOfMove', 'endOfPhase'] }))
  push(r, consciousnessChecks(r.s))
  push(r, applyDoomed(r.s))
  push(r, refreshStatus(r.s, r.data))
  r.ev.push({ type: 'PhaseEnded', phase, turn: r.s.turn })
  return victory(r)
}
/** Victory check outside a simultaneous window; ends the game when a mission entry resolves. */
function victory(r: Run, atEndPhase = false): boolean {
  const res: GameResult | null = checkVictory(r.s, { atEndPhase }, r.data) ?? (atEndPhase ? turnLimit(r.s, r.data) : null)
  if (!res) return false
  push(r, endGame(r.s, res))
  return true
}
/**
 * 00 §5.1 end.victory applies setup.turnLimit. A mission without a turnLimitBV entry still stops at the limit: the side that
 * destroyed more enemy BV wins, equal is a draw (RULING in issues: same scoring as 11 §5 turnLimitBV).
 */
function turnLimit(s: GameState, data: DataBundle): GameResult | null {
  const limit = s.setup.turnLimit
  if (limit === null || limit === undefined || s.turn < limit) return null
  const bv = (mechId: string): number => (data.mechs[mechId] as { bv?: number } | undefined)?.bv ?? 0
  const lost = (p: PlayerId): number => s.unitOrder.map((id) => s.units[id]!).filter((u) => u.owner === p)
    .filter((u) => u.status === 'destroyed' || u.status === 'withdrawn' || u.status === 'surrendered' || u.crippled)
    .reduce((n, u) => n + bv(u.mechId), 0)
  const a = lost('B'), b = lost('A') // enemy BV each side took out of the fight
  return { winner: a === b ? null : a > b ? 'A' : 'B', reason: a === b ? 'draw' : 'turnLimitBV', turn: s.turn }
}

// ---------- the driver: runs steps until a decision is open ----------
const MAX_LOOP = 10_000
function proceed(r: Run): void {
  for (let guard = 0; guard < MAX_LOOP; guard++) {
    const s = r.s
    switch (s.step) {
      case 'deployment.place': {
        const p = placementPending(r)
        if (p) return
        r.s = { ...r.s, turn: 0 }
        push(r, startInitiativePhase(r.s))
        continue
      }
      case 'initiative.roll':
        push(r, startInitiativePhase(r.s))
        continue
      case 'initiative.ack': {
        const human = (['A', 'B'] as PlayerId[]).find((p) => r.s.sides[p].control === 'human') ?? 'A'
        const i = r.s.initiative!
        raise(r, { ...base(r.s, 'initiativeAck', human, null, { phase: 'initiative', data: { totals: i.totals, winner: i.winner, loser: i.loser, rerolls: i.rerolls } }),
          options: [opt('ack', 'Continue', { type: 'ack', decisionId: '', player: human })] })
        return
      }
      case 'movement.select':
      case 'ranged.select':
      case 'physical.select': {
        const sel = r.s.selection
        if (!sel) {
          if (s.step === 'movement.select') r.s = { ...r.s, step: 'movement.end' }
          else if (s.step === 'ranged.select') r.s = { ...r.s, step: 'ranged.resolve' }
          else r.s = { ...r.s, step: 'physical.resolve' }
          continue
        }
        const eligible = eligibleUnits(r.s, sel.phase, sel.turnOf).filter((id) => !sel.acted.includes(id))
        const phase: PhaseId = r.s.phase
        const ctx: DecisionContext = { phase, eligible, count: sel.leftInGroup }
        if (eligible.length === 1) {
          autoResolve(r, 'selectUnit', eligible[0]!)
          push(r, selectUnit(r.s, eligible[0]!))
          afterSelect(r)
          continue
        }
        raise(r, { ...base(r.s, 'selectUnit', sel.turnOf, null, ctx),
          options: eligible.map((id) => opt(id, r.s.units[id]!.name, { type: 'selectUnit', decisionId: '', player: sel.turnOf, unitId: id })) })
        return
      }
      case 'movement.move': {
        const id = r.s.selection?.activeUnit
        if (!id) { r.s = { ...r.s, step: 'movement.select' }; continue }
        const kind = firstDecisionKind(r.s, id)
        raiseMovement(r, id, kind)
        return
      }
      case 'movement.end':
        if (closePhase(r)) return
        push(r, startRangedPhase(r.s))
        continue
      case 'ranged.twist':
      case 'physical.twist': {
        const id = r.s.selection!.activeUnit!
        const ranged = s.step === 'ranged.twist'
        const next: PhaseStep = ranged ? 'ranged.declare' : 'physical.declare'
        const o = twistOptionsFor(r.s, id)
        const enemyNear = ranged || r.s.unitOrder.some((t) => {
          const u = r.s.units[t]!, me = r.s.units[id]!
          return u.owner !== me.owner && u.pos && me.pos && distance(u.pos, me.pos) <= 1
        })
        const usable = (ranged || physicalTwistAvailable(r.s, id)) && enemyNear
        const options = twistDecisionOptions(r.s, id, o.twistOptions, o.canFlip)
        if (!usable || options.length <= 1) {
          autoResolve(r, 'torsoTwist', 'forward')
          r.s = { ...r.s, step: next }
          continue
        }
        raise(r, { ...base(r.s, 'torsoTwist', r.s.units[id]!.owner, id, { phase: r.s.phase, twistOptions: o.twistOptions, canFlip: o.canFlip }), options })
        return
      }
      case 'ranged.declare': {
        const id = r.s.selection!.activeUnit!
        const u = r.s.units[id]!
        const shots = legalShots(r.s, r.data, id)
        if (shots.length === 0) {
          autoResolve(r, 'declareFire', 'hold')
          push(r, declareFire(r.s, r.data, { type: 'declareFire', decisionId: '', player: u.owner, unitId: id, shots: [] }))
          finishUnit(r, 'ranged.select')
          continue
        }
        const targets = [...new Set(shots.map((x) => x.targetId).filter((t): t is UnitId => t !== null))]
        raise(r, base(r.s, 'declareFire', u.owner, id, { phase: 'rangedAttack', targets }))
        return
      }
      case 'ranged.resolve':
        push(r, resolveRanged(r.s, r.data, r.s.setup.options?.floatingCrits ? { floatingCrits: true } : {}))
        if (closePhase(r)) return
        push(r, startPhysicalPhase(r.s))
        continue
      case 'physical.declare': {
        const id = r.s.selection!.activeUnit!
        const u = r.s.units[id]!
        const choices = legalPhysicalChoices(r.s, id)
        if (choices.length <= 1) {
          autoResolve(r, 'declarePhysical', 'none')
          push(r, declarePhysical(r.s, r.data, { type: 'declarePhysical', decisionId: '', player: u.owner, unitId: id, attack: { kind: 'none' } }))
          finishUnit(r, 'physical.select')
          continue
        }
        const ctx: DecisionContext = { phase: 'physicalAttack', targets: physicalTargets(r.s, id) }
        if (r.s.resume?.code === 'chargeVoided') ctx.data = { code: 'chargeVoided' }
        raise(r, base(r.s, 'declarePhysical', u.owner, id, ctx))
        return
      }
      case 'physical.resolve':
        push(r, resolvePhysical(r.s, r.data))
        push(r, displacementStep(r.s, r.data))
        r.s = { ...r.s, step: 'physical.endOfPhase' }
        if (closePhase(r)) return
        push(r, beginPhase(r.s, 'heat', 'heat.apply'))
        continue
      case 'heat.apply':
        push(r, heatApply(r.s))
        r.s = { ...r.s, step: 'heat.endOfPhase' }
        if (closePhase(r)) return
        push(r, beginPhase(r.s, 'end', 'end.recovery'))
        continue
      case 'end.recovery':
        push(r, runEndPhaseA(r.s))
        r.s = { ...r.s, step: 'end.power', resume: { code: 'power', data: { asked: [] } } }
        continue
      case 'end.power': {
        const asked = (r.s.resume?.code === 'power' ? (r.s.resume.data.asked as PlayerId[]) : [])
        const q = powerQueries(r.s).find((x) => !asked.includes(x.player))
        if (!q) { r.s = { ...r.s, step: 'end.surrender', resume: null }; continue }
        const options: DecisionOption[] = [opt('none', 'No change', { type: 'powerChoice', decisionId: '', player: q.player, changes: [] })]
        for (const e of q.power) {
          for (const o of e.options) {
            if (o === 'stay') continue
            options.push(opt(`${e.unitId}:${o}`, `${r.s.units[e.unitId]!.name}: ${o}`, { type: 'powerChoice', decisionId: '', player: q.player, changes: [{ unitId: e.unitId, to: o }] }))
          }
        }
        raise(r, { ...base(r.s, 'powerChoice', q.player, null, { phase: 'end', power: q.power }), options })
        return
      }
      case 'end.surrender': {
        push(r, surrenderCheck(r.s))
        r.s = { ...r.s, step: 'end.cleanup' }
        push(r, applyDoomed(r.s))
        push(r, refreshStatus(r.s, r.data))
        r.s = { ...r.s, step: 'end.victory' }
        r.ev.push({ type: 'PhaseEnded', phase: 'end', turn: r.s.turn })
        if (victory(r, true)) return
        r.s = { ...r.s, psr: { queue: [], history: {} } }
        push(r, startInitiativePhase(r.s))
        continue
      }
      case 'game.over':
        return
      default:
        throw new Error(`phase machine: no handler for step ${s.step}`)
    }
  }
  throw new Error('phase machine: no decision after 10000 steps')
}

function placementPending(r: Run): boolean {
  const queue = placementQueueOf(r.s)
  if (!queue) return false
  raise(r, base(r.s, 'deploy', queue.player, null, { phase: 'deployment', eligible: queue.eligible, zone: queue.zone }))
  return true
}
function placementQueueOf(s: GameState): { player: PlayerId; eligible: UnitId[]; zone: Hex[] } | null {
  const next = placementQueue(s)[0]
  if (!next) return null
  return { player: next, eligible: toPlace(s, next), zone: placementZone(s, next) }
}

function twistDecisionOptions(s: GameState, unitId: UnitId, twists: readonly (-1 | 0 | 1)[], canFlip: boolean): DecisionOption[] {
  const owner = s.units[unitId]!.owner
  const mk = (id: string, label: string, twist: -1 | 0 | 1, flip: boolean): DecisionOption =>
    opt(id, label, { type: 'torsoTwist', decisionId: '', player: owner, unitId, twist, flip })
  const out: DecisionOption[] = [mk('forward', 'Keep the torso forward', 0, false)]
  if (twists.includes(-1)) out.push(mk('left', 'Twist left', -1, false))
  if (twists.includes(1)) out.push(mk('right', 'Twist right', 1, false))
  if (canFlip) out.push(mk('flip', 'Flip the arms', 0, true))
  return out
}

/** After a selectUnit: the first step of that unit's turn in this phase. */
function afterSelect(r: Run): void {
  const id = r.s.selection!.activeUnit!
  if (r.s.phase === 'movement') { r.s = { ...r.s, step: 'movement.move' }; return }
  if (r.s.phase === 'rangedAttack') { r.s = { ...r.s, step: 'ranged.twist' }; return }
  // Physical: a charge or DFA declared in Movement books itself; a voided one lets the unit declare again (PHYS-042).
  if (hasCommitted(r.s, id)) {
    const b = bookCommitted(r.s, id)
    push(r, b)
    if (!b.voided) { finishUnit(r, 'physical.select'); return }
    r.s = { ...r.s, resume: { code: 'chargeVoided', data: { unitId: id } } }
  }
  r.s = { ...r.s, step: 'physical.twist' }
}
function finishUnit(r: Run, step: PhaseStep): void {
  if (r.s.resume?.code === 'chargeVoided') r.s = { ...r.s, resume: null }
  push(r, finishSelection(r.s))
  r.s = { ...r.s, step }
}
function raiseMovement(r: Run, unitId: UnitId, kind: 'move' | 'standUp'): void {
  const d = movementDecision(r.s, unitId, kind, '')
  const { id: _id, ...rest } = d
  raise(r, rest)
}

// ---------- createGame ----------
function badSetupState(setup: GameSetup, seed: string, bundle: DataBundle, problems: string[]): StepResult {
  const result: GameResult = { winner: null, reason: 'draw', turn: 0 }
  const pending: PendingDecision = {
    id: 'd:1', player: 'A', kind: 'gameOver', phase: 'ended', step: 'game.over', unitId: null, context: { phase: 'ended', result },
    options: [{ id: 'ack', label: 'Close', action: { type: 'ack', decisionId: 'd:1', player: 'A' } }], canPass: false,
  }
  const state: GameState = {
    format: 1, seed, rng: [0, 0, 0, 0], rollSeq: 0, decisionSeq: 1, attackSeq: 0, psrSeq: 0, phaseSeq: 0, dataVersion: bundle.version,
    setup, board: { mapId: setup.mapId, cols: 0, rows: 0, hexes: {}, centre: { x: 0, z: 0 } },
    sides: {
      A: { id: 'A', sideId: setup.sides?.[0]?.sideId ?? '', label: '', control: 'ai', homeEdge: 'south', deployment: 'edgeEntry' },
      B: { id: 'B', sideId: setup.sides?.[1]?.sideId ?? '', label: '', control: 'ai', homeEdge: 'north', deployment: 'edgeEntry' },
    },
    turn: 0, phase: 'ended', step: 'game.over', damageWindow: 'immediate', initiative: null, selection: null, units: {}, unitOrder: [],
    declarations: [], resolveIndex: 0, current: null,
    ledger: { phase: 'ended', damage: {}, damage20: [], pilotHit: [], immobileAtStart: [], displacements: [] },
    psr: { queue: [], history: {} }, heatLedger: {}, choices: { los: {}, direction: {} }, resume: null, result, pending, log: [],
  }
  return { state, events: [], pending, rejection: { code: 'E_BAD_SETUP', message: problems.join('; '), detail: { problems } } }
}

export function createGameImpl(setup: GameSetup, seed: string, bundle: DataBundle): StepResult {
  let built
  try { built = createInitialState(setup, seed, bundle) } catch (e) { return badSetupState(setup, seed, bundle, [(e as Error).message]) }
  if (isProblems(built)) return badSetupState(setup, seed, bundle, built.problems)
  const r: Run = { s: built.state, ev: [...built.events], data: bundle }
  // hook point 'setup': once per unit after its record is built
  for (const id of r.s.unitOrder) {
    for (const b of collectHooks(r.s, id, 'setup')) {
      const res = b.hook.setup?.({ state: r.s, point: 'setup', unitId: id, sourceId: b.sourceId, ...(b.mountId ? { mountId: b.mountId } : {}) })
      if (res) push(r, res)
    }
  }
  if (r.s.step === 'initiative.roll') r.s = { ...r.s, turn: 0, decisionSeq: 0 }
  else r.s = { ...r.s, decisionSeq: 0 }
  proceed(r)
  return { state: r.s, events: r.ev, pending: r.s.pending }
}

// ---------- validate ----------
const EXPECTED: Record<DecisionKind, Action['type']> = {
  deploy: 'deploy', initiativeAck: 'ack', selectUnit: 'selectUnit', move: 'move', standUp: 'standUp', torsoTwist: 'torsoTwist',
  declareFire: 'declareFire', chooseAmmo: 'chooseAmmo', declarePhysical: 'declarePhysical', powerChoice: 'powerChoice',
  choice: 'choice', gameOver: 'ack',
}
const bad = (code: Rejection['code'], message: string): Rejection => ({ code, message })

function unitChecks(s: GameState, action: { unitId?: unknown; player: PlayerId }, pending: PendingDecision): Rejection | null {
  if (typeof action.unitId !== 'string') return bad('E_BAD_PAYLOAD', 'unitId is missing')
  const u = s.units[action.unitId]
  if (!u) return bad('E_UNKNOWN_UNIT', `unknown unit ${action.unitId}`)
  if (u.owner !== action.player) return bad('E_NOT_YOUR_UNIT', `${action.unitId} is not yours`)
  if (pending.unitId !== null && pending.unitId !== action.unitId) return bad('E_NOT_ELIGIBLE', `the open decision is for ${pending.unitId}`)
  return null
}
function optionMatch(p: PendingDecision, a: Action, key: (x: Action) => string): Rejection | null {
  const k = key(a)
  return (p.options ?? []).some((o) => key(o.action) === k) ? null : bad('E_NOT_AN_OPTION', 'that answer is not one of the options')
}

export function validateImpl(state: GameState, action: Action, data: DataBundle): Rejection | null {
  try {
    return validateInner(state, action, data)
  } catch (e) {
    return bad('E_BAD_PAYLOAD', `malformed action: ${(e as Error).message}`)
  }
}
function validateInner(s: GameState, a: Action, data: DataBundle): Rejection | null {
  const p = s.pending
  if (!a || typeof a !== 'object' || typeof (a as { type?: unknown }).type !== 'string') return bad('E_BAD_PAYLOAD', 'not an action')
  if (p.kind === 'gameOver' && a.type !== 'ack') return bad('E_GAME_OVER', 'the game is over')
  if (a.decisionId !== p.id) return bad('E_WRONG_DECISION', `the open decision is ${p.id}`)
  if (a.player !== p.player) return bad('E_NOT_YOUR_DECISION', `decision ${p.id} belongs to ${p.player}`)
  if (a.type === 'pass') return p.canPass ? null : bad('E_NOT_AN_OPTION', 'this decision cannot be passed')
  if (EXPECTED[p.kind] !== a.type) return bad('E_WRONG_DECISION', `decision ${p.id} wants a ${EXPECTED[p.kind]} answer`)
  switch (a.type) {
    case 'ack': return null
    case 'deploy': {
      const r = validateDeploy(s, a, data)
      if (r) return r
      return p.context.eligible?.includes(a.unitId) ? null : bad('E_NOT_ELIGIBLE', 'that unit is not being placed now')
    }
    case 'selectUnit': {
      const u = s.units[(a as SelectUnitAction).unitId]
      if (!u) return bad('E_UNKNOWN_UNIT', 'unknown unit')
      if (u.owner !== a.player) return bad('E_NOT_YOUR_UNIT', 'not your unit')
      return p.context.eligible?.includes(a.unitId) ? null : bad('E_NOT_ELIGIBLE', `${a.unitId} cannot be selected now`)
    }
    case 'torsoTwist': {
      const uc = unitChecks(s, a, p)
      if (uc) return uc
      const tw = a as TorsoTwistAction
      if (![-1, 0, 1].includes(tw.twist) || typeof tw.flip !== 'boolean') return bad('E_NO_TWIST', 'twist is -1, 0 or 1 hexside')
      return optionMatch(p, a, (x) => { const t = x as TorsoTwistAction; return `${t.twist}|${t.flip}` }) ? bad('E_NO_TWIST', 'that twist or flip is not possible now') : null
    }
    case 'chooseAmmo':
      return optionMatch(p, a, (x) => { const c = x as ChooseAmmoAction; return `${c.mountId}|${c.binId}` })
    case 'choice':
      return optionMatch(p, a, (x) => (x as { optionId: string }).optionId)
    case 'powerChoice': {
      const pc = a as PowerChoiceAction
      if (!Array.isArray(pc.changes)) return bad('E_BAD_PAYLOAD', 'changes must be a list')
      const seen = new Set<string>()
      for (const c of pc.changes) {
        if (seen.has(c.unitId)) return bad('E_DUPLICATE', 'a unit appears twice')
        seen.add(c.unitId)
        const e = p.context.power?.find((x) => x.unitId === c.unitId)
        if (!e) return bad('E_NOT_ELIGIBLE', `${c.unitId} has no power choice`)
        if (!e.options.includes(c.to)) return bad('E_NOT_AN_OPTION', `${c.unitId} cannot ${c.to}`)
      }
      return null
    }
    case 'move':
    case 'standUp': {
      const uc = unitChecks(s, a, p)
      if (uc) return uc
      if (a.type === 'move' && !Array.isArray(a.steps)) return bad('E_BAD_PAYLOAD', 'steps must be a list')
      return validateMovementAction(s, a)
    }
    case 'declareFire': {
      const uc = unitChecks(s, a, p)
      if (uc) return uc
      const f = a as DeclareFireAction
      if (!Array.isArray(f.shots)) return bad('E_BAD_PAYLOAD', 'shots must be a list')
      const out = declareFire(s, data, f, {})
      return out.rejection ?? null
    }
    case 'declarePhysical': {
      const uc = unitChecks(s, a, p)
      if (uc) return uc
      const d = a as DeclarePhysicalAction
      if (!d.attack || typeof d.attack.kind !== 'string') return bad('E_BAD_PAYLOAD', 'attack is missing')
      const out = declarePhysical(s, data, d)
      return out.rejection ?? null
    }
    default:
      return bad('E_BAD_PAYLOAD', 'unknown action type')
  }
}

// ---------- step ----------
export function stepImpl(state: GameState, action: Action, data: DataBundle): StepResult {
  const rejection = validateImpl(state, action, data)
  if (rejection) return { state, events: [{ type: 'ActionRejected', action, rejection }], pending: state.pending, rejection }
  if (state.pending.kind === 'gameOver') return { state, events: [], pending: state.pending }
  const r: Run = { s: { ...state, log: [...state.log, action] }, ev: [], data }
  apply(r, action)
  return { state: r.s, events: r.ev, pending: r.s.pending }
}

function apply(r: Run, a: Action): void {
  switch (a.type) {
    case 'deploy':
      push(r, applyDeploy(r.s, a, r.data))
      r.s = { ...r.s, step: 'deployment.place' }
      return proceed(r)
    case 'ack':
      push(r, finishInitiativePhase(r.s))
      push(r, beginPhase(r.s, 'movement', 'movement.select'))
      push(r, startSelection(r.s, 'movement'))
      return proceed(r)
    case 'selectUnit':
      push(r, selectUnit(r.s, a.unitId))
      afterSelect(r)
      return proceed(r)
    case 'move':
    case 'standUp': {
      const out = applyMovementAction(r.s, a)
      if ('rejection' in out) throw new Error(`validated movement action rejected: ${out.rejection.code}`)
      push(r, out)
      if (victory(r)) return
      const mover = r.s.units[a.unitId]!
      const gone = mover.status === 'destroyed' || mover.doomed !== null || mover.pos === null
      if (!gone && (out.next === 'move' || out.next === 'standUp')) { raiseMovement(r, a.unitId, out.next); return }
      if (gone && !mover.move.done) r.s = { ...r.s, units: { ...r.s.units, [a.unitId]: { ...mover, move: { ...mover.move, done: true } } } }
      finishUnit(r, 'movement.select')
      return proceed(r)
    }
    case 'torsoTwist':
      push(r, applyTorsoTwist(r.s, a))
      r.s = { ...r.s, step: r.s.phase === 'rangedAttack' ? 'ranged.declare' : 'physical.declare' }
      return proceed(r)
    case 'declareFire':
      return fireOutcome(r, declareFire(r.s, r.data, a, {}), a, {})
    case 'chooseAmmo': {
      const out = resumeDeclareFire(r.s, r.data, a.mountId, a.binId)
      const parked = r.s.resume
      const action = parked?.data.action as DeclareFireAction
      const choices = { ...(parked?.data.choices as Record<string, string>), [a.mountId]: a.binId }
      return fireOutcome(r, { ...out, state: out.ammoChoice ? out.state : { ...out.state, resume: null } }, action, choices)
    }
    case 'declarePhysical': {
      const out = declarePhysical(r.s, r.data, a)
      if (out.rejection) throw new Error(`validated physical declaration rejected: ${out.rejection.code}`)
      push(r, out)
      finishUnit(r, 'physical.select')
      return proceed(r)
    }
    case 'powerChoice': {
      push(r, applyPowerChoice(r.s, a.changes))
      const asked = (r.s.resume?.code === 'power' ? (r.s.resume.data.asked as PlayerId[]) : [])
      r.s = { ...r.s, resume: { code: 'power', data: { asked: [...asked, a.player] } } }
      return proceed(r)
    }
    case 'choice':
    case 'pass':
      return proceed(r)
  }
}

function fireOutcome(r: Run, out: FireOutcome, action: DeclareFireAction, choices: Record<string, string>): void {
  if (out.rejection) throw new Error(`validated fire declaration rejected: ${out.rejection.code}`)
  if (out.ammoChoice) {
    const ac = out.ammoChoice
    // offer only the bins under which the whole declaration stays legal (an ammo type can change the weapon's ranges)
    const fits = ac.bins.filter((b) => !declareFire(r.s, r.data, action, { ammoChoices: { ...choices, [ac.mountId]: b.binId } }).rejection)
    const bins = fits.length > 0 ? fits : ac.bins
    r.s = parkDeclaration(r.s, action, choices)
    const u = r.s.units[action.unitId]!
    raise(r, { ...base(r.s, 'chooseAmmo', u.owner, u.id, { phase: 'rangedAttack', mountId: ac.mountId, bins }),
      options: bins.map((b) => opt(b.binId, `${b.ammo} (${b.shots})`, { type: 'chooseAmmo', decisionId: '', player: u.owner, mountId: ac.mountId, binId: b.binId })) })
    return
  }
  push(r, out)
  r.s = { ...r.s, resume: null }
  finishUnit(r, 'ranged.select')
  proceed(r)
}

// ---------- legalActions (00 §9.5) ----------
const FIRE_CAP = 64
export function legalActionsImpl(state: GameState, data: DataBundle): Action[] {
  const p = state.pending
  if (!p) return []
  const ok = (a: Action): boolean => validateImpl(state, a, data) === null
  switch (p.kind) {
    case 'deploy':
      return legalDeployActions(state, p.id, p.player, data).filter((a) => p.context.eligible?.includes(a.unitId))
    case 'initiativeAck':
    case 'gameOver':
      return [{ type: 'ack', decisionId: p.id, player: p.player }]
    case 'selectUnit':
    case 'torsoTwist':
    case 'chooseAmmo':
    case 'choice':
    case 'powerChoice':
      return (p.options ?? []).map((o) => o.action)
    case 'move':
    case 'standUp':
      return legalMovementActions(state).filter(ok)
    case 'declareFire': {
      const unitId = p.unitId!
      const mk = (shots: FireShot[]): DeclareFireAction => ({ type: 'declareFire', decisionId: p.id, player: p.player, unitId, shots })
      const out: Action[] = [mk([])]
      const singles = legalShots(state, data, unitId)
      for (const sh of singles) { if (out.length >= FIRE_CAP) break; out.push(mk([sh])) }
      const byTarget = new Map<string, FireShot[]>()
      for (const sh of singles) {
        const k = sh.targetId ?? ''
        byTarget.set(k, [...(byTarget.get(k) ?? []), sh])
      }
      for (const list of byTarget.values()) {
        if (out.length >= FIRE_CAP) break
        if (list.length < 2) continue
        const a = mk(list.map((x) => ({ ...x })))
        if (ok(a)) out.push(a)
      }
      return out
    }
    case 'declarePhysical':
      return legalPhysicalChoices(state, p.unitId!).map((attack): Action => ({ type: 'declarePhysical', decisionId: p.id, player: p.player, unitId: p.unitId!, attack })).filter(ok)
  }
}
