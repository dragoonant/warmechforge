// Golden worked examples (13-golden.md): forced dice, authored positions, the full ordered roll list, key numbers.
import { afterEach, describe, expect, it, vi } from 'vitest'

const FORCED = vi.hoisted(() => ({ map: new Map<number, number[]>(), strict: { on: false } }))
vi.mock('../../src/engine/rng', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/rng')>()
  const { forcedRoll } = await import('../fixtures/forced-dice')
  return { ...real, roll: forcedRoll(real, FORCED) }
})

import { expectAllForcedUsed, force } from '../fixtures/forced-dice'
import { F, Golden } from '../fixtures/golden'
import type { GUnit } from '../fixtures/golden'
import { legalActions, query } from '../../src/engine/index'
import type { GameState } from '../../src/engine/types'

afterEach(() => expectAllForcedUsed(FORCED))

/** Forces the script's rolls #1.. in order and refuses any roll the script does not list. */
function script(...rolls: number[][]): void {
  force(FORCED, 1, ...rolls)
  FORCED.strict.on = true
}
/** The end of the scripted turn starts the next one at once: its two initiative rolls come last (not part of the example). */
const NEXT_TURN = [[1, 2], [3, 4]]
/** The example's rolls, without the next turn's initiative. */
const scripted = (g: Golden, n: number): string[] => purposes(g).slice(0, n)
const purposes = (g: Golden): string[] => g.dice().map((d) => d.purpose)
const armor = (g: Golden, name: string, loc: 'HD' | 'CT' | 'LT' | 'RT' | 'LA' | 'RA' | 'LL' | 'RL'): number => g.u(name).locs[loc].armor
const patchUnit = (s: GameState, id: string, f: (u: GameState['units'][string]) => GameState['units'][string]): GameState =>
  ({ ...s, units: { ...s.units, [id]: f(s.units[id]!) } })
/** Plays Ranged (holds for anyone not listed), Physical (none), Heat and End until the next initiativeAck or game over. */
function finishTurn(g: Golden): void {
  for (let i = 0; i < 40 && g.p.kind !== 'initiativeAck' && g.p.kind !== 'gameOver'; i++) {
    const p = g.p
    const name = p.unitId ? g.s.units[p.unitId]!.name : null
    if (p.kind === 'selectUnit') g.act({ type: 'selectUnit', unitId: p.context.eligible![0] })
    else if (p.kind === 'torsoTwist') g.act({ type: 'torsoTwist', unitId: p.unitId, twist: 0, flip: false })
    else if (p.kind === 'declareFire') g.fire(name!)
    else if (p.kind === 'declarePhysical') g.physical(name!)
    else if (p.kind === 'move') g.standStill(name!)
    else throw new Error(`finishTurn: unexpected ${p.kind}`)
  }
}

describe('13-golden worked examples', () => {
  it('GOLD-001 two ranged attacks: partial cover, woods, jump, run', () => {
    script([3, 3], [4, 4], [5, 6], [2, 3], [4, 6], [4, 6], [3, 4], ...NEXT_TURN)
    const g = new Golden('001', {
      units: [{ side: 'A', mech: F.WVR, at: { q: 6, r: 11 }, facing: 0 }, { side: 'B', mech: F.GRF, at: { q: 6, r: 0 }, facing: 3 }],
      overrides: { '0707': { level: 1 }, '0709': { terrain: [{ type: 'lightWoods' }] }, '0710': { terrain: [{ type: 'lightWoods' }] } },
    })
    expect(g.s.initiative?.winner).toBe('B')
    g.ack()
    g.move('F-WVR', { mode: 'run', steps: g.forward(5), facing: 0 })
    expect(g.u('F-WVR').move.hexesMoved).toBe(5)
    expect(g.u('F-WVR').move.mpSpent).toBe(6)
    g.move('F-GRF', { mode: 'jump', steps: [], jumpTo: { q: 6, r: 2 }, facing: 3 })
    expect(g.u('F-GRF').move).toMatchObject({ hexesMoved: 2, jumped: true })
    g.fire('F-WVR', [{ mountId: 'ml-ra', target: 'F-GRF' }, { mountId: 'srm-rt', target: 'F-GRF' }])
    expect(g.u('F-WVR').bins['srm-ammo']!.shots).toBe(14)
    g.fire('F-GRF', [{ mountId: 'ppc-ra', target: 'F-WVR' }])
    const tns = g.events('FireDeclared').flatMap((e) => e.shots.map((x) => x.tn))
    expect(tns).toEqual([11, 11, 10])
    finishTurn(g)
    expect(g.events('HitAbsorbedByCover')).toHaveLength(1)
    expect(armor(g, 'F-WVR', 'CT')).toBe(13)
    expect(g.events('PsrQueued')).toHaveLength(0)
    expect(g.u('F-WVR').heat).toBe(0)
    expect(g.u('F-GRF').heat).toBe(1)
    expect(scripted(g, 7)).toEqual(['initiative', 'initiative', 'toHit', 'hitLocation', 'toHit', 'toHit', 'hitLocation'])
    expect(g.dice()).toHaveLength(9)
  })

  const units002 = (): GUnit[] => [{ side: 'A', mech: F.WVR, at: { q: 6, r: 4 }, facing: 1 }, { side: 'B', mech: F.TDR, at: { q: 8, r: 3 }, facing: 0 }]
  it('GOLD-002 divided LOS: the defender picks the blocked line', () => {
    script([3, 3], [4, 4], ...NEXT_TURN)
    const g = new Golden('002', { units: units002(), overrides: { '0807': { level: 3 } } }).ack()
    g.standStill('F-WVR').standStill('F-TDR')
    const los = query.los(g.s, g.id('F-WVR'), g.id('F-TDR'))
    expect(los.divided).toBe(true)
    expect(los.visible).toBe(false)
    expect(los.hexes).toContainEqual({ q: 7, r: 3 })
    expect(los.alt).toContainEqual({ q: 7, r: 4 })
    // neither unit has a legal shot: both declarations auto-resolve to holding fire
    finishTurn(g)
    expect(g.events('FireDeclared').every((e) => e.shots.length === 0)).toBe(true)
    expect(scripted(g, 2)).toEqual(['initiative', 'initiative'])
    expect(g.dice()).toHaveLength(4)
  })

  it('GOLD-002b divided LOS through light woods: the woods branch counts', () => {
    script([3, 3], [4, 4], [1, 1], ...NEXT_TURN)
    const g = new Golden('002b', { units: units002(), overrides: { '0807': { terrain: [{ type: 'lightWoods' }] } } }).ack()
    g.standStill('F-WVR').standStill('F-TDR')
    const los = query.los(g.s, g.id('F-WVR'), g.id('F-TDR'))
    expect(los).toMatchObject({ divided: true, visible: true, woodsPoints: 1 })
    expect(los.hexes).toContainEqual({ q: 7, r: 3 })
    const pv = query.attackPreview(g.s, { attackerId: g.id('F-WVR'), mountId: 'ml-ra', targetId: g.id('F-TDR') })
    expect(pv).toMatchObject({ legal: true, tn: 5, direction: 'left' })
    g.fire('F-WVR', [{ mountId: 'ml-ra', target: 'F-TDR' }])
    finishTurn(g)
    expect(g.events('FireDeclared')[0]!.shots[0]!.tn).toBe(5)
    expect(scripted(g, 3)).toEqual(['initiative', 'initiative', 'toHit'])
  })

  it('GOLD-002c divided LOS with both branches clear: TN 4', () => {
    script([3, 3], [4, 4], ...NEXT_TURN)
    const g = new Golden('002c', { units: units002() }).ack()
    g.standStill('F-WVR').standStill('F-TDR')
    const los = query.los(g.s, g.id('F-WVR'), g.id('F-TDR'))
    expect(los).toMatchObject({ divided: true, visible: true, chosen: '+' })
    expect(query.attackPreview(g.s, { attackerId: g.id('F-WVR'), mountId: 'ml-ra', targetId: g.id('F-TDR') }).tn).toBe(4)
    finishTurn(g)
  })

  it('GOLD-003 LRM 20 cluster hit in 5-point groups', () => {
    script([2, 2], [5, 5], [2, 3], [4, 4], [4, 4], [1, 3], [5, 6], ...NEXT_TURN)
    const g = new Golden('003', { units: [{ side: 'A', mech: F.CPLT20, at: { q: 6, r: 10 }, facing: 0 }, { side: 'B', mech: F.TGT45, at: { q: 6, r: 3 }, facing: 5 }] }).ack()
    g.standStill('F-CPLT20').standStill('F-TGT45')
    g.fire('F-CPLT20', [{ mountId: 'lrm-rt', target: 'F-TGT45' }])
    expect(g.u('F-CPLT20').bins['lrm-ammo']!.shots).toBe(5)
    expect(g.events('FireDeclared')[0]!.shots[0]!.tn).toBe(4)
    finishTurn(g)
    const cl = g.events('ClusterResolved')[0]!
    expect(cl).toMatchObject({ hits: 12, groups: [5, 5, 2] })
    expect(g.events('HitLocated').map((h) => [h.location, h.damage, h.direction])).toEqual([['CT', 5, 'left'], ['LA', 5, 'left'], ['RL', 2, 'left']])
    expect([armor(g, 'F-TGT45', 'CT'), armor(g, 'F-TGT45', 'LA'), armor(g, 'F-TGT45', 'RL')]).toEqual([15, 7, 14])
    expect(g.events('CritCheckRolled')).toHaveLength(0)
    expect(g.events('PsrQueued')).toHaveLength(0)
    expect(g.u('F-CPLT20').heat).toBe(0)
    expect(scripted(g, 7)).toEqual(['initiative', 'initiative', 'toHit', 'cluster', 'hitLocation', 'hitLocation', 'hitLocation'])
  })

  it('GOLD-004 armor, structure, crit checks, destruction and transfer', () => {
    script([2, 2], [5, 5], [2, 2], [1, 3], [3, 3], [2, 3], [4, 4], [5, 6], [1, 3], [2, 3], [2, 2], [3, 4], [3, 3], [1, 4], [3, 4], ...NEXT_TURN)
    const g = new Golden('004', {
      units: [
        { side: 'A', mech: F.GHR, at: { q: 6, r: 3 }, facing: 5 },
        { side: 'B', mech: F.SHOOTX, at: { q: 6, r: 7 }, facing: 0 },
        { side: 'B', mech: F.SHOOTY, at: { q: 6, r: 10 }, facing: 0 },
      ],
    }).ack()
    g.standStill('F-GHR').standStill('F-SHOOT-X').standStill('F-SHOOT-Y')
    g.fire('F-GHR')
    g.fire('F-SHOOT-X', [{ mountId: 'ppc-ra', target: 'F-GHR' }, { mountId: 'll-la', target: 'F-GHR' }])
    g.fire('F-SHOOT-Y', [{ mountId: 'lrm-lt', target: 'F-GHR' }, { mountId: 'ppc-ra', target: 'F-GHR' }])
    expect(g.u('F-SHOOT-Y').bins['lrm-ammo']!.shots).toBe(11)
    expect(g.events('FireDeclared').flatMap((e) => e.shots.map((x) => x.tn))).toEqual([4, 4, 4, 6])
    finishTurn(g)
    const dmg = g.events('DamageApplied').filter((d) => d.unitId === g.id('F-GHR'))
    expect(dmg.map((d) => [d.location, d.armorAfter, d.structureAfter])).toEqual([
      ['LA', 12, 11], ['LA', 4, 11], ['LA', 0, 10], ['LA', 0, 5], ['LA', 0, 0], ['LT', 15, 15],
    ])
    expect(dmg[4]).toMatchObject({ structureAfter: 0, transferredTo: 'LT', transferred: 5 })
    expect(g.events('CritCheckRolled').map((c) => c.location)).toEqual(['LA', 'LA'])
    expect(g.u('F-GHR').locs.LA.destroyed).toBe(true)
    expect(g.u('F-GHR').mounts['ml-la']!.destroyed).toBe(true)
    const psr = g.events('PsrResolved')
    expect(psr).toHaveLength(1)
    expect(psr[0]).toMatchObject({ reason: 'damage20', tn: 6, success: true })
    expect(scripted(g, 15).slice(2)).toEqual(['toHit', 'hitLocation', 'toHit', 'hitLocation', 'toHit', 'cluster', 'hitLocation', 'critCheck', 'hitLocation', 'critCheck', 'toHit', 'hitLocation', 'psr'])
  })

  it('GOLD-005 heat build-up, shutdown and restart', () => {
    const init = [[1, 2], [6, 6]]
    const miss3 = [[1, 1], [1, 1], [1, 1]]
    script(...init, ...miss3, ...init, ...miss3, [2, 2], ...init, ...miss3, [2, 3], ...init, ...init)
    const g = new Golden('005', {
      units: [{ side: 'A', mech: F.AWS, at: { q: 6, r: 10 }, facing: 0 }, { side: 'B', mech: F.DUMMY, at: { q: 6, r: 3 }, facing: 3 }],
      patch: (s) => patchUnit(s, 'A1', (u) => ({ ...u, heat: 4 })),
    })
    const ppcs = (): { mountId: string; target: string }[] => ['ppc-la', 'ppc-rt', 'ppc-ra'].map((m) => ({ mountId: m, target: 'F-DUMMY' }))
    const turn = (to: number, walk: number, run: number, tn: number): void => {
      g.ack()
      expect(query.sheet(g.s, g.id('F-AWS')).mp).toMatchObject({ walk, run })
      g.move('F-AWS', { mode: 'walk', steps: g.forward(1), facing: 0 })
      expect(g.u('F-AWS').pos).toEqual({ q: 6, r: to })
      g.standStill('F-DUMMY')
      g.fire('F-AWS', ppcs())
      expect(g.events('FireDeclared').at(-1)!.shots.map((x) => x.tn)).toEqual([tn, tn, tn])
      finishTurn(g)
    }
    turn(9, 3, 5, 5)
    expect(g.u('F-AWS').heat).toBe(9)
    turn(8, 2, 3, 6)
    expect(g.u('F-AWS').heat).toBe(14)
    expect(g.u('F-AWS').shutdown).toBeNull()
    turn(7, 1, 2, 7)
    expect(g.u('F-AWS').heat).toBe(19)
    expect(g.u('F-AWS').shutdown).toMatchObject({ cause: 'heat' })
    expect(g.events('PsrQueued')).toHaveLength(0)
    // turn 4: shut down, no Movement or Ranged selection; heat 0 and an automatic restart
    g.ack()
    expect(g.p.unitId).toBe(g.id('F-DUMMY'))
    g.standStill('F-DUMMY')
    finishTurn(g)
    expect(g.u('F-AWS').heat).toBe(0)
    expect(g.events('UnitRestarted').at(-1)).toMatchObject({ auto: true })
    // turn 5: Movement selection again with walk 3, run 5
    g.ack()
    expect(g.p).toMatchObject({ kind: 'move', unitId: g.id('F-AWS') })
    expect(query.sheet(g.s, g.id('F-AWS')).mp).toMatchObject({ walk: 3, run: 5 })
    expect(g.dice().filter((d) => d.purpose === 'shutdownAvoid')).toHaveLength(2)
    expect(g.dice().filter((d) => d.purpose === 'ammoExplosionAvoid')).toHaveLength(0)
    expect(g.dice()).toHaveLength(21)
  })

  const units006 = (): GUnit[] => [{ side: 'A', mech: F.BLR, at: { q: 6, r: 6 }, facing: 2 }, { side: 'B', mech: F.DUMMY, at: { q: 6, r: 1 }, facing: 3 }]
  const prone006 = (s: GameState): GameState => patchUnit(s, 'A1', (u) => ({ ...u, prone: true }))
  function stand006(g: Golden): void {
    g.ack().select('F-BLR')
    expect(g.p.kind).toBe('standUp')
    expect(g.p.context.psr?.tn).toBe(4)
    g.act({ type: 'standUp', unitId: g.id('F-BLR'), attempt: true, mode: 'walk', facing: 2 })
    const fell = g.events('UnitFell')[0]!
    expect(fell).toMatchObject({ levels: 0, facing: 2, damage: 9 })
    expect(g.u('F-BLR')).toMatchObject({ prone: true, facing: 2, pos: { q: 6, r: 6 } })
    expect(g.events('PilotHit')).toHaveLength(0)
  }
  it('GOLD-006 failed stand attempt, fall and seatbelt check', () => {
    script([1, 2], [6, 6], [1, 2], [2, 3], [4], [3, 4], [4, 4], ...NEXT_TURN)
    const g = new Golden('006', { units: units006(), patch: prone006 })
    stand006(g)
    expect([armor(g, 'F-BLR', 'CT'), armor(g, 'F-BLR', 'LT')]).toEqual([25, 16])
    // 2 MP left: another attempt and ending the move are both offered
    expect(g.p.kind).toBe('standUp')
    const legal = legalActions(g.s)
    expect(legal.some((a) => a.type === 'standUp' && a.attempt)).toBe(true)
    expect(legal.some((a) => a.type === 'standUp' && !a.attempt)).toBe(true)
    g.act({ type: 'standUp', unitId: g.id('F-BLR'), attempt: false })
    g.standStill('F-DUMMY')
    finishTurn(g)
    expect(g.u('F-BLR').heat).toBe(0)
    expect(scripted(g, 7)).toEqual(['initiative', 'initiative', 'psr', 'seatbelt', 'fallSide', 'fallLocation', 'fallLocation'])
  })

  it('GOLD-006b the fall side roll of 1 hits the rear column', () => {
    script([1, 2], [6, 6], [1, 2], [2, 3], [1], [3, 4], [4, 4])
    const g = new Golden('006b', { units: units006(), patch: prone006 })
    stand006(g)
    expect([g.u('F-BLR').locs.CT.rear, g.u('F-BLR').locs.LT.rear]).toEqual([5, 4])
  })

  it('GOLD-006c a second stand attempt is again TN 4 and stands the unit facing 0', () => {
    script([1, 2], [6, 6], [1, 2], [2, 3], [4], [3, 4], [4, 4], [2, 2])
    const g = new Golden('006c', { units: units006(), patch: prone006 })
    stand006(g)
    expect(g.p.context.psr?.tn).toBe(4)
    g.act({ type: 'standUp', unitId: g.id('F-BLR'), attempt: true, facing: 0 })
    expect(g.events('StandAttempted').at(-1)).toMatchObject({ success: true, facing: 0, mpLeft: 0 })
    expect(g.u('F-BLR')).toMatchObject({ prone: false, facing: 0 })
    expect(g.events('MoveEnded').at(-1)).toMatchObject({ unitId: g.id('F-BLR') })
  })

  it('GOLD-007 punch with missing actuators into light woods', () => {
    script([2, 2], [5, 5], [4, 5], [3], ...NEXT_TURN)
    const g = new Golden('007', {
      units: [{ side: 'A', mech: F.CPLT, at: { q: 7, r: 5 }, facing: 5 }, { side: 'B', mech: F.TDR, at: { q: 6, r: 5 }, facing: 0 }],
      overrides: { '0709': { terrain: [{ type: 'lightWoods' }] } },
    }).ack()
    g.standStill('F-CPLT').standStill('F-TDR')
    g.fire('F-CPLT').fire('F-TDR')
    const pv = query.physicalPreview(g.s, { attackerId: g.id('F-CPLT'), kind: 'punch', limb: 'RA', targetId: g.id('F-TDR') })
    expect(pv).toMatchObject({ legal: true, tn: 8, damage: 3 })
    g.physical('F-CPLT', { kind: 'punch', arms: [{ arm: 'RA', targetId: g.id('F-TDR') }] })
    finishTurn(g)
    expect(g.events('PhysicalDeclared')[0]).toMatchObject({ kind: 'punch', tn: 8 })
    expect(g.events('HitLocated')[0]).toMatchObject({ location: 'CT', damage: 3, direction: 'right', table: 'punch' })
    expect(armor(g, 'F-TDR', 'CT')).toBe(27)
    expect(g.events('PsrQueued')).toHaveLength(0)
    expect(scripted(g, 4)).toEqual(['initiative', 'initiative', 'physicalToHit', 'punchLocation'])
  })

  it('GOLD-008 charge after running', () => {
    script([5, 5], [2, 2], [3, 4], [3, 4], [3, 3], [4, 4], [3, 4], [1, 3], [4, 6], [4, 5], [3, 4], [4, 4], [5, 6], [3, 4], ...NEXT_TURN)
    const g = new Golden('008', { units: [{ side: 'A', mech: F.CPLT, at: { q: 6, r: 8 }, facing: 0 }, { side: 'B', mech: F.TGT45, at: { q: 6, r: 2 }, facing: 3 }] }).ack()
    g.standStill('F-TGT45')
    const charge = { mode: 'run', steps: g.forward(5), facing: 0, attack: { kind: 'charge', targetId: g.id('F-TGT45') } }
    expect(query.reachable(g.s, g.id('F-CPLT')).some((e) => e.physical?.kind === 'charge' && e.physical.targetId === g.id('F-TGT45'))).toBe(true)
    g.move('F-CPLT', charge)
    expect(g.u('F-CPLT').move.hexesMoved).toBe(5)
    expect(g.events('PhysicalDeclaredInMove')[0]).toMatchObject({ kind: 'charge', fromHex: { q: 6, r: 3 } })
    finishTurn(g)
    expect(g.events('FireDeclared').every((e) => e.shots.length === 0)).toBe(true)
    expect(g.events('PhysicalDeclared')[0]).toMatchObject({ kind: 'charge', tn: 7 })
    const hits = g.events('HitLocated')
    expect(hits.map((h) => [h.unitId === g.id('F-TGT45') ? 'T' : 'C', h.location, h.damage])).toEqual([
      ['T', 'CT', 5], ['T', 'RT', 5], ['T', 'LT', 5], ['T', 'CT', 5], ['T', 'RA', 5], ['T', 'LA', 5], ['T', 'LL', 3], ['C', 'CT', 5],
    ])
    expect(armor(g, 'F-CPLT', 'CT')).toBe(25)
    expect(g.u('F-TGT45').pos).toEqual({ q: 6, r: 1 })
    expect(g.u('F-TGT45').facing).toBe(3)
    expect(g.u('F-CPLT').pos).toEqual({ q: 6, r: 2 })
    const psr = g.events('PsrResolved').map((p) => [p.unitId === g.id('F-TGT45') ? 'T' : 'C', p.tn, p.success])
    expect(psr).toEqual([['T', 8, true], ['T', 8, true], ['C', 7, true]])
    expect(scripted(g, 14).slice(2)).toEqual(['physicalToHit', ...Array(8).fill('hitLocation'), 'psr', 'psr', 'psr'])
  })

  it('GOLD-009 crits lost in one phase, transferred in the next', () => {
    script([2, 2], [5, 5], [2, 2], [3, 3], [6, 6], [3], [2, 2], [2], [4, 6], [2, 4], [5, 2], [3, 4], ...NEXT_TURN)
    const g = new Golden('009', {
      units: [{ side: 'A', mech: F.WVR, at: { q: 6, r: 4 }, facing: 0 }, { side: 'B', mech: F.BLR, at: { q: 6, r: 3 }, facing: 3 }],
      patch: (s) => patchUnit(s, 'B1', (u) => ({
        ...u,
        locs: { ...u.locs, RT: { ...u.locs.RT, armor: 0 } },
        slots: { ...u.slots, RT: u.slots.RT.map((sl, i) => (i < 2 ? { ...sl, hit: true, hitPhase: 0 } : sl)) },
        mounts: { ...u.mounts, ml1: { ...u.mounts.ml1!, destroyed: true, critHits: 1 }, ml2: { ...u.mounts.ml2!, destroyed: true, critHits: 1 } },
      })),
    }).ack()
    g.standStill('F-WVR').standStill('F-BLR')
    g.fire('F-WVR', [{ mountId: 'ml-ra', target: 'F-BLR' }]).fire('F-BLR')
    g.physical('F-WVR', { kind: 'punch', arms: [{ arm: 'LA', targetId: g.id('F-BLR') }] })
    finishTurn(g)
    expect(g.events('FireDeclared')[0]!.shots[0]!.tn).toBe(4)
    const lost = g.events('CritLost')
    expect(lost).toHaveLength(1)
    expect(lost[0]).toMatchObject({ location: 'RT', count: 2, why: 'noSlotThisPhase' })
    const slotHits = g.events('CritSlotHit').map((c) => [c.location, c.index, c.token])
    expect(slotHits).toEqual([['RT', 2, '#ml3'], ['CT', 3, 'gyro'], ['CT', 7, 'engine']])
    expect(g.events('PhysicalDeclared')[0]).toMatchObject({ kind: 'punch', tn: 4 })
    expect(g.u('F-BLR').locs.RT.structure).toBe(7)
    expect(g.events('PsrResolved')).toEqual([expect.objectContaining({ reason: 'gyroCrit', tn: 7, success: true })])
    const heat = g.events('HeatApplied').find((h) => h.unitId === g.id('F-BLR'))!
    expect(heat).toMatchObject({ generated: 5, after: 0 })
    expect(scripted(g, 12).slice(2)).toEqual(['toHit', 'hitLocation', 'critCheck', 'critSlot', 'physicalToHit', 'punchLocation', 'critCheck', 'critSlot', 'critSlot', 'psr'])
  })

  it('GOLD-010 heat-triggered ammo explosion with the 20-point cap', () => {
    script([1, 2], [6, 6], [1, 1], [1, 1], [3, 4], [1, 2], [2, 3])
    const g = new Golden('010', {
      units: [{ side: 'A', mech: F.UZL, at: { q: 6, r: 8 }, facing: 0 }, { side: 'B', mech: F.DUMMY, at: { q: 6, r: 3 }, facing: 3 }],
      patch: (s) => patchUnit(s, 'A1', (u) => ({ ...u, heat: 21 })),
    }).ack()
    expect(query.sheet(g.s, g.id('F-UZL')).mp).toMatchObject({ walk: 2, run: 3, jump: 6 })
    g.standStill('F-UZL').standStill('F-DUMMY')
    g.fire('F-UZL', [{ mountId: 'ppc-la', target: 'F-DUMMY' }, { mountId: 'ppc-ra', target: 'F-DUMMY' }])
    expect(g.events('FireDeclared')[0]!.shots.map((x) => x.tn)).toEqual([7, 7])
    finishTurn(g)
    expect(g.events('HeatApplied').find((h) => h.unitId === g.id('F-UZL'))).toMatchObject({ before: 21, generated: 20, dissipated: 20, after: 21 })
    expect(g.events('AmmoExploded')[0]).toMatchObject({ binId: 'srm-ammo', location: 'LT', damage: 20, capped: true })
    const uzl = g.u('F-UZL')
    expect(uzl.locs.LT.destroyed).toBe(true)
    expect(uzl.locs.CT.structure).toBe(8)
    expect(uzl.status).toBe('destroyed')
    expect(uzl.pilot.hits).toBe(1)
    expect(uzl.bins['srm-ammo']!.shots).toBe(0)
    expect(g.events('PsrResolved')).toHaveLength(0)
    expect(g.events('ConsciousnessChecked')).toHaveLength(0)
    expect(g.s.result).toMatchObject({ winner: 'B', reason: 'eliminate' })
    expect(purposes(g)).toEqual(['initiative', 'initiative', 'toHit', 'toHit', 'shutdownAvoid', 'ammoExplosionAvoid', 'critCheck'])
  })

  it('GOLD-011 two head hits, one consciousness check, recovery', () => {
    script([2, 2], [5, 5], [3, 3], [6, 6], [4, 4], [6, 6], [2, 2], [5, 5], [2, 2], [5, 5], [6, 6], ...NEXT_TURN)
    const g = new Golden('011', {
      units: [{ side: 'A', mech: F.ML2, at: { q: 6, r: 6 }, facing: 0 }, { side: 'B', mech: F.TGT45, at: { q: 6, r: 3 }, facing: 3 }],
      patch: (s) => patchUnit(s, 'B1', (u) => ({ ...u, pilot: { ...u.pilot, hits: 3 } })),
    }).ack()
    g.standStill('F-ML2').standStill('F-TGT45')
    g.fire('F-ML2', [{ mountId: 'ml-la', target: 'F-TGT45' }, { mountId: 'ml-ra', target: 'F-TGT45' }])
    g.fire('F-TGT45')
    expect(g.events('FireDeclared')[0]!.shots.map((x) => x.tn)).toEqual([4, 4])
    finishTurn(g)
    expect(g.events('PilotHit').map((p) => p.total)).toEqual([4, 5])
    const cc = g.events('ConsciousnessChecked')
    expect(cc).toHaveLength(1)
    expect(cc[0]).toMatchObject({ hits: 5, tn: 11, conscious: false })
    expect(g.u('F-TGT45').locs.HD).toMatchObject({ armor: 0, structure: 2 })
    expect(g.events('PilotRecovered')).toHaveLength(0)
    // turn 2: no selections for the unconscious pilot's unit
    g.ack()
    const before = g.ev.length
    g.standStill('F-ML2')
    finishTurn(g)
    const selected = g.ev.slice(before).filter((e) => e.type === 'UnitSelected').map((e) => (e as { unitId: string }).unitId)
    expect(selected).not.toContain(g.id('F-TGT45'))
    expect(g.events('PilotRecovered')[0]).toMatchObject({ tn: 11, recovered: true })
    expect(g.u('F-TGT45').pilot.conscious).toBe(true)
    expect(scripted(g, 11)).toEqual(['initiative', 'initiative', 'toHit', 'hitLocation', 'toHit', 'hitLocation', 'critCheck', 'consciousness', 'initiative', 'initiative', 'recovery'])
  })

  it('GOLD-012 through-armor crit, gyro PSR and a fall to the rear', () => {
    script([2, 2], [5, 5], [3, 3], [1, 1], [4, 4], [1, 5], [2, 3], [4, 3], [1], [3, 4], ...NEXT_TURN)
    const g = new Golden('012', { units: [{ side: 'A', mech: F.WVR, at: { q: 6, r: 6 }, facing: 0 }, { side: 'B', mech: F.TGT45, at: { q: 6, r: 3 }, facing: 3 }] }).ack()
    g.standStill('F-WVR').standStill('F-TGT45')
    g.fire('F-WVR', [{ mountId: 'ml-ra', target: 'F-TGT45' }]).fire('F-TGT45')
    finishTurn(g)
    expect(g.events('HitLocated')[0]).toMatchObject({ location: 'CT', tac: true, direction: 'front' })
    expect(g.events('CritSlotHit')[0]).toMatchObject({ location: 'CT', index: 4, token: 'gyro' })
    expect(g.events('PsrResolved')[0]).toMatchObject({ reason: 'gyroCrit', tn: 7, success: false })
    expect(g.events('UnitFell')[0]).toMatchObject({ levels: 0, facing: 3, damage: 5, column: 'rear' })
    const sb = g.dice().find((d) => d.purpose === 'seatbelt')
    expect(sb).toBeDefined()
    expect(g.ev.find((e) => e.type === 'DiceRolled' && e.purpose === 'seatbelt')).toMatchObject({ target: 7, success: true })
    const tgt = g.u('F-TGT45')
    expect(tgt).toMatchObject({ prone: true, facing: 3 })
    expect(tgt.locs.CT).toMatchObject({ armor: 15, rear: 1 })
    expect(g.events('ConsciousnessChecked')).toHaveLength(0)
    expect(scripted(g, 10)).toEqual(['initiative', 'initiative', 'toHit', 'hitLocation', 'critCheck', 'critSlot', 'psr', 'seatbelt', 'fallSide', 'fallLocation'])
  })
})

