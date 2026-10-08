import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const q = vi.hoisted(() => ({ faces: [] as number[] }))
vi.mock('../../src/engine/rng', async (orig) => {
  const m = await orig<typeof import('../../src/engine/rng')>()
  return {
    ...m,
    roll: (state: { rollSeq: number }, spec: { count: number }) => {
      const n = Math.max(1, spec.count)
      const dice = q.faces.splice(0, n)
      if (dice.length < n) throw new Error('forced dice exhausted')
      return { state: { ...state, rollSeq: state.rollSeq + 1 }, event: m.diceEvent(state as never, spec as never, dice) }
    },
  }
})
beforeEach(() => { q.faces.length = 0 })
afterEach(() => { expect(q.faces).toEqual([]) })

import { beginWork } from '../../src/engine/dice'
import { hitLocationDistribution, locationFor, rollHitLocation } from '../../src/engine/hitloc'
import { splitGroups } from '../../src/engine/cluster'
import { BUNDLE, mkState } from './damage.fixture'

describe('hit location (10 §8)', () => {
  it('HITLOC-003 table spot checks per column', () => {
    const f = (r: number) => locationFor('standard', 'front', r)
    expect([2, 3, 5, 6, 8, 9, 10, 12].map(f)).toEqual(['CT', 'RA', 'RL', 'RT', 'LT', 'LL', 'LA', 'HD'])
    const l = (r: number) => locationFor('standard', 'left', r)
    expect([3, 4, 8, 9, 11].map(l)).toEqual(['LL', 'LA', 'CT', 'RT', 'RL'])
    const r = (n: number) => locationFor('standard', 'right', n)
    expect([3, 8, 9, 11].map(r)).toEqual(['RL', 'CT', 'LT', 'LL'])
  })

  it('HITLOC-001 a rear attack uses the front column and hits rear armor: 7 CT rear, 8 LT rear', () => {
    const w = beginWork(mkState(), BUNDLE)
    q.faces.push(3, 4, 4, 4)
    const a = rollHitLocation(w, { attackId: 'a:1', unitId: 'B1', table: 'standard', direction: 'rear', group: 1, damage: 5 })
    const b = rollHitLocation(w, { attackId: 'a:1', unitId: 'B1', table: 'standard', direction: 'rear', group: 2, damage: 5 })
    expect([a.location, a.side, b.location, b.side]).toEqual(['CT', 'rear', 'LT', 'rear'])
    expect(w.ev.filter((e) => e.type === 'HitLocated')).toHaveLength(2)
  })

  it('HITLOC-004 only a natural 2 on the standard table is a TAC', () => {
    const w = beginWork(mkState(), BUNDLE)
    q.faces.push(1, 1)
    expect(rollHitLocation(w, { attackId: null, unitId: 'B1', table: 'standard', direction: 'left', group: 1, damage: 3 })).toMatchObject({ location: 'LT', tac: true })
  })

  it('HITLOC-005 floating crits re-roll the TAC location on the same column', () => {
    const w = beginWork(mkState(), BUNDLE)
    q.faces.push(1, 1, 1, 1, 6, 4) // 2, then a 2 again, then 10 -> LA on the front column
    const r = rollHitLocation(w, { attackId: null, unitId: 'B1', table: 'standard', direction: 'front', group: 1, damage: 3, floatingCrits: true })
    expect(r).toMatchObject({ location: 'CT', tac: true, tacLocation: 'LA' })
  })

  it('HITLOC-006 punch table (2026 reversed) and HITLOC-007 kick table', () => {
    const p = (d: 'front' | 'left' | 'right', n: number) => locationFor('punch', d, n)
    expect([1, 2, 3, 4, 5, 6].map((n) => p('front', n))).toEqual(['RA', 'RT', 'CT', 'LT', 'LA', 'HD'])
    expect([p('left', 1), p('left', 3), p('left', 4)]).toEqual(['LA', 'CT', 'LT'])
    expect([p('right', 1), p('right', 3), p('right', 5)]).toEqual(['RA', 'CT', 'RT'])
    expect([1, 2, 3, 4, 5, 6].map((n) => locationFor('kick', 'front', n))).toEqual(['RL', 'RL', 'RL', 'LL', 'LL', 'LL'])
    expect(locationFor('kick', 'left', 4)).toBe('LL')
    expect(locationFor('kick', 'right', 2)).toBe('RL')
  })

  it('HITLOC-008 a punch on a prone unit rolls the 2d6 table', () => {
    const w = beginWork(mkState(), BUNDLE)
    q.faces.push(3, 4)
    const r = rollHitLocation(w, { attackId: null, unitId: 'B1', table: 'punch', direction: 'front', prone: true, group: 1, damage: 3 })
    expect(r).toMatchObject({ table: 'standard', location: 'CT' })
  })

  it('HITLOC-010 damage groups: 17 -> 5,5,5,2 and 9 -> 5,4 with the leftover last', () => {
    expect(splitGroups(17)).toEqual([5, 5, 5, 2])
    expect(splitGroups(9)).toEqual([5, 4])
  })

  it('HITLOC-003 the closed-form distribution sums to 1 and matches the table', () => {
    const d = hitLocationDistribution('front', 'standard')
    expect(Object.values(d.probs).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(d.probs.CT).toBeCloseTo(7 / 36) // 2 and 7
    expect(d.tac).toBe('CT')
    expect(d.pTac).toBeCloseTo(1 / 36)
    const k = hitLocationDistribution('right', 'kick')
    expect(k.probs.RL).toBeCloseTo(1)
    expect(Object.keys(k.probs)).toEqual(['RL'])
    expect(hitLocationDistribution('front', 'standard', { partialCover: true }).probs.LL).toBeUndefined()
  })
})
