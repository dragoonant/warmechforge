// Roll helpers and the working context shared by the damage pipeline (damage/crits/ammo/hitloc/cluster).
// Every roll goes through rng.roll() (the only way to roll). Pure at the API edge: state in, state + events out.
// Inside one procedure a Work object holds a lazily cloned copy of the units it touches, so nested crit/explosion
// chains can mutate freely and commit once.
import type { DiceRolled, GameEvent } from './events'
import type { RollSpec } from './rng'
import { roll } from './rng'
import type { DataBundle, GameState, PhaseLedger, PsrState, UnitId, UnitState } from './types'

export interface Work {
  s: GameState // rng, rollSeq, phase info are current here; units/ledger/psr are authoritative in the fields below
  ev: GameEvent[]
  data: DataBundle
  units: Record<UnitId, UnitState> // lazily cloned units
  ledger: PhaseLedger
  psr: PsrState
  legPsr: Set<string> // `${unit}:${leg}` leg actuator PSRs queued in this procedure (CRIT-095)
}

export function beginWork(state: GameState, data: DataBundle): Work {
  return {
    s: state, ev: [], data, units: {},
    ledger: {
      ...state.ledger,
      damage: { ...state.ledger.damage }, damage20: [...state.ledger.damage20], pilotHit: [...state.ledger.pilotHit],
    },
    psr: { queue: [...state.psr.queue], history: { ...state.psr.history } },
    legPsr: new Set(),
  }
}

/** The mutable working copy of a unit (cloned on first touch). */
export function unitOf(w: Work, id: UnitId): UnitState {
  let u = w.units[id]
  if (!u) {
    const src = w.s.units[id]
    if (!src) throw new Error(`unknown unit ${id}`)
    u = structuredClone(src)
    w.units[id] = u
  }
  return u
}

export function endWork(w: Work): { state: GameState; events: GameEvent[] } {
  const state: GameState = {
    ...w.s,
    units: { ...w.s.units, ...w.units },
    ledger: w.ledger,
    psr: w.psr,
  }
  return { state, events: w.ev }
}

/** The work state with all pending unit/ledger/psr changes merged in (for calling the state-in/state-out modules). */
export function snapshot(w: Work): GameState {
  return { ...w.s, units: { ...w.s.units, ...w.units }, ledger: w.ledger, psr: w.psr }
}

const copyLedger = (l: PhaseLedger): PhaseLedger => ({
  ...l, damage: { ...l.damage }, damage20: [...l.damage20], pilotHit: [...l.pilotHit],
})

/**
 * Runs a pure state-in/state-out collaborator (queuePsr, addPilotHit) against the work state and takes its result back.
 * Unit objects fetched with unitOf() before this call are stale afterwards: fetch them again.
 */
export function viaState<T extends { state: GameState; events: GameEvent[] }>(w: Work, fn: (s: GameState) => T): T {
  const r = fn(snapshot(w))
  w.s = r.state
  w.units = {}
  w.ledger = copyLedger(r.state.ledger)
  w.psr = { queue: [...r.state.psr.queue], history: { ...r.state.psr.history } }
  w.ev.push(...r.events)
  return r
}

export interface RollResult { dice: number[]; total: number; success?: boolean; event: DiceRolled }

/** Rolls through rng.roll(), advances rng/rollSeq in the work state and appends the DiceRolled event. */
export function rollIn(w: Work, spec: RollSpec): RollResult {
  const r = roll(w.s, spec)
  w.s = { ...w.s, rng: r.state.rng, rollSeq: r.state.rollSeq }
  w.ev.push(r.event)
  const out: RollResult = { dice: r.event.dice, total: r.event.total, event: r.event }
  if (r.event.success !== undefined) out.success = r.event.success
  return out
}

export const roll2d6 = (w: Work, spec: Omit<RollSpec, 'count' | 'sides'>): RollResult => rollIn(w, { ...spec, count: 2, sides: 6 })
export const roll1d6 = (w: Work, spec: Omit<RollSpec, 'count' | 'sides'>): RollResult => rollIn(w, { ...spec, count: 1, sides: 6 })

/** Standalone convenience: one roll, state and event out. */
export function rollOnce(state: GameState, spec: RollSpec): { state: GameState; event: DiceRolled } {
  return roll(state, spec)
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
