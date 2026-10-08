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
import { clusterDistribution, clusterGroups, clusterHits, expectedClusterHits, rollCluster } from '../../src/engine/cluster'
import { BUNDLE, mkState } from './damage.fixture'

describe('cluster hits (10 §9)', () => {
  it('CLUS-002 table spot checks', () => {
    const pick: [number, number, number][] = [[20, 8, 12], [10, 11, 10], [6, 7, 4], [4, 6, 2], [2, 7, 1], [15, 2, 5], [5, 9, 4], [3, 4, 1], [8, 2, 2], [8, 8, 5], [8, 10, 7]]
    for (const [size, roll, hits] of pick) expect(clusterHits(size, roll), `size ${size} roll ${roll}`).toBe(hits)
  })

  it('CLUS-001 one 2d6 roll gives the number of missiles that hit', () => {
    const w = beginWork(mkState(), BUNDLE)
    q.faces.push(4, 4)
    const r = rollCluster(w, { attackId: 'a:1', attackerId: 'A1', targetId: 'B1', rackSize: 20, mod: 0, dmgPerHit: 1, perGroup: 5 })
    expect(r).toMatchObject({ hits: 12, groups: [5, 5, 2] })
    expect(w.ev.filter((e) => e.type === 'DiceRolled')).toHaveLength(1)
  })

  it('CLUS-003 grouping: LRM in fives with the leftover last; SRM one location per missile', () => {
    expect(clusterGroups(12, 1, 5)).toEqual([5, 5, 2])
    expect(clusterGroups(4, 2, 1)).toEqual([2, 2, 2, 2])
    expect(clusterGroups(0, 1, 5)).toEqual([])
  })

  it('CLUS-004 modifiers shift the roll and the lookup clamps to 2..12', () => {
    expect(clusterHits(10, 13)).toBe(clusterHits(10, 12))
    expect(clusterHits(10, 1)).toBe(clusterHits(10, 2))
    const w = beginWork(mkState(), BUNDLE)
    q.faces.push(6, 6)
    const r = rollCluster(w, { attackId: null, attackerId: 'A1', rackSize: 10, mod: 2, dmgPerHit: 1, perGroup: 1 })
    expect(r.modified).toBe(12) // 12 + 2 clamped
    q.faces.push(1, 1)
    expect(rollCluster(w, { attackId: null, attackerId: 'A1', rackSize: 10, mod: -1, dmgPerHit: 1, perGroup: 1 }).modified).toBe(2)
  })

  it('CLUS-005 Streak: every missile hits and no cluster roll is made', () => {
    const w = beginWork(mkState(), BUNDLE)
    const r = rollCluster(w, { attackId: 'a:1', attackerId: 'A1', rackSize: 4, mod: 0, dmgPerHit: 2, perGroup: 1, streak: true })
    expect(r.hits).toBe(4)
    expect(r.groups).toEqual([2, 2, 2, 2])
    expect(w.ev.some((e) => e.type === 'DiceRolled')).toBe(false)
  })

  it('CLUS-001 the closed-form distribution sums to 1 and its mean matches', () => {
    const d = clusterDistribution(10, 0)
    expect(d).toHaveLength(11)
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(expectedClusterHits(10, 0)).toBeCloseTo(d.reduce((a, p, k) => a + p * k, 0))
    expect(expectedClusterHits(10, 2)).toBeGreaterThan(expectedClusterHits(10, 0))
  })
})
