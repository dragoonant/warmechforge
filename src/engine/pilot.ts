// Pilot hits, consciousness and recovery (10 §15, 00 §5.4). Pure: state in, { state, events } out.
import type { GameEvent } from './events'
import { roll } from './rng'
import type { DestroyCause, GameState, UnitId, UnitState } from './types'

export interface Stepped { state: GameState; events: GameEvent[] }
export type PilotHitCause = 'head' | 'seatbelt' | 'explosion' | 'lifeSupportHeat' | 'lifeSupportWater' | 'fallImmobile'

/** Consciousness TN for the pilot's current total hits (PILOT-010). 0 hits or dead: null. */
export function consciousnessTn(hits: number): number | null {
  if (hits <= 0 || hits >= 6) return null
  return [0, 3, 5, 7, 10, 11][hits]!
}

/** Units in initiative order: the loser's side first, each side in unitOrder (INIT-013, HEAT-030). */
export function initiativeOrder(state: GameState): UnitId[] {
  const loser = state.initiative?.loser
  if (!loser) return [...state.unitOrder]
  return [...state.unitOrder.filter((id) => state.units[id]!.owner === loser), ...state.unitOrder.filter((id) => state.units[id]!.owner !== loser)]
}

export function patchUnit(state: GameState, id: UnitId, patch: Partial<UnitState>): GameState {
  return { ...state, units: { ...state.units, [id]: { ...state.units[id]!, ...patch } } }
}

/** Standing-or-not immobility from the pilot/power side: shut down or unconscious (PSR-005, PILOT-011). */
export function isIncapacitated(u: UnitState): boolean {
  return u.shutdown !== null || !u.pilot.conscious || u.pilot.dead
}

/**
 * Adds pilot hits (PILOT-001). At 6: PilotKilled and the unit is destroyed (booked as doomed inside a simultaneous window,
 * PILOT-002 / 00 §5.3). A hit on a living pilot owes one consciousness check at end of phase (ledger.pilotHit).
 */
export function addPilotHit(state: GameState, unitId: UnitId, cause: PilotHitCause, n = 1): Stepped {
  const u = state.units[unitId]!
  if (u.pilot.dead || n <= 0) return { state, events: [] }
  const total = Math.min(6, u.pilot.hits + n)
  const events: GameEvent[] = [{ type: 'PilotHit', unitId, hits: total - u.pilot.hits, total, cause }]
  let s = patchUnit(state, unitId, { pilot: { ...u.pilot, hits: total } })
  if (total >= 6) {
    const dead: DestroyCause = 'pilotKilled'
    events.push({ type: 'PilotKilled', unitId })
    s = patchUnit(s, unitId, { pilot: { ...s.units[unitId]!.pilot, hits: 6, dead: true, conscious: false } })
    if (s.damageWindow === 'simultaneous') {
      s = patchUnit(s, unitId, { doomed: s.units[unitId]!.doomed ?? dead })
      events.push({ type: 'UnitDestroyed', unitId, cause: dead, effective: false })
    } else {
      const was = s.units[unitId]!.status
      s = patchUnit(s, unitId, { status: 'destroyed', destroyedCause: dead })
      events.push({ type: 'UnitDestroyed', unitId, cause: dead, effective: true })
      events.push({ type: 'StatusChanged', unitId, status: 'destroyed', crippled: s.units[unitId]!.crippled, was })
    }
  } else if (!s.ledger.pilotHit.includes(unitId)) {
    s = { ...s, ledger: { ...s.ledger, pilotHit: [...s.ledger.pilotHit, unitId] } }
  }
  return { state: s, events }
}

/**
 * End-of-phase consciousness checks (00 §5.4 b and d): one roll per owed unit, in initiative order, against the TN for the
 * pilot's current total hits (PILOT-010). Clears ledger.pilotHit.
 */
export function consciousnessChecks(state: GameState): Stepped {
  let s = state
  const events: GameEvent[] = []
  const owed = new Set(s.ledger.pilotHit)
  for (const id of initiativeOrder(s)) {
    if (!owed.has(id)) continue
    const u = s.units[id]!
    const tn = consciousnessTn(u.pilot.hits)
    if (!u.pilot.conscious || u.pilot.dead || u.status === 'destroyed' || u.doomed || tn === null) continue
    const r = roll(s, { count: 2, sides: 6, purpose: 'consciousness', unitId: id, target: tn, reason: 'consciousness' })
    s = r.state
    events.push(r.event)
    const conscious = r.event.success === true
    events.push({ type: 'ConsciousnessChecked', unitId: id, hits: u.pilot.hits, tn, roll: r.event.total, conscious })
    if (!conscious) s = patchUnit(s, id, { pilot: { ...s.units[id]!.pilot, conscious: false, koTurn: s.turn } })
  }
  return { state: { ...s, ledger: { ...s.ledger, pilotHit: [] } }, events }
}

/** End Phase recovery (PILOT-020): from the turn after the knockout, 2d6 >= TN for current hits wakes the pilot. */
export function recoverPilots(state: GameState): Stepped {
  let s = state
  const events: GameEvent[] = []
  for (const id of initiativeOrder(s)) {
    const u = s.units[id]!
    const tn = consciousnessTn(u.pilot.hits)
    if (u.pilot.conscious || u.pilot.dead || u.status === 'destroyed' || u.pilot.koTurn === null || u.pilot.koTurn >= s.turn || tn === null) continue
    const r = roll(s, { count: 2, sides: 6, purpose: 'recovery', unitId: id, target: tn, reason: 'recovery' })
    s = r.state
    events.push(r.event)
    const recovered = r.event.success === true
    events.push({ type: 'PilotRecovered', unitId: id, tn, roll: r.event.total, recovered })
    if (recovered) s = patchUnit(s, id, { pilot: { ...s.units[id]!.pilot, conscious: true, koTurn: null } })
  }
  return { state: s, events }
}
