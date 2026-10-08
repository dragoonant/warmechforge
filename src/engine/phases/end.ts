// End Phase (10 INIT-015): recovery, submerged life support, twist reset, voluntary power, surrender, removal, victory, turn advance.
// Split in two runs around the power decision: runEndPhaseA (steps 1-3), then the orchestrator raises powerChoice for each
// side in powerQueries() (loser first), applies answers with applyPowerChoice(), then runEndPhaseB (steps 5-7 and turn advance).
import type { GameEvent } from '../events'
import { bundleFor } from '../bundles'
import { hitCount, shutdownAvoidTn } from '../heat'
import { addPilotHit, consciousnessChecks, initiativeOrder, patchUnit, recoverPilots } from '../pilot'
import type { Stepped } from '../pilot'
import { roll } from '../rng'
import { isSubmerged } from '../terrain'
import type { DataBundle, DecisionContext, GameResult, GameState, MoveRecord, AttackRecord, PlayerId, UnitId, UnitState } from '../types'
import { applyDoomed, checkVictory, endGame, refreshStatus } from '../victory'
import { collectHooks } from '../hooks'

/** The fresh per-turn records (00 4.3). */
export const freshMove = (facing: UnitState['facing'] = 0): MoveRecord => ({
  mode: null, startHex: null, startFacing: facing, hexesMoved: 0, jumped: false, mpSpent: 0, tmm: 0, attackerMod: 0, done: false,
  entered: false, standAttempts: 0, fell: false, ranHexes: 0,
})
export const freshAttacks = (): AttackRecord => ({
  twist: 0, flipped: false, twistPhase: null, rangedDeclared: false, physicalDeclared: false, primaryTargetId: null, propArm: null,
  firedMounts: [], charge: null, dfa: null,
})

const onMap = (u: UnitState): boolean => (u.status === 'active' || u.status === 'withdrawing') && !u.doomed

function hexOf(state: GameState, u: UnitState): { depth: number } | null {
  if (!u.pos) return null
  for (const h of Object.values(state.board.hexes)) if (h.hex.q === u.pos.q && h.hex.r === u.pos.r) return h
  return null
}

// ---------- step 1-3 ----------
/** INIT-015 (2): one pilot hit for a unit with a life-support crit that ends the turn submerged (CRIT-061). */
export function lifeSupportSubmerged(state: GameState): Stepped {
  let s = state
  const events: GameEvent[] = []
  for (const id of initiativeOrder(s)) {
    const u = s.units[id]!
    if (!onMap(u) || hitCount(u, 'lifeSupport') === 0) continue
    const bh = hexOf(s, u)
    if (!bh || !isSubmerged(bh as never, u.prone)) continue
    const r = addPilotHit(s, id, 'lifeSupportWater')
    s = r.state
    events.push(...r.events)
  }
  return { state: s, events }
}

/** INIT-015 (3): torsos and flipped arms return forward. */
export function resetTwists(state: GameState): Stepped {
  let s = state
  const events: GameEvent[] = []
  for (const id of s.unitOrder) {
    const u = s.units[id]!
    if (u.attacks.twist === 0 && !u.attacks.flipped) continue
    s = patchUnit(s, id, { attacks: { ...u.attacks, twist: 0, flipped: false, twistPhase: null } })
    events.push({ type: 'TwistReset', unitId: id })
  }
  return { state: s, events }
}

/**
 * Hook point 'endPhase' (00 §11.4), once per unit on the map, in initiative order: escalating-failure items not used this turn
 * step their avoid number down (EQUIP-020). Runs with the twist reset (end.reset), before the turn's records are cleared.
 */
export function equipmentUpkeep(state: GameState): Stepped {
  let s = state
  const events: GameEvent[] = []
  for (const id of initiativeOrder(s)) {
    if (!onMap(s.units[id]!)) continue
    let bound
    try { bound = collectHooks(s, id, 'endPhase') } catch { continue }
    for (const b of bound) {
      const r = b.hook.endPhase?.({ state: s, point: 'endPhase', unitId: id, sourceId: b.sourceId, ...(b.mountId ? { mountId: b.mountId } : {}) })
      if (r) { s = r.state; events.push(...r.events) }
    }
  }
  return { state: s, events }
}

/** Steps 1-3 plus the consciousness check for pilots hurt in step 2 (00 5.1: end.consciousness). */
export function runEndPhaseA(state: GameState): Stepped {
  let s: GameState = { ...state, step: 'end.recovery', ledger: { ...state.ledger, phase: 'end' } }
  const events: GameEvent[] = []
  const push = (r: Stepped): void => { s = r.state; events.push(...r.events) }
  push(recoverPilots(s))
  s = { ...s, step: 'end.lifeSupport' }
  push(lifeSupportSubmerged(s))
  s = { ...s, step: 'end.consciousness' }
  push(consciousnessChecks(s))
  s = { ...s, step: 'end.reset' }
  push(resetTwists(s))
  push(equipmentUpkeep(s))
  return { state: { ...s, step: 'end.power' }, events }
}

// ---------- step 4: power ----------
export type PowerEntry = NonNullable<DecisionContext['power']>[number]

/**
 * What a side may do with its units' power now (HEAT-041). A voluntarily shut-down unit (from an earlier turn) with a conscious
 * pilot may restart; with options.manualPower, units on the map may also shut down. Empty list = no decision is raised.
 */
export function powerOptions(state: GameState, player: PlayerId): PowerEntry[] {
  const out: PowerEntry[] = []
  for (const id of initiativeOrder(state)) {
    const u = state.units[id]!
    if (u.owner !== player || !onMap(u) || u.pilot.dead || !u.pilot.conscious) continue
    if (u.shutdown?.cause === 'voluntary' && u.shutdown.turn < state.turn) {
      const e: PowerEntry = { unitId: id, options: ['stay', 'restart'] }
      const tn = shutdownAvoidTn(u.heat)
      if (tn !== null) e.avoidTn = tn
      out.push(e)
    } else if (!u.shutdown && state.setup.options?.manualPower) out.push({ unitId: id, options: ['stay', 'shutdown'] })
  }
  return out
}
/** Sides that owe a powerChoice decision, loser first. */
export function powerQueries(state: GameState): { player: PlayerId; power: PowerEntry[] }[] {
  const order: PlayerId[] = state.initiative ? [state.initiative.loser, state.initiative.winner] : ['A', 'B']
  return order.map((player) => ({ player, power: powerOptions(state, player) })).filter((q) => q.power.length > 0)
}

/** Applies a PowerChoiceAction's changes; illegal changes are ignored (the validator rejects them first). */
export function applyPowerChoice(state: GameState, changes: { unitId: UnitId; to: 'shutdown' | 'restart' }[]): Stepped {
  let s = state
  const events: GameEvent[] = []
  for (const c of changes) {
    const u = s.units[c.unitId]
    if (!u || !onMap(u)) continue
    if (c.to === 'shutdown' && !u.shutdown) {
      s = patchUnit(s, c.unitId, { shutdown: { cause: 'voluntary', turn: s.turn } })
      events.push({ type: 'UnitShutdown', unitId: c.unitId, cause: 'voluntary', heat: u.heat })
    } else if (c.to === 'restart' && u.shutdown?.cause === 'voluntary' && u.shutdown.turn < s.turn && u.pilot.conscious) {
      const tn = shutdownAvoidTn(u.heat)
      if (u.heat >= 30) continue // an automatic shutdown level: it would drop again, so the restart is refused
      let ok = true
      if (tn !== null) {
        const r = roll(s, { count: 2, sides: 6, purpose: 'startup', unitId: c.unitId, target: tn, reason: 'restart' })
        s = r.state
        events.push(r.event)
        ok = r.event.success === true
      }
      if (ok) {
        s = patchUnit(s, c.unitId, { shutdown: null })
        events.push({ type: 'UnitRestarted', unitId: c.unitId, heat: u.heat, auto: tn === null })
      }
    }
  }
  return { state: s, events }
}

// ---------- step 5: surrender ----------
const bothLegsGone = (u: UnitState): boolean => u.locs.LL.destroyed && u.locs.RL.destroyed

/** 11 section 3.4: immobile (MOVE-008), 0 MP in every mode, or prone and unable to stand. */
export function cannotWithdraw(u: UnitState): boolean {
  if (u.shutdown || !u.pilot.conscious || u.pilot.dead) return true
  if (bothLegsGone(u) && u.baseMp.jump === 0) return true
  return u.prone && (bothLegsGone(u) || hitCount(u, 'gyro') >= 2)
}

export function surrenderCheck(state: GameState): Stepped {
  if (!state.setup.forcedWithdrawal) return { state, events: [] }
  let s = state
  const events: GameEvent[] = []
  for (const id of initiativeOrder(s)) {
    const u = s.units[id]!
    if (u.status !== 'withdrawing' || u.doomed || !cannotWithdraw(u)) continue
    s = patchUnit(s, id, { status: 'surrendered', destroyedCause: 'surrendered', pos: null })
    events.push({ type: 'StatusChanged', unitId: id, status: 'surrendered', crippled: u.crippled, was: 'withdrawing' })
    events.push({ type: 'UnitRemoved', unitId: id, status: 'surrendered' })
  }
  return { state: s, events }
}

// ---------- steps 6-7 and the turn advance ----------
/** Per-turn reset and turn advance (END cleanup). Idempotent with the Initiative Phase resets. */
export function advanceTurn(state: GameState): Stepped {
  const units = { ...state.units }
  for (const id of state.unitOrder) {
    const u = units[id]!
    units[id] = { ...u, move: freshMove(u.facing), attacks: freshAttacks(), escalating: Object.fromEntries(Object.entries(u.escalating).map(([k, v]) => [k, { ...v, usedThisTurn: false }])) }
  }
  const s: GameState = {
    ...state, units, turn: state.turn + 1, phase: 'initiative', step: 'initiative.roll', damageWindow: 'immediate', selection: null,
    declarations: [], resolveIndex: 0, current: null, choices: { los: {}, direction: {} }, heatLedger: {},
    psr: { queue: [], history: {} },
    ledger: { phase: 'initiative', damage: {}, damage20: [], pilotHit: [], immobileAtStart: [], displacements: [] },
  }
  return { state: s, events: [{ type: 'TurnStarted', turn: s.turn }] }
}

export interface EndPhaseB extends Stepped { result: GameResult | null }
/** Steps 5-7: surrender, removal, victory (with the turn limit); advances the turn unless the game ended. */
export function runEndPhaseB(state: GameState, data?: DataBundle): EndPhaseB {
  const d = data ?? bundleFor(state)
  let s: GameState = { ...state, step: 'end.surrender' }
  const events: GameEvent[] = []
  const push = (r: Stepped): void => { s = r.state; events.push(...r.events) }
  push(surrenderCheck(s))
  s = { ...s, step: 'end.cleanup' }
  push(applyDoomed(s))
  push(refreshStatus(s, d))
  s = { ...s, step: 'end.victory' }
  const result = checkVictory(s, { atEndPhase: true }, d)
  if (result) {
    push(endGame(s, result))
    return { state: s, events, result }
  }
  push(advanceTurn(s))
  return { state: s, events, result: null }
}
