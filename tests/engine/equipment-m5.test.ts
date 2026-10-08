// M5 equipment the stock roster needs (10 §18, 20 §12.2): ferro-lamellor, the Clan targeting computer, Guardian ECM against
// Artemis IV, LB-X slug/cluster ammo, the Ultra AC two-shot mode and the Gauss rifle explosion. Real 'Mech data from the bundle.
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

import { loadBundle } from '../../src/data/index'
import { ammoRec, effectiveProfile, weaponRec } from '../../src/engine/ammo'
import { artemisClusterMod, ecmBlocksArtemis } from '../../src/engine/cluster'
import { applyDamage, resolveAttack } from '../../src/engine/damage'
import type { GameEvent } from '../../src/engine/events'
import { createGame, query } from '../../src/engine/index'
import { declareFire, evaluateShot, tcEligible } from '../../src/engine/phases/ranged'
import type { FireShot } from '../../src/engine/actions'
import type { GameSetup, GameState, Hex, RangedDeclaration, UnitId } from '../../src/engine/types'

const bundle = loadBundle()
const ofType = <T extends GameEvent['type']>(evs: GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  evs.filter((e) => e.type === t) as Extract<GameEvent, { type: T }>[]

/** A skirmish with the given 'Mechs (A1.., B1..) on a flat, clear board; every unit active and placed by `at`. */
function arena(a: string[], b: string[], at: Record<UnitId, [number, number, number]>): GameState {
  const side = (id: string, mechs: string[]) => ({ sideId: id, control: 'ai' as const, force: { id: `force.t-${id}`, name: id, units: mechs.map((mech) => ({ mech })) } })
  const setup: GameSetup = { missionId: 'mission.skirmish', mapId: 'map.test-canyons', sides: [side('a', a), side('b', b)], forcedWithdrawal: false, turnLimit: null, bvBudget: null }
  const r = createGame(setup, 'm5-equipment', bundle)
  if (r.rejection) throw new Error(r.rejection.message)
  let s = r.state
  const hexes = Object.fromEntries(Object.entries(s.board.hexes).map(([k, h]) => [k, { ...h, level: 0, woods: 'none' as const, depth: 0, rough: false, rubble: false }]))
  s = { ...s, board: { ...s.board, hexes } }
  const units = { ...s.units }
  for (const [id, [q, r2, f]] of Object.entries(at)) {
    const u = units[id]!
    units[id] = { ...u, pos: { q, r: r2 } as Hex, facing: f as 0, status: 'active', move: { ...u.move, mode: null, tmm: 0, jumped: false } }
  }
  return { ...s, units }
}
const shotOf = (s: GameState, unit: UnitId, sh: FireShot) => declareFire(s, bundle, { type: 'declareFire', decisionId: 'd', player: unit[0] as 'A', unitId: unit, shots: [sh] })

describe('M5 equipment for the stock roster', () => {
  it('EQUIP-014 ferro-lamellor stops 1 point per 5 (or part) while the struck armor stands; never explosions or bare structure', () => {
    const s = arena(['mech.regent.prime'], ['mech.vulture-mk-iv.prime'], { A1: [5, 8, 0], B1: [5, 5, 3] })
    const hit = (st: GameState, amount: number, location: 'LA' | 'HD' | 'CT', source: 'weapon' | 'ammoExplosion' = 'weapon', internal = false) =>
      applyDamage(st, { unitId: 'B1', amount, location, side: 'front', source, ...(internal ? { internal } : {}) }, bundle)
    const five = hit(s, 5, 'LA')
    expect(five.state.units.B1!.locs.LA.armor).toBe(16) // 20 - 4
    expect(ofType(five.events, 'DamageApplied')[0]).toMatchObject({ damage: 4, reduced: 1 })
    const six = hit(s, 6, 'LA')
    expect(six.state.units.B1!.locs.LA.armor).toBe(16) // 6 - 2 (part of a second 5)
    const one = hit(s, 1, 'LA')
    expect(one.state.units.B1!.locs.LA.armor).toBe(20)
    expect(ofType(one.events, 'DamageApplied')[0]).toMatchObject({ damage: 0, reduced: 1 })
    // a 1-point head hit is stopped: no pilot hit; 5 points get through (4) and hurt the pilot
    expect(hit(s, 1, 'HD').state.units.B1!.pilot.hits).toBe(0)
    const head5 = hit(s, 5, 'HD').state.units.B1!
    expect([head5.locs.HD.armor, head5.pilot.hits]).toEqual([5, 1])
    // bare structure: no reduction
    const bare = { ...s, units: { ...s.units, B1: { ...s.units.B1!, locs: { ...s.units.B1!.locs, LA: { ...s.units.B1!.locs.LA, armor: 0 } } } } }
    expect(hit(bare, 5, 'LA').state.units.B1!.locs.LA.structure).toBe(s.units.B1!.locs.LA.structure - 5)
    // explosions (internal) are never reduced; a plain-armor 'Mech takes the full 5
    expect(hit(s, 5, 'CT', 'ammoExplosion', true).state.units.B1!.locs.CT.structure).toBe(s.units.B1!.locs.CT.structure - 5)
    const plain = applyDamage(s, { unitId: 'A1', amount: 5, location: 'LA', side: 'front', source: 'weapon' }, bundle)
    expect(plain.state.units.A1!.locs.LA.armor).toBe(s.units.A1!.locs.LA.armor - 5)
  })

  it('EQUIP-001 the Clan targeting computer gives direct-fire weapons -1; not cluster fire; gone when the TC is destroyed', () => {
    const s = arena(['mech.regent.a', 'mech.regent.prime'], ['mech.hollander.bzk-f3'], { A1: [5, 8, 0], A2: [7, 8, 0], B1: [5, 4, 3] })
    const tcMod = (st: GameState, unit: UnitId, mountId: string) =>
      evaluateShot(st, bundle, unit, { mountId, targetId: 'B1' }, { secondary: false }).tn!.mods.find((m) => m.code === 'targetingComputer')?.value ?? 0
    expect(tcMod(s, 'A1', 'erppc-ra')).toBe(-1)
    expect(tcMod(s, 'A2', 'erll-ra')).toBe(0) // Regent Prime carries no TC
    const noTc = { ...s, units: { ...s.units, A1: { ...s.units.A1!, mounts: { ...s.units.A1!.mounts, 'tc-rt': { ...s.units.A1!.mounts['tc-rt']!, destroyed: true } } } } }
    expect(tcMod(noTc, 'A1', 'erppc-ra')).toBe(0)
    const lb = weaponRec(bundle, 'cl.w.lb-20x')!
    expect(tcEligible(effectiveProfile(lb, ammoRec(bundle, 'cl.ammo.lb-20x-slug')))).toBe(true)
    expect(tcEligible(effectiveProfile(lb, ammoRec(bundle, 'cl.ammo.lb-20x-cluster')))).toBe(false)
    expect(tcEligible(weaponRec(bundle, 'cl.w.streak-srm-4')!)).toBe(false)
    expect(tcEligible(weaponRec(bundle, 'is.w.machine-gun')!)).toBe(false)
  })

  it('CLUS-004 / EQUIP-015 Artemis IV +2 on the Rakshasa MDG-1B; a hostile operating Guardian ECM within 6 hexes cancels it', () => {
    const s = arena(['mech.rakshasa.mdg-1b'], ['mech.uziel.uzl-8s'], { A1: [5, 14, 0], B1: [5, 2, 3] }) // 12 apart
    const r = s.units.A1!
    expect(artemisClusterMod(bundle, r, 'lrm-lt', 'is.ammo.lrm-10-artemis')).toBe(2)
    expect(artemisClusterMod(bundle, r, 'lrm-lt', 'is.ammo.lrm-10-artemis', { state: s, targetHex: { q: 5, r: 2 } })).toBe(0) // target inside the bubble
    const far = { q: 5, r: 9 } // 7 from the Uziel, 5 from the Rakshasa
    expect(ecmBlocksArtemis(bundle, s, r, far)).toBe(false)
    const near = { ...s, units: { ...s.units, B1: { ...s.units.B1!, pos: { q: 5, r: 9 } } } } // Uziel 5 from the attacker
    expect(ecmBlocksArtemis(bundle, near, r, { q: 9, r: 14 })).toBe(true)
    const off = { ...near, units: { ...near.units, B1: { ...near.units.B1!, shutdown: { cause: 'heat' as const, turn: 1 } } } }
    expect(ecmBlocksArtemis(bundle, off, r, { q: 9, r: 14 })).toBe(false)
    const friend = { ...near, units: { ...near.units, B1: { ...near.units.B1!, owner: 'A' as const } } }
    expect(ecmBlocksArtemis(bundle, friend, r, { q: 9, r: 14 })).toBe(false)
  })

  it('AMMO-001 LB 20-X: two ammo types ask for a choice; cluster ammo fires 20 one-point hits at -1, slug one 20-point hit', () => {
    const s = arena(['mech.regent.prime'], ['mech.mad-cat-mk-ii.base'], { A1: [5, 8, 0], B1: [5, 5, 3] })
    expect(shotOf(s, 'A1', { mountId: 'lb20-rt', targetId: 'B1' }).ammoChoice?.bins.map((b) => b.binId).sort()).toEqual(['ammo-lb20-clu-lt', 'ammo-lb20-slug-lt'])
    const clu = shotOf(s, 'A1', { mountId: 'lb20-rt', targetId: 'B1', binId: 'ammo-lb20-clu-lt' })
    const dc = clu.state.declarations[0] as RangedDeclaration
    expect(dc.mods.find((m) => m.code === 'weapon')?.value).toBe(-1)
    expect(clu.state.units.A1!.bins['ammo-lb20-clu-lt']!.shots).toBe(4)
    FORCED.push([6, 6], [4, 3]) // hit; cluster 7 on the 20 row
    const rc = resolveAttack(clu.state, dc, { data: bundle })
    const cl = ofType(rc.events, 'ClusterResolved')[0]!
    expect(cl.rackSize).toBe(20)
    expect(cl.groups.every((g) => g === 1)).toBe(true)
    const slug = shotOf(s, 'A1', { mountId: 'lb20-rt', targetId: 'B1', binId: 'ammo-lb20-slug-lt' })
    const ds = slug.state.declarations[0] as RangedDeclaration
    expect(ds.mods.find((m) => m.code === 'weapon')).toBeUndefined()
    FORCED.push([6, 6])
    const rs = resolveAttack(slug.state, ds, { data: bundle })
    expect(ofType(rs.events, 'ClusterResolved')).toHaveLength(0)
    expect(ofType(rs.events, 'HitLocated').map((h) => h.damage)).toEqual([20])
  })

  it('EQUIP-011 Ultra AC/10 two-shot mode: 2 shots and twice the heat at declaration, a 2-shot cluster roll of 10-point hits, never a jam', () => {
    const s = arena(['mech.vulture-mk-iv.a'], ['mech.regent.prime'], { A1: [5, 8, 0], B1: [5, 5, 3] })
    const r = shotOf(s, 'A1', { mountId: 'uac10-la', targetId: 'B1', rapidShots: 2 })
    expect(r.rejection).toBeUndefined()
    const spent = ofType(r.events, 'AmmoSpent')[0]!
    expect(spent.shots).toBe(2)
    expect(r.state.heatLedger.A1!.reduce((a, e) => a + e.amount, 0)).toBe(6)
    expect(shotOf(s, 'A1', { mountId: 'uac10-la', targetId: 'B1', rapidShots: 3 }).rejection?.code).toBe('E_RAPID_MODE')
    FORCED.push([6, 6], [6, 6]) // hit; cluster 12: both shots
    const d = r.state.declarations[0] as RangedDeclaration
    const res = resolveAttack(r.state, d, { data: bundle })
    expect(ofType(res.events, 'ClusterResolved')[0]).toMatchObject({ rackSize: 2, hits: 2 })
    expect(ofType(res.events, 'HitLocated').map((h) => h.damage)).toEqual([10, 10])
    expect(ofType(res.events, 'DiceRolled').map((e) => e.purpose)).not.toContain('jam')
  })

  it('AMMO-020 the Gauss rifle explodes on a crit for 2 x its slots; its ammo is inert', () => {
    const s = arena(['mech.hollander.bzk-f3'], ['mech.regent.prime'], { A1: [5, 8, 0], B1: [5, 5, 3] })
    const u = s.units.A1!
    const slotOf = (token: string) => {
      for (const [loc, sl] of Object.entries(u.slots)) { const i = sl.findIndex((x) => x.token === token); if (i >= 0) return { location: loc as 'RT', index: i } }
      throw new Error(token)
    }
    const g = query.explosionPreview(s, 'A1', slotOf('#gauss-rt'))
    expect(g.damage).toBe(14) // IS Gauss: 7 slots
    expect(query.explosionPreview(s, 'A1', slotOf('#ammo-gauss-ct')).damage).toBe(0)
  })
})
