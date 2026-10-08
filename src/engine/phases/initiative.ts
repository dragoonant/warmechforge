// Initiative Phase (00 §5.1): TurnStarted, PhaseStarted, per-turn resets, both sides roll, InitiativeResolved, then the ack stop.
import type { GameEvent } from '../events'
import { beginPhase, freshAttacks, freshMove, rollInitiative } from '../initiative'
import type { Stepped } from '../initiative'
import type { GameState, PlayerId } from '../types'

/**
 * Starts the next turn's Initiative Phase (also used for turn 1 after deployment). Resets every unit's move and attack
 * records and the turn's LOS / direction choices, clears the heat ledger, rolls initiative (A then B, ties re-roll both).
 * Leaves `phase 'initiative'`, `step 'initiative.ack'`; the caller raises the initiativeAck decision.
 */
export function startInitiativePhase(state: GameState): Stepped {
  const turn = state.turn + 1
  const events: GameEvent[] = [{ type: 'TurnStarted', turn }]
  const units = { ...state.units }
  for (const id of state.unitOrder) {
    const u = units[id]!
    // escalating-failure items (EQUIP-020): a new turn starts unused; the End Phase already stepped unused ones down
    const escalating = Object.fromEntries(Object.entries(u.escalating ?? {}).map(([k, v]) => [k, { ...v, usedThisTurn: false }]))
    units[id] = { ...u, move: freshMove(u), attacks: freshAttacks(), escalating }
  }
  let s: GameState = { ...state, turn, units, heatLedger: {}, choices: { los: {}, direction: {} }, initiative: null }
  const b = beginPhase(s, 'initiative', 'initiative.roll')
  s = b.state; events.push(...b.events)
  const r = rollInitiative(s)
  s = { ...r.state, step: 'initiative.ack' }
  events.push(...r.events)
  return { state: s, events }
}

/** Numbers for the initiativeAck decision context (`data: {totals, winner}`, 00 §9.2). */
export function initiativeAckData(state: GameState): { totals: Record<PlayerId, number>; winner: PlayerId; loser: PlayerId; rerolls: number } {
  const i = state.initiative
  if (!i) throw new Error('initiative not rolled')
  return { totals: i.totals, winner: i.winner, loser: i.loser, rerolls: i.rerolls }
}

/** The ack was given: close the phase (the caller starts Movement next). */
export function finishInitiativePhase(state: GameState): Stepped {
  return { state, events: [{ type: 'PhaseEnded', phase: 'initiative', turn: state.turn }] }
}
