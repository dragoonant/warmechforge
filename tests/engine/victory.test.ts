import { describe, expect, it } from 'vitest'
import { BUNDLE, mkState, mkUnit } from './damage.fixture'
import { registerBundle } from '../../src/engine/index'
import { checkVictory, computeCrippled, endGame, refreshStatus } from '../../src/engine/victory'
import type { DataBundle, GameState } from '../../src/engine/types'

const bundle = (cripple: boolean, turnLimit = false): DataBundle => ({
  ...BUNDLE,
  mechs: { 'mech.test': { id: 'mech.test', bv: 1000 } },
  missions: { 'mission.t': { id: 'mission.t', victory: [{ type: 'eliminate', cripple }, ...(turnLimit ? [{ type: 'turnLimitBV' }] : [])] } },
} as unknown as DataBundle)
function setup(cripple = false, withdrawal = false): GameState {
  registerBundle(bundle(cripple))
  const s = mkState([mkUnit('A1', 'A', { mounts: [{ id: 'ml', item: 'w.mlaser', location: 'RA' }] }), mkUnit('B1', 'B', { mounts: [{ id: 'ml', item: 'w.mlaser', location: 'RA' }] })])
  return { ...s, setup: { missionId: 'mission.t', forcedWithdrawal: withdrawal, turnLimit: null } } as unknown as GameState
}
const set = (s: GameState, id: string, patch: object): GameState => ({ ...s, units: { ...s.units, [id]: { ...s.units[id]!, ...patch } } })
const hit = (s: GameState, id: string, loc: 'CT' | 'HD', token: string, n: number): GameState => {
  const u = s.units[id]!
  let left = n
  return set(s, id, { slots: { ...u.slots, [loc]: u.slots[loc].map((sl) => (sl.token === token && left-- > 0 ? { ...sl, hit: true } : sl)) } })
}

describe('victory (11 section 5)', () => {
  it('SCN-020 last enemy destroyed wins; both gone in one check is a draw; crippled counts only with the flag', () => {
    let s = set(setup(false), 'B1', { status: 'destroyed' })
    expect(checkVictory(s)).toMatchObject({ winner: 'A', reason: 'eliminate' })
    s = set(s, 'A1', { status: 'destroyed' })
    expect(checkVictory(s)).toMatchObject({ winner: null, reason: 'draw' })
    expect(checkVictory(set(setup(false), 'B1', { crippled: true }))).toBeNull()
    expect(checkVictory(set(setup(true), 'B1', { crippled: true }))).toMatchObject({ winner: 'A' })
    expect(checkVictory({ ...set(setup(false), 'B1', { status: 'destroyed' }), damageWindow: 'simultaneous' })).toBeNull()
  })

  it('SCN-020 turn limit: equal eliminated BV is a draw at the limit, nothing before it', () => {
    registerBundle(bundle(false, true))
    const s0 = setup(false)
    registerBundle(bundle(false, true))
    const s = { ...s0, turn: 8, setup: { ...s0.setup, turnLimit: 8 } } as GameState
    expect(checkVictory(s, { atEndPhase: true })).toMatchObject({ winner: null, reason: 'draw' })
    expect(checkVictory({ ...s, turn: 7 }, { atEndPhase: true })).toBeNull()
    expect(checkVictory(s)).toBeNull()
  })

  it('SCN-021 crippled by a leg, gyro, two engine hits or no usable weapon; not by 4 pilot hits or 2 sensor hits', () => {
    const s = setup()
    const u = (st: GameState) => st.units.A1!
    expect(computeCrippled(u(s), BUNDLE)).toBe(false)
    expect(computeCrippled(u(set(s, 'A1', { locs: { ...s.units.A1!.locs, LL: { ...s.units.A1!.locs.LL, destroyed: true } } })), BUNDLE)).toBe(true)
    expect(computeCrippled(u(hit(s, 'A1', 'CT', 'gyro', 2)), BUNDLE)).toBe(true)
    expect(computeCrippled(u(hit(s, 'A1', 'CT', 'engine', 2)), BUNDLE)).toBe(true)
    expect(computeCrippled(u(hit(s, 'A1', 'CT', 'engine', 1)), BUNDLE)).toBe(false)
    const noGun = set(s, 'A1', { mounts: { ml: { ...s.units.A1!.mounts.ml!, destroyed: true } } })
    expect(computeCrippled(u(noGun), BUNDLE)).toBe(true)
    const soft = hit(set(s, 'A1', { pilot: { ...s.units.A1!.pilot, hits: 4 } }), 'A1', 'HD', 'sensors', 2)
    expect(computeCrippled(u(soft), BUNDLE)).toBe(false)
  })

  it('SCN-030 forced withdrawal: two sensor crits or 4 pilot hits make the unit withdrawing, crippled stays false', () => {
    const s = hit(setup(false, true), 'A1', 'HD', 'sensors', 2)
    const r = refreshStatus(s)
    expect(r.state.units.A1).toMatchObject({ status: 'withdrawing', crippled: false })
    expect(r.events[0]).toMatchObject({ type: 'StatusChanged', status: 'withdrawing' })
    const p = refreshStatus(set(setup(false, true), 'B1', { pilot: { ...s.units.B1!.pilot, hits: 4 } }))
    expect(p.state.units.B1!.status).toBe('withdrawing')
    expect(refreshStatus(hit(setup(false, false), 'A1', 'HD', 'sensors', 2)).state.units.A1!.status).toBe('active')
  })

  it('SCN-020 endGame sets the result, ends the phase and raises gameOver', () => {
    const r = endGame(setup(), { winner: 'A', reason: 'eliminate', turn: 3 })
    expect(r.state.phase).toBe('ended')
    expect(r.state.pending.kind).toBe('gameOver')
    expect(r.events).toEqual([{ type: 'GameEnded', result: { winner: 'A', reason: 'eliminate', turn: 3 } }])
  })
})
