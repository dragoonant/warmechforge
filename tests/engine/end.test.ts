import { afterEach, describe, expect, it, vi } from 'vitest'

const FORCED = vi.hoisted(() => [] as number[][])
vi.mock('../../src/engine/rng', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/rng')>()
  return {
    ...real,
    roll(state: import('../../src/engine/types').GameState, spec: import('../../src/engine/rng').RollSpec) {
      const f = FORCED.shift()
      if (!f) return real.roll(state, spec)
      return { state: { ...state, rollSeq: state.rollSeq + 1 }, event: real.diceEvent(state, spec, f) }
    },
  }
})

import { BUNDLE, mkState, mkUnit } from './damage.fixture'
import { registerBundle } from '../../src/engine/index'
import { applyPowerChoice, powerQueries, runEndPhaseA, runEndPhaseB, surrenderCheck } from '../../src/engine/phases/end'
import type { DataBundle, GameState } from '../../src/engine/types'

afterEach(() => { expect(FORCED).toHaveLength(0); FORCED.length = 0 })
const bundle = { ...BUNDLE, mechs: { 'mech.test': { id: 'mech.test', bv: 1000 } }, missions: { 'mission.t': { id: 'mission.t', victory: [{ type: 'eliminate' }] } } } as unknown as DataBundle
const base = (forced = false): GameState => {
  registerBundle(bundle)
  const s = mkState([mkUnit('A1', 'A'), mkUnit('B1', 'B')])
  return { ...s, phase: 'end', turn: 4, setup: { missionId: 'mission.t', forcedWithdrawal: forced, turnLimit: null } } as unknown as GameState
}
const set = (s: GameState, id: string, patch: object): GameState => ({ ...s, units: { ...s.units, [id]: { ...s.units[id]!, ...patch } } })

describe('End Phase (INIT-015)', () => {
  it('INIT-015 a pilot knocked out earlier recovers on 2d6 at the TN; twists reset to feet facing', () => {
    let s = base()
    s = set(s, 'A1', { pilot: { ...s.units.A1!.pilot, hits: 2, conscious: false, koTurn: 3 }, attacks: { ...s.units.A1!.attacks, twist: 1, flipped: true } })
    FORCED.push([2, 3]) // TN 5 for 2 hits: 5 passes
    const r = runEndPhaseA(s)
    expect(r.state.units.A1!.pilot.conscious).toBe(true)
    expect(r.state.units.A1!.attacks).toMatchObject({ twist: 0, flipped: false })
    expect(r.events.map((e) => e.type)).toEqual(['DiceRolled', 'PilotRecovered', 'TwistReset'])
  })

  it('INIT-015 a pilot knocked out this very turn does not roll until the next End Phase', () => {
    let s = base()
    s = set(s, 'A1', { pilot: { ...s.units.A1!.pilot, hits: 2, conscious: false, koTurn: 4 } })
    expect(runEndPhaseA(s).events).toEqual([])
  })

  it('HEAT-041 a voluntarily shut down unit is offered a restart in a later End Phase and restarts after an avoid roll', () => {
    let s = base()
    s = set(s, 'A1', { shutdown: { cause: 'voluntary', turn: 3 }, heat: 14 })
    expect(powerQueries(s)).toEqual([{ player: 'A', power: [{ unitId: 'A1', options: ['stay', 'restart'], avoidTn: 4 }] }])
    FORCED.push([2, 2]) // 4 >= 4
    const r = applyPowerChoice(s, [{ unitId: 'A1', to: 'restart' }])
    expect(r.state.units.A1!.shutdown).toBeNull()
    expect(r.events.at(-1)).toMatchObject({ type: 'UnitRestarted', auto: false })
    const same = set(s, 'A1', { shutdown: { cause: 'voluntary', turn: 4 } })
    expect(powerQueries(same)).toEqual([])
  })

  it('SCN-031 a withdrawing unit that is immobile surrenders; a crippled one that is not withdrawing never does', () => {
    let s = base(true)
    s = set(s, 'A1', { status: 'withdrawing', pilot: { ...s.units.A1!.pilot, conscious: false } })
    s = set(s, 'B1', { crippled: true })
    const r = surrenderCheck(s)
    expect(r.state.units.A1).toMatchObject({ status: 'surrendered', pos: null, destroyedCause: 'surrendered' })
    expect(r.state.units.B1!.status).toBe('active')
    expect(r.events.map((e) => e.type)).toEqual(['StatusChanged', 'UnitRemoved'])
    expect(surrenderCheck(base(false)).events).toEqual([])
  })

  it('INIT-015 cleanup advances the turn and resets per-turn records; victory ends the game before the advance', () => {
    const s = base()
    const r = runEndPhaseB(s)
    expect(r.result).toBeNull()
    expect(r.state).toMatchObject({ turn: 5, phase: 'initiative', step: 'initiative.roll' })
    expect(r.state.units.A1!.move.mode).toBeNull()
    const done = runEndPhaseB(set(s, 'B1', { status: 'destroyed' }))
    expect(done.result).toMatchObject({ winner: 'A' })
    expect(done.state.phase).toBe('ended')
    expect(done.state.turn).toBe(4)
  })

  it('INIT-015 a booked (doomed) unit is removed in the End Phase before the victory check', () => {
    const r = runEndPhaseB(set(base(), 'B1', { doomed: 'ctDestroyed' }))
    expect(r.state.units.B1).toMatchObject({ status: 'destroyed', destroyedCause: 'ctDestroyed' })
    expect(r.result?.winner).toBe('A')
  })
})
