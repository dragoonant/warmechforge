import { describe, expect, it } from 'vitest'
import { cyrb128, deriveSeed, deriveSeedString, diceEvent, nextU32, roll, rollDice, seedRng, WARM_UP_DRAWS } from '../../src/engine/rng'
import { p2d6AtLeast, stableStringify } from '../../src/engine/index'
import type { GameState } from '../../src/engine/types'

// roll() only reads rng and rollSeq, so a partial state is enough here.
const fakeState = (seed: string) => ({ rng: seedRng(seed), rollSeq: 0 }) as unknown as GameState

describe('rng (00 §12)', () => {
  it('HEX-001 cyrb128 is deterministic and seed-sensitive', () => {
    expect(cyrb128('alpha')).toEqual(cyrb128('alpha'))
    expect(cyrb128('alpha')).not.toEqual(cyrb128('alphb'))
    for (const n of cyrb128('alpha')) expect(n >>> 0).toBe(n)
  })

  it('HEX-001 seedRng applies exactly 15 warm-up draws', () => {
    let s = cyrb128('warm')
    for (let i = 0; i < WARM_UP_DRAWS; i++) s = nextU32(s)[1]
    expect(seedRng('warm')).toEqual(s)
    expect(WARM_UP_DRAWS).toBe(15)
  })

  it('HEX-001 dice are d6 faces and roughly uniform', () => {
    const [dice] = rollDice(seedRng('uniform'), 60000)
    const counts = [0, 0, 0, 0, 0, 0]
    for (const d of dice) { expect(d).toBeGreaterThanOrEqual(1); expect(d).toBeLessThanOrEqual(6); counts[d - 1]!++ }
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400)
  })

  it('HEX-001 roll advances rng and rollSeq and builds DiceRolled', () => {
    const s0 = fakeState('roll')
    const { state: s1, event } = roll(s0, { count: 2, sides: 6, purpose: 'toHit', target: 8, unitId: 'A1', targetId: 'B1' })
    expect(s1.rollSeq).toBe(1)
    expect(s1.rng).not.toEqual(s0.rng)
    expect(s0.rollSeq).toBe(0) // input untouched
    expect(event.rollId).toBe('r:1')
    expect(event.dice).toHaveLength(2)
    expect(event.total).toBe(event.dice[0]! + event.dice[1]!)
    expect(event.success).toBe(event.total >= 8)
    const again = roll(fakeState('roll'), { count: 2, sides: 6, purpose: 'toHit' })
    expect(again.event.dice).toEqual(event.dice)
    expect(again.event.success).toBeUndefined()
  })

  it('HEX-001 diceEvent adds flat to the total', () => {
    const e = diceEvent(fakeState('x'), { count: 2, sides: 6, purpose: 'cluster', flat: 2 }, [3, 4])
    expect(e.total).toBe(9)
    expect(e.kept).toEqual([3, 4])
  })

  it('deriveSeed never touches game state and is stable', () => {
    expect(deriveSeed('g', 'ai', 'A', 3)).toEqual(deriveSeed('g', 'ai', 'A', 3))
    expect(deriveSeed('g', 'ai', 'A', 3)).not.toEqual(deriveSeed('g', 'ai', 'B', 3))
    expect(deriveSeedString('s', 'sim', 0)).toMatch(/^[0-9a-f]{32}$/)
  })

  it('HEX-001 p2d6AtLeast matches the 2d6 table', () => {
    expect(p2d6AtLeast(2)).toBe(1)
    expect(p2d6AtLeast(7)).toBeCloseTo(21 / 36)
    expect(p2d6AtLeast(12)).toBeCloseTo(1 / 36)
    expect(p2d6AtLeast(13)).toBe(0)
  })

  it('stableStringify sorts keys', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}')
  })
})
