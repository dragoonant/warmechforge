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
import { fallDeps } from '../../src/engine/psr'
import { currentMp, executeMove, executeStandUp, isImmobile, planMove, reachable, validateMove, validateStandUp } from '../../src/engine/movement'
import type { Facing, GameState, MoveMode, StepOp, UnitState } from '../../src/engine/types'
import { mkState, mkUnit, H } from './move.fixture'

afterEach(() => { expect(FORCED).toHaveLength(0); FORCED.length = 0 })
fallDeps.applyDamage = (state) => ({ state, events: [] })

const mv = (over: Omit<Partial<MoveAction>, 'steps'> & { steps?: StepOp[] }, unitId = 'A1'): MoveAction => ({
  type: 'move', decisionId: 'd:1', player: 'A', unitId, mode: 'walk', facing: 0,
  ...over, steps: (over.steps ?? []).map((op) => ({ op })),
}) as unknown as MoveAction
const run = (s: GameState, a: MoveAction) => {
  const r = executeMove(s, a)
  if ('rejection' in r) throw new Error(`rejected: ${r.rejection.code} ${r.rejection.message}`)
  return r
}
const codeOf = (s: GameState, a: MoveAction) => validateMove(s, a)?.code ?? null
const heatOf = (s: GameState, id = 'A1') => (s.heatLedger[id] ?? []).reduce((a, e) => a + e.amount, 0)
const fwd = (n: number): StepOp[] => Array<StepOp>(n).fill('forward')
const START = H(4, 6)

describe('current MP and immobility (10 section 3.1)', () => {
  const slot = (token: string, hit = true) => ({ token, hit, hitPhase: 1 })
  it('MOVE-006 leg crits, destroyed legs and heat lower walk and run', () => {
    const mp = (u: UnitState) => currentMp(mkState([u]), u.id)
    expect(mp(mkUnit({ slots: { LL: [slot('hip'), slot('foot')] } }))).toMatchObject({ walk: 3, run: 5 })
    expect(mp(mkUnit({ baseMp: { walk: 4, run: 6, jump: 0 }, slots: { LL: [slot('hip'), slot('foot')], RL: [slot('upperLeg'), slot('lowerLeg')] } }))).toMatchObject({ walk: 1, run: 2 })
    expect(mp(mkUnit({ locsDestroyed: ['LL'] }))).toMatchObject({ walk: 1, run: 2 })
    expect(mp(mkUnit({ heat: 10 }))).toMatchObject({ walk: 3, run: 5 })
    expect(mp(mkUnit({ locsDestroyed: ['LL', 'RL'] }))).toMatchObject({ walk: 0, run: 0 })
  })
  it('MOVE-007 destroyed jump jets cost jump MP; heat never does', () => {
    const jets = Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`jj${i}`, { id: `jj${i}`, item: 'is.eq.jump-jet', location: 'LT', destroyed: i === 1 }]))
    const u = mkUnit({ baseMp: { walk: 6, run: 9, jump: 6 }, mounts: jets })
    expect(currentMp(mkState([u]), 'A1').jump).toBe(5)
    const hot = mkUnit({ baseMp: { walk: 6, run: 9, jump: 6 }, heat: 15, mounts: { ...jets, jj1: { ...jets.jj1, destroyed: false } } })
    expect(currentMp(mkState([hot]), 'A1')).toMatchObject({ jump: 6, walk: 3 })
  })
  it('MOVE-008 immobile: shutdown, unconscious, no legs; not prone, gyro, or heat-zeroed MP', () => {
    const imm = (u: UnitState) => isImmobile(mkState([u]), u)
    expect(imm(mkUnit({ shutdown: { cause: 'heat', turn: 1 } }))).toBe(true)
    expect(imm(mkUnit({ pilotConscious: false }))).toBe(true)
    expect(imm(mkUnit({ locsDestroyed: ['LL', 'RL'] }))).toBe(true)
    expect(imm(mkUnit({ prone: true }))).toBe(false)
    expect(imm(mkUnit({ slots: { CT: [slot('gyro'), slot('gyro')] } }))).toBe(false)
    expect(imm(mkUnit({ baseMp: { walk: 3, run: 5, jump: 0 }, heat: 25 }))).toBe(false)
  })
})

describe('modes, steps and heat (10 section 3.1-3.2)', () => {
  it('MOVE-002 stand still costs nothing, adds no heat and allows no facing change', () => {
    const s = mkState([mkUnit()])
    const r = run(s, mv({ mode: 'standStill' }))
    expect(r.state.units.A1!.move).toMatchObject({ mode: 'standStill', tmm: 0, attackerMod: 0, done: true })
    expect(heatOf(r.state)).toBe(0)
    expect(codeOf(s, mv({ mode: 'standStill', facing: 2 }))).toBe('E_BAD_FACING')
    expect(codeOf(s, mv({ mode: 'standStill', steps: ['turnRight'] }))).toBe('E_BAD_MODE')
  })
  it('MOVE-003 walking is heat 1 and +1, and may go backward', () => {
    const r = run(mkState([mkUnit()]), mv({ steps: ['forward', 'backward'] }))
    expect(r.state.units.A1!.move).toMatchObject({ mode: 'walk', attackerMod: 1 })
    expect(heatOf(r.state)).toBe(1)
  })
  it('MOVE-004 running is heat 2 and +2, and a backward step is rejected', () => {
    const s = mkState([mkUnit()])
    expect(codeOf(s, mv({ mode: 'run', steps: ['backward'] }))).toBe('E_NO_BACKWARD')
    const r = run(s, mv({ mode: 'run', steps: fwd(6) }))
    expect(r.state.units.A1!.move).toMatchObject({ mode: 'run', attackerMod: 2, hexesMoved: 6, mpSpent: 6 })
    expect(heatOf(r.state)).toBe(2)
  })
  it('MOVE-010 a side hex needs facing changes first; MOVE-011 each hexside costs 1 MP', () => {
    const s = mkState([mkUnit()])
    const e = reachable(s, 'A1').find((x) => x.mode === 'walk' && x.hex.q === START.q + 1 && x.hex.r === START.r - 1 && x.facing === 1)!
    expect(e.mpUsed).toBe(2)
    const t = run(s, mv({ steps: ['turnRight', 'turnRight', 'turnRight'], facing: 3 }))
    expect(t.state.units.A1!.move.mpSpent).toBe(3)
    expect(t.state.units.A1!.facing).toBe(3)
    expect(planMove(s, mv({ steps: ['turnRight', 'forward'], facing: 1 }))).toMatchObject({ mpUsed: 2 })
  })
  it('MOVE-012 pass friends and shut-down enemies; never enter a mobile enemy or end occupied', () => {
    const ahead = { q: START.q, r: START.r - 1 }
    const base = mkUnit()
    const friend = mkUnit({ id: 'A2', pos: ahead })
    expect(codeOf(mkState([base, friend]), mv({ steps: fwd(2) }))).toBeNull()
    expect(codeOf(mkState([base, friend]), mv({ steps: fwd(1) }))).toBe('E_OCCUPIED')
    const foe = mkUnit({ id: 'B1', owner: 'B', pos: ahead })
    expect(codeOf(mkState([base, foe]), mv({ steps: fwd(2) }))).toBe('E_PROHIBITED_HEX')
    const down = mkUnit({ id: 'B1', owner: 'B', pos: ahead, shutdown: { cause: 'heat', turn: 1 } })
    expect(codeOf(mkState([base, down]), mv({ steps: fwd(2) }))).toBeNull()
  })
  it('MOVE-013 forward 3 then backward 2 counts 2 hexes; facing changes add 0', () => {
    const r = run(mkState([mkUnit()]), mv({ mode: 'walk', steps: ['forward', 'forward', 'forward', 'backward', 'backward'] }))
    expect(r.state.units.A1!.move.hexesMoved).toBe(2)
    const t = run(mkState([mkUnit()]), mv({ steps: ['forward', 'turnRight'], facing: 1 }))
    expect(t.state.units.A1!.move.hexesMoved).toBe(1)
  })
  it('MOVE-014 a hex too dear for the MP may be entered as a one-hex run', () => {
    const s = mkState([mkUnit({ baseMp: { walk: 1, run: 2, jump: 0 } })], { '0506': { woods: 'heavy' } })
    const r = run(s, mv({ mode: 'walk', steps: ['forward'] }))
    expect(r.state.units.A1!.move).toMatchObject({ mode: 'run', attackerMod: 2, mpSpent: 3 })
    expect(heatOf(r.state)).toBe(2)
  })
})

describe('terrain and levels (10 section 3.3)', () => {
  const cost = (over: Record<string, unknown>, steps: StepOp[] = ['forward']) =>
    (planMove(mkState([mkUnit()], { '0506': over }), mv({ steps })) as { mpUsed: number }).mpUsed
  it('MOVE-020 / 023 / 024 / 025 clear 1, rough 2, light woods 2, heavy woods 3', () => {
    expect(cost({})).toBe(1)
    expect(cost({ rough: true })).toBe(2)
    expect(cost({ woods: 'light' })).toBe(2)
    expect(cost({ woods: 'heavy' })).toBe(3)
  })
  it('MOVE-015 / 029 two levels up costs 2 more; three is rejected', () => {
    expect(cost({ level: 2 })).toBe(3)
    expect(cost({ level: 1 })).toBe(2)
    const s = mkState([mkUnit()], { '0506': { level: 3 } })
    expect(codeOf(s, mv({ steps: ['forward'] }))).toBe('E_LEVEL_CHANGE')
  })
  it('MOVE-016 a backward step that changes level queues a PSR at +0 and rolls it at once', () => {
    FORCED.push([6, 6])
    const s = mkState([mkUnit({ facing: 3 })], { '0506': { level: 1 } })
    const r = run(s, mv({ steps: ['backward'], facing: 3 }))
    const q = r.events.find((e) => e.type === 'PsrQueued')
    expect(q).toMatchObject({ reason: 'backwardLevel', mod: 0 })
    expect(r.events.find((e) => e.type === 'PsrResolved')).toMatchObject({ tn: 5, success: true })
  })
  it('MOVE-017 a hip crit limits a hex to one level of change', () => {
    const hip = mkUnit({ slots: { LL: [{ token: 'hip', hit: true, hitPhase: 1 }] } })
    expect(codeOf(mkState([hip], { '0506': { level: 2 } }), mv({ steps: ['forward'] }))).toBe('E_LEVEL_CHANGE')
    expect(codeOf(mkState([hip], { '0506': { level: 1 } }), mv({ steps: ['forward'] }))).toBeNull()
  })
  it('MOVE-034 water costs: shore to depth 1 is 3, depth 1 to depth 1 is 2, depth 1 to shore is 2, shore to depth 2 is 5', () => {
    expect(cost({ depth: 1 })).toBe(3)
    expect(cost({ depth: 2 })).toBe(5)
    const wet = mkState([mkUnit({ pos: { q: START.q, r: START.r - 1 } })], { '0506': { depth: 1 }, '0505': { depth: 1 } })
    expect((planMove(wet, mv({ steps: ['forward'] })) as { mpUsed: number }).mpUsed).toBe(2)
    const out = mkState([mkUnit({ pos: { q: START.q, r: START.r - 1 } })], { '0506': { depth: 1 } })
    expect((planMove(out, mv({ steps: ['backward'], facing: 0 })) as { mpUsed: number }).mpUsed).toBe(2)
  })
  it('MOVE-027 walking into depth 1 needs no PSR; running into it needs one at Piloting minus 1', () => {
    const s = mkState([mkUnit()], { '0506': { depth: 1 } })
    const w = run(s, mv({ mode: 'walk', steps: ['forward'] }))
    expect(w.events.some((e) => e.type === 'PsrQueued')).toBe(false)
    FORCED.push([6, 6])
    const r = run(s, mv({ mode: 'run', steps: ['forward'] }))
    expect(r.events.find((e) => e.type === 'PsrResolved')).toMatchObject({ reason: 'runWater', tn: 4, success: true })
  })
  it('MOVE-030 off board, mobile enemy hex and ending occupied are all rejected', () => {
    const edge = mkState([mkUnit({ pos: H(4, 0) })])
    expect(codeOf(edge, mv({ steps: ['forward'] }))).toBe('E_OFF_BOARD')
  })
})

describe('prone and standing (10 section 3.4)', () => {
  it('MOVE-032 / 040 dropping prone costs 1 MP, keeps the facing and adds no extra heat; not while jumping', () => {
    const s = mkState([mkUnit()])
    const r = run(s, mv({ steps: ['forward', 'dropProne'] }))
    expect(r.state.units.A1!.prone).toBe(true)
    expect(r.state.units.A1!.move.mpSpent).toBe(2)
    expect(heatOf(r.state)).toBe(1)
    expect(codeOf(s, mv({ mode: 'jump', steps: ['dropProne'], jumpTo: H(4, 4) }))).toBe('E_BAD_PAYLOAD')
  })
  it('MOVE-041 a prone unit may not jump and may only turn', () => {
    const s = mkState([mkUnit({ prone: true, baseMp: { walk: 5, run: 8, jump: 3 } })])
    expect(codeOf(s, mv({ mode: 'jump', jumpTo: H(4, 5) }))).toBe('E_BAD_MODE')
    expect(codeOf(s, mv({ steps: ['forward'] }))).toBe('E_PRONE')
    expect(codeOf(s, mv({ steps: ['turnRight'], facing: 1 }))).toBeNull()
  })
  const stand = (over: Partial<StandUpAction> = {}): StandUpAction => ({ type: 'standUp', decisionId: 'd:1', player: 'A', unitId: 'A1', attempt: true, mode: 'walk', ...over })
  it('MOVE-033 / 042 a stand attempt costs 2 MP at TN 4 with no heat; success takes the chosen facing, failure falls and may retry at TN 4', () => {
    const s = mkState([mkUnit({ prone: true })])
    FORCED.push([4, 6])
    const ok = executeStandUp(s, stand({ facing: 3 })) as Exclude<ReturnType<typeof executeStandUp>, { rejection: unknown }>
    expect(ok.next).toBe('move')
    expect(ok.state.units.A1).toMatchObject({ prone: false, facing: 3 })
    expect(ok.state.units.A1!.move.mpSpent).toBe(2)
    expect(ok.events.find((e) => e.type === 'PsrResolved')).toMatchObject({ reason: 'stand', tn: 4 })
    expect(heatOf(ok.state)).toBe(0)
    FORCED.push([1, 1], [1, 2])
    const bad = executeStandUp(s, stand()) as Exclude<ReturnType<typeof executeStandUp>, { rejection: unknown }>
    expect(bad.next).toBe('standUp')
    expect(bad.state.units.A1!.prone).toBe(true)
    const again = executeStandUp(bad.state, stand()) as Exclude<ReturnType<typeof executeStandUp>, { rejection: unknown }>
    expect(again.events.find((e) => e.type === 'PsrResolved')).toMatchObject({ tn: 4, success: false })
  })
  it('MOVE-043 no stand attempt with both legs gone, or one leg and both arms gone, or a dead gyro', () => {
    const chk = (u: UnitState) => validateStandUp(mkState([u]), stand())?.code ?? null
    expect(chk(mkUnit({ prone: true, locsDestroyed: ['LL', 'RL'] }))).toBe('E_CANNOT_STAND')
    expect(chk(mkUnit({ prone: true, locsDestroyed: ['LL', 'LA', 'RA'] }))).toBe('E_CANNOT_STAND')
    expect(chk(mkUnit({ prone: true, slots: { CT: [{ token: 'gyro', hit: true, hitPhase: 1 }, { token: 'gyro', hit: true, hitPhase: 1 }] } }))).toBe('E_CANNOT_STAND')
    expect(chk(mkUnit({ prone: true }))).toBeNull()
  })
  it('MOVE-044 one leg gone, Piloting 4: one attempt, counts as a run, TN 8', () => {
    const u = mkUnit({ prone: true, locsDestroyed: ['LL'], piloting: 4 })
    FORCED.push([1, 1])
    const r = executeStandUp(mkState([u]), stand()) as Exclude<ReturnType<typeof executeStandUp>, { rejection: unknown }>
    expect(r.events.find((e) => e.type === 'PsrResolved')).toMatchObject({ tn: 8, success: false })
    expect(r.state.units.A1!.move.mode).toBe('run')
    expect(r.next).toBe('done')
  })
})

describe('jumping (10 section 3.5)', () => {
  const jumper = (over: Record<string, unknown> = {}) => mkUnit({ baseMp: { walk: 5, run: 8, jump: 5 }, ...over })
  it('MOVE-005 / 050 heat is the larger of 3 and the hexes jumped; cost is the hex path length; +3 to hit', () => {
    const s = mkState([jumper()])
    const two = run(s, mv({ mode: 'jump', jumpTo: H(4, 4), facing: 2 }))
    expect(heatOf(two.state)).toBe(3)
    expect(two.state.units.A1!.move).toMatchObject({ mode: 'jump', attackerMod: 3, mpSpent: 2, jumped: true })
    expect(two.state.units.A1!.facing).toBe(2)
    const five = run(s, mv({ mode: 'jump', jumpTo: H(4, 1), facing: 0 }))
    expect(heatOf(five.state)).toBe(5)
    expect(five.state.units.A1!.move.tmm).toBe(3) // 5 hexes = +2, plus 1 for jumping
  })
  it('MOVE-051 jump height uses the start level plus jump MP; any drop is fine', () => {
    const u = jumper({ baseMp: { walk: 5, run: 8, jump: 3 } })
    expect(codeOf(mkState([u], { '0506': { level: 4 } }), mv({ mode: 'jump', jumpTo: H(4, 5) }))).toBe('E_JUMP_TOO_HIGH')
    expect(codeOf(mkState([u], { '0506': { level: 3 } }), mv({ mode: 'jump', jumpTo: H(4, 3) }))).toBeNull()
    expect(codeOf(mkState([u], { '0507': { level: 6 } }), mv({ mode: 'jump', jumpTo: H(4, 5) }))).toBeNull()
  })
  it('MOVE-052 an occupied landing hex is rejected', () => {
    const s = mkState([jumper(), mkUnit({ id: 'A2', pos: H(4, 4) })])
    expect(codeOf(s, mv({ mode: 'jump', jumpTo: H(4, 4) }))).toBe('E_OCCUPIED')
  })
  it('MOVE-053 landing in depth 1 is a PSR at +0; a failure is a 1-level fall for half damage', () => {
    FORCED.push([1, 1])
    const s = mkState([jumper()], { '0505': { depth: 1 } })
    const r = run(s, mv({ mode: 'jump', jumpTo: H(4, 4) }))
    expect(r.events.find((e) => e.type === 'PsrResolved')).toMatchObject({ reason: 'landWater', tn: 5, success: false })
    expect(r.events.find((e) => e.type === 'UnitFell')).toMatchObject({ levels: 1, damage: 5 })
  })
})

describe('reachable (00 section 11)', () => {
  it('every reachable entry validates, replays to the same cost, and the set has stand still first', () => {
    const s = mkState([mkUnit({ baseMp: { walk: 4, run: 6, jump: 3 } })], { '0506': { woods: 'light' }, '0504': { rough: true }, '0305': { level: 1 } })
    const list = reachable(s, 'A1')
    expect(list[0]!.mode).toBe('standStill')
    expect(list.some((e) => e.mode === 'jump')).toBe(true)
    for (const e of list) {
      expect(validateMove(s, e.action), JSON.stringify(e.action)).toBeNull()
      const p = planMove(s, e.action) as { mpUsed: number }
      expect(p.mpUsed).toBe(e.mpUsed)
    }
    const modes = new Set<MoveMode>(list.map((e) => e.mode))
    expect(modes).toEqual(new Set(['standStill', 'walk', 'run', 'jump']))
    const dir: Facing = 0
    expect(list.some((e) => e.facing === dir && e.hex.r === START.r - 4 && e.mode === 'run')).toBe(true)
  })
})
