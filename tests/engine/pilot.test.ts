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

import { addPilotHit, consciousnessChecks, consciousnessTn, recoverPilots } from '../../src/engine/pilot'
import type { GameState } from '../../src/engine/types'

function mkState(over: Partial<{ hits: number; conscious: boolean; koTurn: number | null; turn: number }> = {}): GameState {
  const pilot = { pilotId: null, name: 'P', gunnery: 4, piloting: 5, hits: over.hits ?? 0, conscious: over.conscious ?? true, dead: false, koTurn: over.koTurn ?? null, spas: [] }
  const unit = { id: 'A1', owner: 'A', status: 'active', pilot, doomed: null, crippled: false }
  return {
    rng: [1, 2, 3, 4], rollSeq: 0, turn: over.turn ?? 1, damageWindow: 'immediate', initiative: null, unitOrder: ['A1'],
    units: { A1: unit }, ledger: { pilotHit: [] },
  } as unknown as GameState
}
afterEach(() => { expect(FORCED).toHaveLength(0); FORCED.length = 0 })

describe('pilot (10 section 15)', () => {
  it('PILOT-001 hits accumulate and owe one consciousness check', () => {
    const r = addPilotHit(mkState(), 'A1', 'explosion')
    expect(r.state.units.A1!.pilot.hits).toBe(1)
    expect(r.state.ledger.pilotHit).toEqual(['A1'])
    const r2 = addPilotHit(r.state, 'A1', 'head')
    expect(r2.state.ledger.pilotHit).toEqual(['A1'])
  })

  it('PILOT-002 sixth hit kills the pilot and destroys the unit (immediate window)', () => {
    const r = addPilotHit(mkState({ hits: 5 }), 'A1', 'head')
    const u = r.state.units.A1!
    expect(u.pilot.dead).toBe(true)
    expect(u.status).toBe('destroyed')
    expect(r.events.map((e) => e.type)).toEqual(['PilotHit', 'PilotKilled', 'UnitDestroyed', 'StatusChanged'])
  })

  it('PILOT-002 inside a simultaneous window the kill is booked as doomed', () => {
    const s = { ...mkState({ hits: 5 }), damageWindow: 'simultaneous' } as GameState
    const r = addPilotHit(s, 'A1', 'head')
    expect(r.state.units.A1!.doomed).toBe('pilotKilled')
    expect(r.state.units.A1!.status).toBe('active')
  })

  it('PILOT-010 consciousness TN by total hits, one roll for several hits', () => {
    expect([1, 2, 3, 4, 5].map(consciousnessTn)).toEqual([3, 5, 7, 10, 11])
    FORCED.push([5, 5]) // 10 < 11 -> out (pilot at 3 hits takes 2 -> 5 total)
    let s = addPilotHit(mkState({ hits: 3 }), 'A1', 'explosion', 2).state
    expect(s.units.A1!.pilot.hits).toBe(5)
    const r = consciousnessChecks(s)
    s = r.state
    const check = r.events.find((e) => e.type === 'ConsciousnessChecked')!
    expect(check).toMatchObject({ tn: 11, roll: 10, conscious: false })
    expect(s.units.A1!.pilot.conscious).toBe(false)
    expect(s.units.A1!.pilot.koTurn).toBe(1)
    expect(s.ledger.pilotHit).toEqual([])
  })

  it('PILOT-020 recovery starts the turn after knockout and wakes on 2d6 >= TN', () => {
    const asleepT1 = mkState({ hits: 2, conscious: false, koTurn: 1, turn: 1 })
    expect(recoverPilots(asleepT1).events).toEqual([]) // same turn: no roll
    FORCED.push([2, 2], [3, 3])
    let r = recoverPilots({ ...asleepT1, turn: 2 } as GameState) // 4 < 5
    expect(r.state.units.A1!.pilot.conscious).toBe(false)
    r = recoverPilots(r.state) // 6 >= 5
    expect(r.state.units.A1!.pilot.conscious).toBe(true)
    expect(r.state.units.A1!.pilot.koTurn).toBeNull()
  })
})
