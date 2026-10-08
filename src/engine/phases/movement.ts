// Movement Phase decision flow (00 section 5.1, 9.2, 9.3): which decision a selected unit gets, its context, its legal answers,
// and the handler that applies a MoveAction or StandUpAction. Unit selection and the alternation live in initiative.ts;
// the phase machine calls these after a selectUnit and follows `next` of each outcome.
import type { Action, MoveAction, StandUpAction } from '../actions'
import { entryContext } from '../deploy'
import { currentMp, executeMove, executeStandUp, isImmobile, reachable, standCheck, standPsrOdds, validateMove, validateStandUp } from '../movement'
import type { MoveNext, MoveOutcome } from '../movement'
import { persistentMods } from '../psr'
import type { DecisionContext, GameState, Mod, PendingDecision, PlayerId, Rejection, UnitId } from '../types'
import { FACINGS } from '../types'

export type { MoveNext, MoveOutcome }

/** Units that may be selected in the Movement Phase for a side (INIT-004, MOVE-009). */
export function movementEligible(state: GameState, player?: PlayerId): UnitId[] {
  return state.unitOrder.filter((id) => {
    const u = state.units[id]!
    if (player && u.owner !== player) return false
    if (u.move.done) return false
    if (u.status === 'offBoard') return state.turn >= 1
    if ((u.status !== 'active' && u.status !== 'withdrawing') || !u.pos) return false
    return !isImmobile(state, u)
  })
}

/** Which decision a freshly selected unit gets: edge entry and standing units move, prone units stand-or-stay. */
export function firstDecisionKind(state: GameState, unitId: UnitId): 'move' | 'standUp' {
  const u = state.units[unitId]!
  return u.status !== 'offBoard' && u.prone ? 'standUp' : 'move'
}

/** MP still open to the unit in its locked mode (the larger of walk/run before a mode is chosen). */
export function mpLeft(state: GameState, unitId: UnitId): number {
  const u = state.units[unitId]!
  const mp = currentMp(state, unitId)
  const m = u.move.mode
  if (m === null) return Math.max(mp.walk, mp.run)
  return Math.max(0, (m === 'walk' ? mp.walk : m === 'run' ? mp.run : m === 'jump' ? mp.jump : 0) - u.move.mpSpent)
}

export function moveContext(state: GameState, unitId: UnitId, kind: 'move' | 'standUp'): DecisionContext {
  const u = state.units[unitId]!
  const ctx: DecisionContext = { phase: 'movement' }
  if (u.move.mode !== null) { ctx.lockedMode = u.move.mode; ctx.mpLeft = mpLeft(state, unitId) }
  if (kind === 'move' && u.status === 'offBoard') ctx.entry = entryContext(state, unitId)
  if (kind === 'standUp') {
    const o = standPsrOdds(state, unitId)
    const mods: Mod[] = [{ code: 'piloting', value: u.pilot.piloting }, ...persistentMods(u), { code: 'stand', value: -1 }]
    ctx.psr = { tn: o.tn, mods, p: o.p, auto: o.tn > 12 }
  }
  return ctx
}

/** The PendingDecision for a unit's move or stand-up (id supplied by the caller's decision counter). */
export function movementDecision(state: GameState, unitId: UnitId, kind: 'move' | 'standUp', id: string): PendingDecision {
  const u = state.units[unitId]!
  return { id, player: u.owner, kind, phase: 'movement', step: 'movement.move', unitId, context: moveContext(state, unitId, kind), canPass: false }
}

/** legalActions for an open move or standUp decision (00 section 9.5). Never empty for a unit on the board. */
export function legalMovementActions(state: GameState): Action[] {
  const p = state.pending
  const unitId = p.unitId
  if (!unitId) return []
  const u = state.units[unitId]!
  if (p.kind === 'move') return reachable(state, unitId).map((e) => e.action)
  if (p.kind !== 'standUp') return []
  const base = { type: 'standUp' as const, decisionId: p.id, player: u.owner, unitId }
  const out: StandUpAction[] = []
  const locked = u.move.mode === 'walk' || u.move.mode === 'run' ? u.move.mode : null
  if (locked === null) out.push({ ...base, attempt: false }, { ...base, attempt: false, mode: 'walk' })
  else out.push({ ...base, attempt: false, mode: locked })
  const modes: ('walk' | 'run')[] = locked === null ? ['walk', 'run'] : locked === 'walk' ? ['walk', 'run'] : ['run']
  for (const mode of modes) {
    if (!standCheck(state, u, mode).ok) continue
    for (const facing of FACINGS) out.push({ ...base, attempt: true, mode, facing })
  }
  return out
}

export function validateMovementAction(state: GameState, action: Action): Rejection | null {
  if (action.type === 'move') return validateMove(state, action)
  if (action.type === 'standUp') return validateStandUp(state, action)
  return { code: 'E_NOT_AN_OPTION', message: 'not a movement action' }
}

/** Applies a move or stand-up. `next` says what the phase machine opens: 'move', 'standUp', or 'done' (MoveEnded booked). */
export function applyMovementAction(state: GameState, action: MoveAction | StandUpAction): MoveOutcome | { rejection: Rejection } {
  return action.type === 'move' ? executeMove(state, action) : executeStandUp(state, action)
}
