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

import {
  addHeat, ammoAvoidTn, dissipation, heatDeps, heatEffects, heatMpLoss, heatPhaseUnit, heatToHitMod, movementHeat, shutdownAvoidTn,
} from '../../src/engine/heat'
import type { GameState, UnitState } from '../../src/engine/types'

const slots = () => ({ HD: [], CT: [], LT: [], RT: [], LA: [], RA: [], LL: [], RL: [] })
const loc = (destroyed = false) => ({ armor: 10, rear: null, structure: 5, maxArmor: 10, maxRear: null, maxStructure: 5, destroyed, destroyedCause: null })
function mkState(u: Record<string, unknown> = {}, turn = 3, depth = 0): GameState {
  const unit = {
    id: 'A1', owner: 'A', status: 'active', tonnage: 50, heat: 0, shutdown: null, prone: false, doomed: null, pos: { q: 0, r: 0 },
    sinks: { count: 10, type: 'single' }, mounts: {}, bins: {}, slots: slots(), crippled: false,
    locs: { HD: loc(), CT: loc(), LT: loc(), RT: loc(), LA: loc(), RA: loc(), LL: loc(), RL: loc() },
    pilot: { pilotId: null, name: 'P', gunnery: 4, piloting: 5, hits: 0, conscious: true, dead: false, koTurn: null, spas: [] },
    move: { mode: null }, ...u,
  } as unknown as UnitState
  return {
    rng: [1, 2, 3, 4], rollSeq: 0, turn, phase: 'heat', damageWindow: 'immediate', initiative: null, unitOrder: ['A1'], units: { A1: unit },
    heatLedger: {}, ledger: { pilotHit: [] }, board: { hexes: { '0101': { hex: { q: 0, r: 0 }, depth } } },
  } as unknown as GameState
}
const withLedger = (s: GameState, amount: number): GameState => addHeat(s, 'A1', { source: 'weapon', amount }).state
afterEach(() => { expect(FORCED).toHaveLength(0); FORCED.length = 0 })

describe('heat ledger (10 section 13)', () => {
  it('HEAT-001 movement, weapons and engine crits all land in the ledger; stand attempts add none', () => {
    expect([movementHeat('run'), movementHeat('walk'), movementHeat('jump', 2), movementHeat('jump', 5), movementHeat('standStill')]).toEqual([2, 1, 3, 5, 0])
    let s = addHeat(mkState(), 'A1', { source: 'movement', amount: 2 }).state
    s = addHeat(s, 'A1', { source: 'weapon', amount: 20, ref: 'ppc1' }).state
    const r = addHeat(s, 'A1', { source: 'engine', amount: 5 })
    expect(r.state.heatLedger.A1!.reduce((a, e) => a + e.amount, 0)).toBe(27)
    expect(r.events[0]).toMatchObject({ type: 'HeatAdded', turnTotal: 27 })
    expect(addHeat(s, 'A1', { source: 'movement', amount: 0 }).events).toEqual([])
  })

  it('HEAT-010 sink dissipation: 10 double = 20, 12 single = 12', () => {
    const d = mkState({ sinks: { count: 10, type: 'double' } })
    expect(dissipation(d, d.units.A1!)).toBe(20)
    const s = mkState({ sinks: { count: 12, type: 'single' } })
    expect(dissipation(s, s.units.A1!)).toBe(12)
  })

  it('HEAT-011 a mounted sink in a destroyed location does not dissipate', () => {
    const mounts = { s1: { id: 's1', item: 'is.eq.heat-sink', location: 'LT', destroyed: false }, s2: { id: 's2', item: 'is.eq.heat-sink', location: 'RT', destroyed: false } }
    const s = mkState({ sinks: { count: 12, type: 'single' }, mounts })
    expect(dissipation(s, s.units.A1!)).toBe(12)
    const s2 = mkState({ sinks: { count: 12, type: 'single' }, mounts, locs: { ...s.units.A1!.locs, LT: loc(true) } })
    expect(dissipation(s2, s2.units.A1!)).toBe(11)
  })

  it('HEAT-012 water: standing depth 1 gives leg sinks +1 each, submerged caps at +6', () => {
    const mk = (id: string, location: string) => [id, { id, item: 'is.eq.heat-sink', location, destroyed: false }] as const
    const mounts = Object.fromEntries([mk('a', 'LL'), mk('b', 'RL'), mk('c', 'LT')])
    const sinks = { count: 13, type: 'single' }
    const d1 = mkState({ sinks, mounts }, 3, 1)
    expect(dissipation(d1, d1.units.A1!)).toBe(13 + 2)
    const d2 = mkState({ sinks, mounts }, 3, 2)
    expect(dissipation(d2, d2.units.A1!)).toBe(13 + 6)
  })

  it('HEAT-013 heat 28 + 15 - 10 = 33 is stored; effects use 30 (automatic shutdown, no roll)', () => {
    const r = heatPhaseUnit(withLedger(mkState({ heat: 28 }), 15), 'A1')
    expect(r.state.units.A1!.heat).toBe(33)
    expect(heatEffects(r.state.units.A1!).autoShutdown).toBe(true)
    expect(r.state.units.A1!.shutdown).toMatchObject({ cause: 'heat' })
    expect(r.events.some((e) => e.type === 'DiceRolled')).toBe(false)
  })
})

describe('heat scale (10 section 13.2)', () => {
  it('HEAT-020 MP loss steps', () => {
    expect([4, 5, 9, 10, 14, 15, 25, 30].map(heatMpLoss)).toEqual([0, 1, 1, 2, 2, 3, 5, 5])
  })
  it('HEAT-021 to-hit steps', () => {
    expect([7, 8, 12, 13, 17, 24].map(heatToHitMod)).toEqual([0, 1, 1, 2, 3, 4])
  })
  it('HEAT-022 shutdown avoid TNs', () => {
    expect([13, 14, 17, 18, 22, 26].map(shutdownAvoidTn)).toEqual([null, 4, 4, 6, 8, 10])
  })
  it('HEAT-024 ammo avoid TNs', () => {
    expect([18, 19, 23, 28].map(ammoAvoidTn)).toEqual([null, 4, 6, 8])
  })
})

describe('heat phase order (10 section 13.3)', () => {
  it('HEAT-031 heat 19 rolls once at TN 6; failure shuts down', () => {
    FORCED.push([2, 3]) // 5 < 6; no bins so no ammo roll
    const r = heatPhaseUnit(withLedger(mkState({ heat: 19 }), 10), 'A1') // 19 + 10 - 10
    const dice = r.events.filter((e) => e.type === 'DiceRolled')
    expect(dice).toHaveLength(1)
    expect(dice[0]).toMatchObject({ purpose: 'shutdownAvoid', target: 6, success: false })
    expect(r.state.units.A1!.shutdown).toEqual({ cause: 'heat', turn: 3 })
  })

  it('HEAT-031 unconscious pilot at heat 14 shuts down without a roll', () => {
    const base = mkState({ heat: 14 })
    const s = withLedger({ ...base, units: { A1: { ...base.units.A1!, pilot: { ...base.units.A1!.pilot, conscious: false } } } } as GameState, 10)
    const r = heatPhaseUnit(s, 'A1')
    expect(r.events.some((e) => e.type === 'DiceRolled')).toBe(false)
    expect(r.state.units.A1!.shutdown).not.toBeNull()
  })

  it('HEAT-034 heat 23 with ammo: one roll at TN 6, also while shut down; failure explodes a bin', () => {
    const bins = { b1: { id: 'b1', ammo: 'x', location: 'CT', shots: 10, capacity: 10, exploded: false } }
    const s = withLedger(mkState({ heat: 23, bins, shutdown: { cause: 'heat', turn: 3 } }), 10)
    const exploded: string[] = []
    const orig = heatDeps.explodeAmmo
    heatDeps.explodeAmmo = (st, _u, bin) => { exploded.push(bin); return { state: st, events: [] } }
    FORCED.push([1, 2]) // 3 < 6
    try { heatPhaseUnit(s, 'A1') } finally { heatDeps.explodeAmmo = orig }
    expect(exploded).toEqual(['b1'])
  })

  it('HEAT-040 restart: same turn none; next turn heat < 14 auto; heat 20 rolls TN 6; heat 30 none', () => {
    const down = { cause: 'heat' as const, turn: 3 }
    expect(heatPhaseUnit(mkState({ heat: 10, shutdown: down }, 3), 'A1').state.units.A1!.shutdown).not.toBeNull()
    const auto = heatPhaseUnit(withLedger(mkState({ heat: 10, shutdown: down }, 4), 10), 'A1')
    expect(auto.state.units.A1!.shutdown).toBeNull()
    FORCED.push([3, 3]) // heat 20 -> TN 6, rolled 6
    const roll20 = heatPhaseUnit(withLedger(mkState({ heat: 20, shutdown: down }, 4), 10), 'A1')
    expect(roll20.state.units.A1!.shutdown).toBeNull()
    const stuck = heatPhaseUnit(withLedger(mkState({ heat: 30, shutdown: down }, 4), 10), 'A1')
    expect(stuck.state.units.A1!.shutdown).not.toBeNull()
  })

  it('HEAT-040 an unconscious pilot gets no restart roll at heat 14-29, but restarts automatically below 14', () => {
    const down = { cause: 'heat' as const, turn: 3 }
    const ko = { pilotId: null, name: 'P', gunnery: 4, piloting: 5, hits: 3, conscious: false, dead: false, koTurn: 3, spas: [] }
    const stuck = heatPhaseUnit(withLedger(mkState({ heat: 20, shutdown: down, pilot: ko }, 4), 10), 'A1')
    expect(stuck.state.units.A1!.shutdown).not.toBeNull()
    const auto = heatPhaseUnit(withLedger(mkState({ heat: 10, shutdown: down, pilot: ko }, 4), 10), 'A1')
    expect(auto.state.units.A1!.shutdown).toBeNull()
  })

  it('HEAT-010 partial wing adds 3 dissipation, less per lost mount', () => {
    const m = (loc: string, destroyed = false) => ({ item: 'is.eq.partial-wing', location: loc, destroyed })
    const mounts = { w1: m('LT'), w2: m('RT') }
    expect(dissipation(mkState({ mounts }), mkState({ mounts }).units.A1!)).toBe(13)
    const one = { w1: m('LT', true), w2: m('RT') }
    expect(dissipation(mkState({ mounts: one }), mkState({ mounts: one }).units.A1!)).toBe(11)
  })

  it('HEAT-025 life support crit: heat 20+ gives 2 pilot hits, 10-19 gives 1', () => {
    const ls = { ...slots(), HD: [{ token: 'lifeSupport', hit: true, hitPhase: 1 }] }
    FORCED.push([6, 6]) // heat 20 -> shutdown avoid TN 6 passes
    const r = heatPhaseUnit(withLedger(mkState({ heat: 20, slots: ls }), 10), 'A1')
    expect(r.state.units.A1!.pilot.hits).toBe(2)
    const r2 = heatPhaseUnit(withLedger(mkState({ heat: 10, slots: ls }), 10), 'A1')
    expect(r2.state.units.A1!.pilot.hits).toBe(1)
  })
})
