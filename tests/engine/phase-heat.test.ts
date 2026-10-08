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
import { runHeatPhase } from '../../src/engine/phases/heat'
import type { DataBundle, GameState, HeatEntry } from '../../src/engine/types'

afterEach(() => { expect(FORCED).toHaveLength(0); FORCED.length = 0 })
const bundle = { ...BUNDLE, mechs: { 'mech.test': { id: 'mech.test', bv: 1000 } }, missions: { 'mission.t': { id: 'mission.t', victory: [{ type: 'eliminate' }] } } } as unknown as DataBundle
const ledger = (n: number): HeatEntry[] => [{ source: 'weapon', amount: n, ref: null, phase: 'rangedAttack' }]
function game(a: object = {}, over: object = {}): GameState {
  registerBundle(bundle)
  const s = mkState([mkUnit('A1', 'A', { bins: [{ id: 'bin', ammo: 'a.ac5', location: 'LT', shots: 10 }] }), mkUnit('B1', 'B')])
  const units = { A1: { ...s.units.A1!, ...a }, B1: s.units.B1! }
  return { ...s, board: { hexes: {}, cols: 4, rows: 4 }, units, phase: 'heat', step: 'heat.apply', turn: 3, setup: { missionId: 'mission.t', forcedWithdrawal: false, turnLimit: null }, initiative: { winner: 'A', loser: 'B', totals: { A: 8, B: 6 }, rerolls: 0 }, ...over } as unknown as GameState
}

describe('Heat Phase (HEAT-030)', () => {
  it('HEAT-030 units resolve loser first, heat is applied from the ledger and the ledger is cleared', () => {
    const r = runHeatPhase(game({}, { heatLedger: { A1: ledger(12), B1: ledger(8) } }))
    const applied = r.events.filter((e) => e.type === 'HeatApplied')
    expect(applied.map((e) => (e as { unitId: string }).unitId)).toEqual(['B1', 'A1']) // B lost initiative
    expect(r.state.units.A1!.heat).toBe(2) // 12 generated - 10 single sinks
    expect(r.state.units.B1!.heat).toBe(0)
    expect(r.state.heatLedger).toEqual({ A1: [], B1: [] })
  })

  it('HEAT-031 heat 19 rolls one shutdown check at TN 6 and one ammo check at TN 4', () => {
    FORCED.push([2, 3], [3, 3]) // shutdown 5 < 6 (down), ammo 6 >= 4 (safe)
    const r = runHeatPhase(game({ heat: 17 }, { heatLedger: { A1: ledger(12) } })) // 17 + 12 - 10 = 19
    expect(r.state.units.A1!.shutdown).toMatchObject({ cause: 'heat', turn: 3 })
    const rolls = r.events.filter((e) => e.type === 'DiceRolled') as unknown as { purpose: string; target: number }[]
    expect(rolls.map((x) => [x.purpose, x.target])).toEqual([['shutdownAvoid', 6], ['ammoExplosionAvoid', 4]])
  })

  it('HEAT-034 a failed ammo check explodes a bin through the damage pipeline, even while shut down', () => {
    FORCED.push([1, 2]) // ammo TN 8 at heat 29: 3 fails
    const r = runHeatPhase(game({ heat: 29, shutdown: { cause: 'heat', turn: 3 } }, { heatLedger: { A1: ledger(10) } })) // 29 + 10 - 10
    expect(r.events.some((e) => e.type === 'AmmoExploded' && (e as unknown as { cause: string }).cause === 'heat')).toBe(true)
    expect(r.state.units.A1!.bins.bin!.exploded).toBe(true)
  })

  it('HEAT-040 a unit shut down last turn restarts automatically below heat 14 and not in its own shutdown turn', () => {
    const r = runHeatPhase(game({ heat: 14, shutdown: { cause: 'heat', turn: 2 } }, { heatLedger: {} }))
    expect(r.state.units.A1!.heat).toBe(4)
    expect(r.state.units.A1!.shutdown).toBeNull()
    expect(r.events.find((e) => e.type === 'UnitRestarted')).toMatchObject({ auto: true })
    const same = runHeatPhase(game({ heat: 14, shutdown: { cause: 'heat', turn: 3 } }))
    expect(same.state.units.A1!.shutdown).not.toBeNull()
  })

  it('HEAT-023 heat 30 shuts down with no avoid roll (only the ammo check rolls)', () => {
    FORCED.push([6, 6])
    const r = runHeatPhase(game({ heat: 28 }, { heatLedger: { A1: ledger(12) } })) // 28 + 12 - 10 = 30
    expect(r.state.units.A1!.shutdown).not.toBeNull()
    expect(r.events.filter((e) => e.type === 'DiceRolled').map((e) => (e as unknown as { purpose: string }).purpose)).toEqual(['ammoExplosionAvoid'])
  })
})
