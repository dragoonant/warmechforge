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
afterEach(() => { FORCED.length = 0 })

import {
  eligibleUnits, finishPhase, finishSelection, pairCounts, planSequence, rollInitiative, selectUnit, startSelection,
} from '../../src/engine/initiative'
import { startInitiativePhase } from '../../src/engine/phases/initiative'
import type { GameEvent } from '../../src/engine/events'
import type { GameState, PlayerId } from '../../src/engine/types'
import { mkUnit, mkState, world, withUnit } from './phys.fixture'

const ofType = <T extends GameEvent['type']>(evs: GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  evs.filter((e) => e.type === t) as Extract<GameEvent, { type: T }>[]

/** Plays a whole alternation, one selection at a time, and returns the sides in order (L = loser, W = winner). */
function playOrder(state: GameState, phase: 'movement' | 'rangedAttack' | 'physicalAttack'): string {
  let s = startSelection(state, phase).state
  let out = ''
  while (s.selection) {
    const side: PlayerId = s.selection.turnOf
    const id = eligibleUnits(s, phase, side).find((u) => !s.selection!.acted.includes(u))!
    const r = selectUnit(s, id)
    expect(r.rejection).toBeUndefined()
    out += side === s.initiative!.loser ? 'L' : 'W'
    s = finishSelection(r.state).state
  }
  return out
}
const army = (a: number, b: number): GameState => {
  const specs: Parameters<typeof world>[0] = []
  for (let i = 1; i <= a; i++) specs.push([`A${i}`, 'A', i % 8, 0, 0])
  for (let i = 1; i <= b; i++) specs.push([`B${i}`, 'B', i % 8, 7, 0])
  return world(specs, undefined)
}

describe('initiative and selection order (10 §2)', () => {
  it('INIT-002 higher total wins and the loser moves first; a tie re-rolls both, always A then B', () => {
    FORCED.push([3, 3], [4, 4])
    const r = rollInitiative(mkState([mkUnit('A1', 'A'), mkUnit('B1', 'B')]))
    expect(r.state.initiative).toMatchObject({ winner: 'B', loser: 'A', rerolls: 0, totals: { A: 6, B: 8 } })
    expect(ofType(r.events, 'DiceRolled').map((e) => e.reason)).toEqual(['A', 'B'])

    FORCED.push([3, 4], [2, 5], [6, 5], [1, 2])
    const t = rollInitiative(mkState([mkUnit('A1', 'A'), mkUnit('B1', 'B')]))
    expect(t.state.initiative).toMatchObject({ winner: 'A', loser: 'B', rerolls: 1 })
    expect(ofType(t.events, 'DiceRolled').map((e) => e.reason)).toEqual(['A', 'B', 'A', 'B'])
    expect(ofType(t.events, 'InitiativeResolved')).toHaveLength(1)
  })

  it('INIT-005 / INIT-006 unequal sides are front-loaded in pairs', () => {
    expect(pairCounts(1, 2)).toEqual({ L: 1, W: 2 }) // loser 1 vs winner 2: L WW
    expect(pairCounts(2, 1)).toEqual({ L: 2, W: 1 }) // loser 2 vs winner 1: LL W
    expect(planSequence(2, 0)).toBe('LL') // winner has none left: one at a time
    expect(planSequence(3, 4)).toBe('LWWLWLW')
    expect(planSequence(4, 2)).toBe('LLWLLW')
    expect(planSequence(2, 2)).toBe('LWLW')
    // 10 v 18: winner selects 2 per pair in pairs 1-8, then 1 and 1
    const seq = planSequence(10, 18)
    expect(seq).toBe('LWW'.repeat(8) + 'LW'.repeat(2))
  })

  it('INIT-003 2 v 2 with a as the loser: Movement, Ranged and Physical order is a, b, a, b', () => {
    const s = army(2, 2) // loser A
    for (const p of ['movement', 'rangedAttack', 'physicalAttack'] as const) expect(playOrder(s, p)).toBe('LWLW')
  })

  it('INIT-006 the engine plays the 3 v 4 and 4 v 2 sequences through selectUnit', () => {
    expect(playOrder(army(3, 4), 'rangedAttack')).toBe('LWWLWLW')
    expect(playOrder(army(4, 2), 'physicalAttack')).toBe('LLWLLW')
  })

  it('INIT-004 shut down units skip Movement, unconscious pilots skip Ranged and Physical, destroyed units never count', () => {
    let s = army(2, 2)
    s = withUnit(s, 'A1', { shutdown: { cause: 'heat', turn: 1 } })
    s = withUnit(s, 'B1', { pilot: { ...s.units.B1!.pilot, conscious: false } })
    s = withUnit(s, 'B2', { status: 'destroyed' })
    expect(eligibleUnits(s, 'movement')).toEqual(['A2'])
    expect(eligibleUnits(s, 'rangedAttack')).toEqual(['A2'])
    expect(eligibleUnits(s, 'physicalAttack')).toEqual(['A2'])
  })

  it('INIT-007 a unit must finish before the next selection opens', () => {
    const s = startSelection(army(1, 2), 'movement').state
    const first = selectUnit(s, 'A1')
    expect(first.rejection).toBeUndefined()
    // still A's unit open: the winner may not select yet
    expect(selectUnit(first.state, 'B1').rejection?.code).toBeDefined()
    const next = finishSelection(first.state).state
    expect(next.selection?.turnOf).toBe('B')
    expect(next.selection?.leftInGroup).toBe(2)
  })

  it('INIT-001 / INIT-016 a new turn resets move and attack records and starts the Initiative Phase', () => {
    FORCED.push([2, 2], [5, 5])
    let s = army(1, 1)
    s = withUnit(s, 'A1', { attacks: { ...s.units.A1!.attacks, rangedDeclared: true, twist: 1 } })
    const r = startInitiativePhase({ ...s, turn: 3 })
    expect(r.state.turn).toBe(4)
    expect(r.state.phase).toBe('initiative')
    expect(r.state.units.A1!.attacks.rangedDeclared).toBe(false)
    expect(r.state.units.A1!.attacks.twist).toBe(0)
    expect(r.events.map((e) => e.type).slice(0, 2)).toEqual(['TurnStarted', 'PhaseStarted'])
    expect(r.state.initiative?.winner).toBe('B')
  })

  it('INIT-013 end of phase: removal, then pilot checks, then the PSR queue, then checks for pilots hit by falls', () => {
    FORCED.push([6, 6], [6, 6], [1, 1]) // consciousness ok, PSR ok, (no second check needed)
    let s = army(1, 1)
    s = withUnit(s, 'A1', { pilot: { ...s.units.A1!.pilot, hits: 1 } })
    s = {
      ...s, damageWindow: 'simultaneous', ledger: { ...s.ledger, pilotHit: ['A1'] },
      psr: { queue: [{ id: 'p:1', unitId: 'A1', reason: 'damage20', mod: 1, auto: false, when: 'endOfPhase', phase: 'rangedAttack' }], history: {} },
    }
    s = withUnit(s, 'B1', { doomed: 'ctDestroyed' })
    const r = finishPhase(s)
    const types = r.events.map((e) => e.type)
    expect(types.indexOf('UnitDestroyed')).toBeLessThan(types.indexOf('ConsciousnessChecked'))
    expect(types.indexOf('ConsciousnessChecked')).toBeLessThan(types.indexOf('PsrResolved'))
    expect(types.at(-1)).toBe('PhaseEnded')
    expect(r.state.units.B1!.status).toBe('destroyed')
    expect(r.state.damageWindow).toBe('immediate')
  })
})
