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

import { damageGroups, fallDamage, fallDeps, persistentMods, queuePsr, resolvePsrs, seatbeltTn } from '../../src/engine/psr'
import type { GameState, UnitState } from '../../src/engine/types'

const slots = () => ({ HD: [], CT: [], LT: [], RT: [], LA: [], RA: [], LL: [], RL: [] }) as Record<string, { token: string; hit: boolean; hitPhase: number | null }[]>
const loc = (destroyed = false) => ({ armor: 10, rear: null, structure: 5, maxArmor: 10, maxRear: null, maxStructure: 5, destroyed, destroyedCause: null })
const hit = (token: string) => ({ token, hit: true, hitPhase: 1 })
function mkUnit(over: Record<string, unknown> = {}): UnitState {
  return {
    id: 'A1', owner: 'A', status: 'active', tonnage: 85, heat: 0, shutdown: null, prone: false, doomed: null, pos: { q: 0, r: 0 }, facing: 0,
    sinks: { count: 10, type: 'single' }, mounts: {}, bins: {}, slots: slots(), crippled: false,
    locs: { HD: loc(), CT: loc(), LT: loc(), RT: loc(), LA: loc(), RA: loc(), LL: loc(), RL: loc() },
    pilot: { pilotId: null, name: 'P', gunnery: 4, piloting: 5, hits: 0, conscious: true, dead: false, koTurn: null, spas: [] },
    move: { mode: null, fell: false }, ...over,
  } as unknown as UnitState
}
function mkState(u: UnitState = mkUnit(), depth = 0): GameState {
  return {
    rng: [1, 2, 3, 4], rollSeq: 0, psrSeq: 0, turn: 1, phase: 'rangedAttack', damageWindow: 'immediate', initiative: null, unitOrder: ['A1'],
    units: { A1: u }, ledger: { pilotHit: [] }, psr: { queue: [], history: {} }, heatLedger: {},
    board: { hexes: { '0101': { hex: { q: 0, r: 0 }, depth } } },
  } as unknown as GameState
}
const q = (s: GameState, reason: Parameters<typeof queuePsr>[1]['reason'], mod: number, when: 'now' | 'endOfPhase' = 'endOfPhase', auto = false, levels?: number): GameState =>
  queuePsr(s, { unitId: 'A1', reason, mod, auto, when, ...(levels !== undefined ? { levels } : {}) }).state

const dmgCalls: { amount: number; location: string; side: string }[] = []
fallDeps.applyDamage = (state, i) => { dmgCalls.push({ amount: i.amount, location: i.location, side: i.side }); return { state, events: [] } }
afterEach(() => { expect(FORCED).toHaveLength(0); FORCED.length = 0; dmgCalls.length = 0 })

describe('PSR modifiers and TN (10 section 14)', () => {
  it('PSR-010..014 persistent mods: gyro +2, hip +1, leg actuators +1, foot 0, destroyed leg +5 replaces the leg', () => {
    const sl = slots()
    sl.CT = [hit('gyro')]
    sl.LL = [hit('hip'), hit('foot')]
    sl.RL = [hit('upperLeg'), hit('hip')]
    const u = mkUnit({ slots: sl })
    expect(persistentMods(u).reduce((a, m) => a + m.value, 0)).toBe(2 + 1 + 1 + 1)
    const dead = mkUnit({ slots: sl, locs: { ...mkUnit().locs, RL: loc(true) } })
    expect(persistentMods(dead).reduce((a, m) => a + m.value, 0)).toBe(2 + 1 + 5)
  })

  it('PSR-001 queued PSRs share the phase event mods: Piloting 5 + gyro 2 + damage 1 = TN 8, every roll', () => {
    const sl = slots(); sl.CT = [hit('gyro')]
    let s = mkState(mkUnit({ slots: sl }))
    s = q(s, 'damage20', 1)
    s = q(s, 'kicked', 0)
    FORCED.push([4, 4], [4, 4]) // 8 and 8, both pass
    const r = resolvePsrs(s, { when: ['endOfPhase'] })
    const rolls = r.events.filter((e) => e.type === 'DiceRolled')
    expect(rolls.map((e) => (e as { target: number }).target)).toEqual([8, 8])
    expect(r.state.psr.queue).toEqual([])
  })

  it('PSR-001 Movement-phase PSRs use only their own mod (stand is Piloting - 1 every time)', () => {
    let s = mkState()
    s = q(s, 'stand', -1, 'now')
    s = q(s, 'stand', -1, 'now')
    const first = s.psr.queue[0]!.id
    FORCED.push([1, 1], [1, 1])
    let r = resolvePsrs(s, { when: ['now'] })
    const t = r.events.filter((e) => e.type === 'PsrResolved') as unknown as { tn: number }[]
    expect(t.map((e) => e.tn)).toEqual([4]) // prone? no: standing unit fails, falls; second discarded
    expect(first).toBe('p:1')
    // second case: prone unit, three stand attempts one after another
    for (let i = 0; i < 3; i++) {
      FORCED.push([1, 1])
      const prone = q(mkState(mkUnit({ prone: true })), 'stand', -1, 'now')
      r = resolvePsrs(prone, { when: ['now'] })
      expect((r.events.find((e) => e.type === 'PsrResolved') as unknown as { tn: number }).tn).toBe(4)
    }
  })
})

describe('PSR queue behaviour', () => {
  it('PSR-002 two queued PSRs at TN 8: the first failure falls and the second is not rolled', () => {
    let s = mkState(mkUnit({ tonnage: 40 }))
    s = q(s, 'damage20', 3) // TN 5 + 3 = 8
    s = q(s, 'kicked', 0)
    FORCED.push([1, 2], [5, 5], [1], [2, 2]) // psr fail 3; seatbelt TN 5 passes (10); side 1 -> rear; location 4 -> RA
    const r = resolvePsrs(s, { when: ['endOfPhase'] })
    expect(r.events.filter((e) => e.type === 'DiceRolled' && e.purpose === 'psr')).toHaveLength(1)
    expect(r.events.some((e) => e.type === 'PsrDiscarded' && e.why === 'alreadyFell')).toBe(true)
    expect(r.state.units.A1!.prone).toBe(true)
  })

  it('PSR-003 TN 13 is an automatic failure with no PSR roll', () => {
    const sl = slots(); sl.CT = [hit('gyro'), hit('gyro')]; sl.LL = [hit('hip')]; sl.RL = [hit('hip'), hit('lowerLeg')]
    const s = q(mkState(mkUnit({ slots: sl, tonnage: 20 })), 'kicked', 0) // 5 + 4 + 3 = 12 ... plus damage mod below
    const s2 = q(s, 'charged', 2)
    // seatbelt TN 12 rolls; side; one location group (20 t fall = 2)
    FORCED.push([6, 6], [3], [3, 3])
    const r = resolvePsrs(s2, { when: ['endOfPhase'] })
    const res = r.events.find((e) => e.type === 'PsrResolved') as unknown as { auto: boolean; tn: number; roll: number | null; success: boolean }
    expect(res.tn).toBe(14)
    expect(res).toMatchObject({ auto: true, roll: null, success: false })
    expect(r.events.some((e) => e.type === 'DiceRolled' && e.purpose === 'psr')).toBe(false)
  })

  it('PSR-004 a prone unit discards fall triggers and automatic falls: no UnitFell', () => {
    let s = mkState(mkUnit({ prone: true }))
    s = q(s, 'damage20', 1)
    s = q(s, 'legDestroyed', 0, 'endOfPhase', true)
    const r = resolvePsrs(s, { when: ['endOfPhase'] })
    expect(r.events.filter((e) => e.type === 'PsrDiscarded' && e.why === 'prone')).toHaveLength(2)
    expect(r.events.some((e) => e.type === 'UnitFell')).toBe(false)
  })

  it('PSR-005 a standing shut-down unit fails without a roll and then falls (PSR-057: immobile fall costs a pilot hit)', () => {
    const s = q(mkState(mkUnit({ shutdown: { cause: 'heat', turn: 1 }, tonnage: 40 })), 'kicked', 0)
    FORCED.push([4], [3, 3]) // fall side, one 5-group... 40 t fall = 4 damage, one group
    const r = resolvePsrs(s, { when: ['endOfPhase'] })
    expect(r.events.find((e) => e.type === 'PsrResolved')).toMatchObject({ auto: true, success: false, roll: null })
    expect(r.state.units.A1!.pilot.hits).toBe(1)
    expect(r.events.some((e) => e.type === 'DiceRolled' && (e.purpose === 'seatbelt' || e.purpose === 'psr'))).toBe(false)
  })
})

describe('falls (10 section 14.4)', () => {
  it('PSR-052 damage = ceil(tonnage/10) x (levels+1) in groups of 5, leftover last', () => {
    expect(damageGroups(fallDamage(85, 0, false))).toEqual([5, 4])
    expect(damageGroups(fallDamage(45, 2, false))).toEqual([5, 5, 5])
  })
  it('PSR-054 a fall ending in water halves, rounding down', () => {
    expect(fallDamage(85, 0, true)).toBe(4)
  })
  it('PSR-056 seatbelt TN = Piloting + persistent + levels; no event mods', () => {
    const sl = slots(); sl.CT = [hit('gyro')]
    const u = mkUnit({ slots: sl })
    expect(seatbeltTn(u, 0)).toBe(7)
    expect(seatbeltTn(u, 2)).toBe(9)
  })

  it('PSR-050/053/055 fall keeps facing, rear column on side roll 1, applies damage per group', () => {
    const s = q(mkState(mkUnit({ facing: 3 })), 'kicked', 0)
    FORCED.push([2, 2]) // psr fails (4 < 5)
    FORCED.push([5, 5]) // seatbelt passes
    FORCED.push([1]) // side: rear
    FORCED.push([3, 4], [2, 3]) // 7 -> CT, 5 -> RL
    const r = resolvePsrs(s, { when: ['endOfPhase'] })
    const fell = r.events.find((e) => e.type === 'UnitFell') as unknown as { facing: number; damage: number; column: string }
    expect(fell).toMatchObject({ facing: 3, damage: 9, column: 'rear' })
    expect(r.state.units.A1!.prone).toBe(true)
    expect(r.state.units.A1!.facing).toBe(3)
    expect(dmgCalls).toEqual([{ amount: 5, location: 'CT', side: 'rear' }, { amount: 4, location: 'RL', side: 'front' }])
  })

  it('PSR-056 failed seatbelt costs one pilot hit', () => {
    const s = q(mkState(mkUnit({ tonnage: 40 })), 'kicked', 0)
    FORCED.push([1, 1], [1, 1], [6], [6, 6]) // psr fail, seatbelt fail (2 < 5), side front, HD
    const r = resolvePsrs(s, { when: ['endOfPhase'] })
    expect(r.state.units.A1!.pilot.hits).toBe(1)
    expect(r.state.ledger.pilotHit).toEqual(['A1'])
  })

  it('MOVE-042/PSR-050 a failed stand is a 0-level fall in place: stays prone, seatbelt rolled, damage dealt', () => {
    const s = q(mkState(mkUnit({ prone: true, tonnage: 40 })), 'stand', -1, 'now')
    FORCED.push([1, 1], [5, 5], [2], [3, 4]) // stand fails (2 < 4), seatbelt ok, side 2 -> right column, 7 -> RT
    const r = resolvePsrs(s, { when: ['now'] })
    expect(r.events.find((e) => e.type === 'UnitFell')).toMatchObject({ levels: 0, damage: 4 })
    expect(r.state.units.A1!.prone).toBe(true)
    expect(dmgCalls).toEqual([{ amount: 4, location: 'RT', side: 'front' }])
  })

  it('PSR-053 side columns: roll 5-6 uses the left column, 4 the front column', () => {
    const s = q(mkState(mkUnit({ tonnage: 40 })), 'kicked', 0)
    FORCED.push([1, 1], [5, 5], [5], [1, 3]) // left column, 4 -> LA
    resolvePsrs(s, { when: ['endOfPhase'] })
    expect(dmgCalls).toEqual([{ amount: 4, location: 'LA', side: 'front' }])
  })
})
