// Initiative rolls (INIT-002), the alternating selection order (INIT-003..007) and the phase begin/finish helpers shared by
// the Ranged and Physical phases (INIT-012/013, 00 §5). Pure: state in, { state, events } out.
import type { GameEvent } from './events'
import { roll } from './rng'
import { consciousnessChecks, initiativeOrder, isIncapacitated } from './pilot'
import type { Stepped } from './pilot'
import { resolvePsrs } from './psr'
import { collectHooks } from './hooks'
import type {
  PhaseId, PhaseStep, PlayerId, Rejection, SelectionState, UnitId, UnitState, GameState, MoveRecord, AttackRecord,
} from './types'

export type { Stepped }
export type AltPhase = SelectionState['phase']

// ---------- initiative roll (INIT-002) ----------
/** Sum of the `initiative` hook modifiers of a side's units (SPAs). collectHooks is a stub until M2: no hooks → 0. */
function initiativeHookMod(state: GameState, side: PlayerId): number {
  let total = 0
  for (const id of state.unitOrder) {
    const u = state.units[id]!
    if (u.owner !== side || u.status === 'destroyed') continue
    let bound
    try { bound = collectHooks(state, id, 'initiative') } catch { return 0 }
    for (const b of bound) {
      const m = b.hook.initiative?.({ state, point: 'initiative', unitId: id, sourceId: b.sourceId })
      if (m) total += m
    }
  }
  return total
}

/** Each side rolls 2d6 (A then B). A tie re-rolls both, A then B. Higher total wins; the loser acts first (INIT-002). */
export function rollInitiative(state: GameState): Stepped {
  let s = state
  const events: GameEvent[] = []
  let rerolls = 0
  for (let guard = 0; guard < 1000; guard++) {
    const totals = { A: 0, B: 0 }
    for (const side of ['A', 'B'] as const) {
      const flat = initiativeHookMod(s, side)
      const r = roll(s, { count: 2, sides: 6, purpose: 'initiative', reason: side, flat })
      s = r.state
      events.push(r.event)
      totals[side] = r.event.total
    }
    if (totals.A === totals.B) { rerolls++; continue }
    const winner: PlayerId = totals.A > totals.B ? 'A' : 'B'
    const loser: PlayerId = winner === 'A' ? 'B' : 'A'
    s = { ...s, initiative: { winner, loser, totals, rerolls } }
    events.push({ type: 'InitiativeResolved', totals, winner, loser, rerolls })
    return { state: s, events }
  }
  throw new Error('initiative: 1000 tied rolls in a row')
}

// ---------- eligibility (INIT-004) ----------
/**
 * Late-bound extras. movement.ts may replace `movementImmobile` to add MOVE-008's "0 MP in every mode" test; the default only
 * knows shut down and pilot out.
 */
export const selectionDeps = {
  movementImmobile: (_state: GameState, u: UnitState): boolean => isIncapacitated(u),
}

const alive = (u: UnitState): boolean => u.status !== 'destroyed' && u.doomed === null && u.status !== 'withdrawn' && u.status !== 'surrendered'

/** Units that count in the alternation of a phase for one side (INIT-004). */
export function eligibleUnits(state: GameState, phase: AltPhase, side?: PlayerId): UnitId[] {
  const out: UnitId[] = []
  for (const id of state.unitOrder) {
    const u = state.units[id]!
    if (side && u.owner !== side) continue
    if (!alive(u)) continue
    if (phase === 'movement') {
      if (u.status === 'offBoard') { /* due to enter */ }
      else if ((u.status !== 'active' && u.status !== 'withdrawing') || !u.pos) continue
      if (selectionDeps.movementImmobile(state, u)) continue
    } else {
      if ((u.status !== 'active' && u.status !== 'withdrawing') || !u.pos) continue
      if (isIncapacitated(u)) continue
    }
    out.push(id)
  }
  return out
}

const remaining = (state: GameState, sel: SelectionState, side: PlayerId): UnitId[] =>
  eligibleUnits(state, sel.phase, side).filter((id) => !sel.acted.includes(id))

/** INIT-005 counts for one pair: how many units L then W select. Exported for the order tests (INIT-005/006). */
export function pairCounts(a: number, b: number): { L: number; W: number } {
  if (a === 0 && b === 0) return { L: 0, W: 0 }
  if (a === 0) return { L: 0, W: b }
  if (b === 0) return { L: a, W: 0 }
  return { L: a > b ? Math.ceil(a / b) : 1, W: b > a ? Math.ceil(b / a) : 1 }
}

/** The whole alternation for fixed unit counts, as a string of L and W (no mid-phase losses). */
export function planSequence(loserUnits: number, winnerUnits: number): string {
  let a = loserUnits, b = winnerUnits
  let out = ''
  while (a + b > 0) {
    const n = pairCounts(a, b)
    out += 'L'.repeat(Math.min(n.L, a)) + 'W'.repeat(Math.min(n.W, b))
    a -= Math.min(n.L, a); b -= Math.min(n.W, b)
  }
  return out
}

// ---------- the selection machine ----------
function sidesOf(state: GameState): { L: PlayerId; W: PlayerId } {
  const i = state.initiative
  if (!i) throw new Error('selection before initiative')
  return { L: i.loser, W: i.winner }
}

/** Moves to the next half-pair that still has a unit to select; selection becomes null when the phase has no selections left. */
function advance(state: GameState, events: GameEvent[]): GameState {
  const sel0 = state.selection
  if (!sel0) return state
  const { L, W } = sidesOf(state)
  let sel: SelectionState = { ...sel0, activeUnit: null }
  for (let guard = 0; guard < 1000; guard++) {
    if (sel.leftInGroup > 0 && remaining(state, sel, sel.turnOf).length > 0) return { ...state, selection: sel }
    if (sel.pair > 0 && sel.turnOf === L) {
      sel = { ...sel, turnOf: W, leftInGroup: Math.min(sel.pairCounts[W], remaining(state, sel, W).length) }
      continue
    }
    // new pair
    const a = remaining(state, sel, L).length, b = remaining(state, sel, W).length
    if (a + b === 0) return { ...state, selection: null }
    const n = pairCounts(a, b)
    const counts = { [L]: n.L, [W]: n.W } as Record<PlayerId, number>
    sel = { ...sel, pair: sel.pair + 1, turnOf: L, leftInGroup: Math.min(n.L, a), pairCounts: counts }
    events.push({ type: 'PairStarted', phase: state.phase, pair: sel.pair, counts })
  }
  throw new Error('selection did not converge')
}

/** Begins the alternation of Movement, Ranged or Physical (INIT-005). Leaves `selection` null when nobody is eligible. */
export function startSelection(state: GameState, phase: AltPhase): Stepped {
  const events: GameEvent[] = []
  const fresh: SelectionState = {
    phase, pair: 0, turnOf: sidesOf(state).L, leftInGroup: 0, pairCounts: { A: 0, B: 0 }, acted: [], activeUnit: null,
  }
  const s = advance({ ...state, selection: fresh }, events)
  return { state: s, events }
}

export function selectionRejection(code: Rejection['code'], message: string): Rejection { return { code, message } }

/** Picks the next unit (a selectUnit answer). Rejects units that are not eligible now or belong to the other side. */
export function selectUnit(state: GameState, unitId: UnitId): Stepped & { rejection?: Rejection } {
  const sel = state.selection
  if (!sel) return { state, events: [], rejection: selectionRejection('E_WRONG_DECISION', 'no selection is open') }
  const u = state.units[unitId]
  if (!u) return { state, events: [], rejection: selectionRejection('E_UNKNOWN_UNIT', `unknown unit ${unitId}`) }
  if (u.owner !== sel.turnOf) return { state, events: [], rejection: selectionRejection('E_NOT_YOUR_UNIT', `${unitId} is not the selecting side's unit`) }
  if (sel.activeUnit) return { state, events: [], rejection: selectionRejection('E_WRONG_DECISION', 'the previous unit has not finished') }
  if (!remaining(state, sel, sel.turnOf).includes(unitId)) {
    return { state, events: [], rejection: selectionRejection('E_NOT_ELIGIBLE', `${unitId} cannot be selected`) }
  }
  const next: SelectionState = { ...sel, acted: [...sel.acted, unitId], activeUnit: unitId, leftInGroup: sel.leftInGroup - 1 }
  return { state: { ...state, selection: next }, events: [{ type: 'UnitSelected', unitId, phase: state.phase }] }
}

/** The active unit's move or declaration is complete (INIT-007): open the next selection, or close the alternation. */
export function finishSelection(state: GameState): Stepped {
  const events: GameEvent[] = []
  return { state: advance(state, events), events }
}

// ---------- phase begin / end (00 §5.1, §5.4) ----------
export const freshMove = (u: UnitState): MoveRecord => ({
  mode: null, startHex: null, startFacing: u.facing, hexesMoved: 0, jumped: false, mpSpent: 0, tmm: 0, attackerMod: 0,
  done: false, entered: false, standAttempts: 0, fell: false, ranHexes: 0,
})
export const freshAttacks = (): AttackRecord => ({
  twist: 0, flipped: false, twistPhase: null, rangedDeclared: false, physicalDeclared: false, primaryTargetId: null,
  propArm: null, firedMounts: [], charge: null, dfa: null,
})

/** PhaseStarted: new phaseSeq, ledger and PSR history reset, immobility snapshot (TOHIT-018), declarations cleared. */
export function beginPhase(state: GameState, phase: PhaseId, step: PhaseStep): Stepped {
  const immobile = state.unitOrder.filter((id) => {
    const u = state.units[id]!
    return alive(u) && (isIncapacitated(u) || (u.pos !== null && selectionDeps.movementImmobile(state, u)))
  })
  const s: GameState = {
    ...state,
    phase, step, phaseSeq: state.phaseSeq + 1, damageWindow: 'immediate', selection: null, declarations: [], resolveIndex: 0, current: null,
    ledger: { phase, damage: {}, damage20: [], pilotHit: [], immobileAtStart: immobile, displacements: [] },
    psr: { queue: state.psr.queue, history: {} },
  }
  return { state: s, events: [{ type: 'PhaseStarted', phase, turn: state.turn }] }
}

/** Late-bound crippled / withdrawal / victory re-check (00 §5.4 e). scenario.ts replaces it. */
export const phaseEndDeps = {
  crippledAndVictory: (state: GameState): Stepped => ({ state, events: [] }),
}

/**
 * 00 §5.4 (a)-(e): book-keeping effects and removal of doomed units, consciousness for pilots hit this phase, the PSR queue
 * (automatic falls first), consciousness for pilots hit by those falls, crippled/victory, PhaseEnded.
 */
export function finishPhase(state: GameState): Stepped {
  let s: GameState = { ...state, damageWindow: 'immediate' }
  const events: GameEvent[] = []
  // (a)
  for (const id of s.unitOrder) {
    const u = s.units[id]!
    if (!u.doomed || u.status === 'destroyed') continue
    const was = u.status
    s = { ...s, units: { ...s.units, [id]: { ...u, status: 'destroyed', destroyedCause: u.doomed, doomed: null } } }
    events.push({ type: 'UnitDestroyed', unitId: id, cause: u.doomed, effective: true })
    events.push({ type: 'StatusChanged', unitId: id, status: 'destroyed', crippled: u.crippled, was })
  }
  // (b)
  let r = consciousnessChecks(s)
  s = r.state; events.push(...r.events)
  // (c)
  r = resolvePsrs(s, { when: ['now', 'endOfMove', 'endOfPhase'] })
  s = r.state; events.push(...r.events)
  // (d)
  r = consciousnessChecks(s)
  s = r.state; events.push(...r.events)
  // (e)
  r = phaseEndDeps.crippledAndVictory(s)
  s = r.state; events.push(...r.events)
  events.push({ type: 'PhaseEnded', phase: s.phase, turn: s.turn })
  return { state: s, events }
}

export { initiativeOrder }
