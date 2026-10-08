// Regression: a 'Mech that falls while passing through a friend's hex ends up sharing it (MOVE-012, AGoAC Stacking).
// Its follow-up move decision must never be empty, and the stacking break is resolved when its move ends.
import { afterEach, describe, expect, it, vi } from 'vitest'

const FORCED = vi.hoisted(() => [] as number[][])
vi.mock('../../src/engine/rng', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/rng')>()
  return {
    ...real,
    roll(state: import('../../src/engine/types').GameState, spec: import('../../src/engine/rng').RollSpec) {
      const f = spec.purpose === 'psr' ? FORCED.shift() : undefined
      if (!f) return real.roll(state, spec)
      return { state: { ...state, rollSeq: state.rollSeq + 1 }, event: real.diceEvent(state, spec, f) }
    },
  }
})

import type { MoveAction, StandUpAction } from '../../src/engine/actions'
import { hexEq, neighbors } from '../../src/engine/hex'
import { executeMove, executeStandUp, reachable, unitAt, validateMove } from '../../src/engine/movement'
import { legalMovementActions } from '../../src/engine/phases/movement'
import { fallDeps } from '../../src/engine/psr'
import type { BoardHex, GameState } from '../../src/engine/types'
import { H, mkState, mkUnit } from './move.fixture'

afterEach(() => { expect(FORCED).toHaveLength(0); FORCED.length = 0 })
fallDeps.applyDamage = (state) => ({ state, events: [] })

type Ok = { state: GameState; events: import('../../src/engine/events').GameEvent[]; next: 'move' | 'standUp' | 'done' }
const ok = (r: ReturnType<typeof executeMove> | ReturnType<typeof executeStandUp>): Ok => {
  if ('rejection' in r) throw new Error(`rejected: ${r.rejection.code} ${r.rejection.message}`)
  return r
}
const START = H(4, 6) // 0507
const FRIEND = { q: START.q, r: START.r - 1 } // 0506, straight ahead
/** Every hex light woods (2 MP to enter) except the friend's hex, which is rubble (entering it needs a PSR). */
function board(): Record<string, Partial<BoardHex>> {
  const over: Record<string, Partial<BoardHex>> = {}
  for (let c = 1; c <= 9; c++) for (let r = 1; r <= 9; r++) over[String(c).padStart(2, '0') + String(r).padStart(2, '0')] = { woods: 'light' }
  over['0506'] = { rubble: true }
  return over
}
const walkInto = (s: GameState): MoveAction => ({
  type: 'move', decisionId: s.pending.id, player: 'A', unitId: 'A1', mode: 'walk', facing: 0, steps: [{ op: 'forward' }, { op: 'forward' }],
}) as MoveAction
const standAct = (s: GameState): StandUpAction => ({ type: 'standUp', decisionId: s.pending.id, player: 'A', unitId: 'A1', attempt: true, mode: 'walk', facing: 0 })
/** Open the follow-up decision the phase machine would raise, so legalMovementActions sees it. */
const pend = (s: GameState, kind: 'move' | 'standUp'): GameState => ({ ...s, pending: { ...s.pending, kind } })

describe('stacking after a fall in a friendly hex (MOVE-012)', () => {
  it('MOVE-012 a unit that fell into a friend\'s hex, stood with 1 MP left, still has a legal move; ending it shoves it out', () => {
    // walk 5: rubble hex costs 2, the stand 2, leaving 1 MP; every neighbour costs 2
    const s0 = mkState([mkUnit({ pos: START }), mkUnit({ id: 'A2', pos: FRIEND })], board())
    FORCED.push([1, 1]) // rubble PSR fails: falls in the friend's hex
    const fell = ok(executeMove(s0, walkInto(s0)))
    expect(fell.next).toBe('standUp')
    expect(fell.state.units.A1).toMatchObject({ prone: true, pos: FRIEND })
    FORCED.push([6, 6]) // stands up
    const stood = ok(executeStandUp(pend(fell.state, 'standUp'), standAct(fell.state)))
    expect(stood.next).toBe('move')
    expect(stood.state.units.A1).toMatchObject({ prone: false, pos: FRIEND })
    expect(stood.state.units.A1!.move.mpSpent).toBe(4)

    const s = pend(stood.state, 'move')
    const reach = reachable(s, 'A1')
    expect(reach.length).toBeGreaterThan(0)
    for (const e of reach) expect(validateMove(s, e.action), JSON.stringify(e.action)).toBeNull()
    const legal = legalMovementActions(s)
    expect(legal.length).toBeGreaterThan(0)
    // the stay-in-place answer keeps the locked mode and no hex change
    const stay = reach.find((e) => e.action.steps.length === 0)!
    expect(stay.action).toMatchObject({ mode: 'walk', facing: 0 })
    // stepping out costs 2 and only 1 is left: no entry leaves the hex
    expect(reach.every((e) => hexEq(e.hex, FRIEND))).toBe(true)

    const end = ok(executeMove(s, stay.action))
    expect(end.next).toBe('done')
    expect(end.state.units.A1!.move.done).toBe(true)
    const shove = end.events.find((e) => e.type === 'UnitDisplaced')
    expect(shove).toMatchObject({ unitId: 'A1', from: FRIEND, to: START }) // back toward where it started
    expect(unitAt(end.state, FRIEND, 'A2')).toBeNull()
    expect(end.state.units.A2!.pos).toEqual(FRIEND)
  })

  it('MOVE-012 a unit that falls in a friend\'s hex and cannot stand ends its move and is shoved out', () => {
    // walk 3: rubble 2 + a clear hex beyond 1 plans fine; after the fall 1 MP is left, too little to stand (mpSpent > 0)
    const s0 = mkState([mkUnit({ pos: START, baseMp: { walk: 3, run: 5, jump: 0 } }), mkUnit({ id: 'A2', pos: FRIEND })], { ...board(), '0505': {} })
    FORCED.push([1, 1])
    const fell = ok(executeMove(s0, walkInto(s0)))
    expect(fell.next).toBe('done')
    expect(fell.state.units.A1!.move.done).toBe(true)
    expect(fell.state.units.A1!.prone).toBe(true)
    expect(fell.events.find((e) => e.type === 'UnitDisplaced')).toMatchObject({ unitId: 'A1', from: FRIEND })
    expect(hexEq(fell.state.units.A1!.pos!, FRIEND)).toBe(false)
  })

  it('MOVE-012 entering a friend\'s hex on purpose and stopping there is still rejected', () => {
    const s = mkState([mkUnit({ pos: START }), mkUnit({ id: 'A2', pos: FRIEND })], board())
    const one: MoveAction = { ...walkInto(s), steps: [{ op: 'forward' }] }
    expect(validateMove(s, one)?.code).toBe('E_OCCUPIED')
  })

  it('MOVE-012 no shove target: the unit stays and may stay again (still never an empty reach set)', () => {
    // every neighbour of the friend's hex is held by another friend
    const around = neighbors(FRIEND)
    const ring = around.map((h, i) => mkUnit({ id: `A${i + 3}`, pos: h }))
    const me = mkUnit({ pos: FRIEND, prone: false })
    const s0 = mkState([me, mkUnit({ id: 'A2', pos: FRIEND }), ...ring], board())
    const s = { ...s0, units: { ...s0.units, A1: { ...s0.units.A1!, move: { ...s0.units.A1!.move, mode: 'walk' as const, mpSpent: 4, startHex: START } } } }
    const reach = reachable(s, 'A1')
    expect(reach.length).toBeGreaterThan(0)
    const end = ok(executeMove(s, reach.find((e) => e.action.steps.length === 0)!.action))
    expect(end.events.some((e) => e.type === 'UnitDisplaced')).toBe(false)
    expect(end.state.units.A1!.pos).toEqual(FRIEND)
  })
})
