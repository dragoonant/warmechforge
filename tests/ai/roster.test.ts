// Full-roster AI behaviour (M6 WP-AI): Ultra AC double tap, explosive Gauss slots in the value model, forced withdrawal, the
// decision trace options, the threat overlay model and the bench sweep cells.
import { describe, expect, it } from 'vitest'
import type { DeclareFireAction, GameState, MoveAction, UnitId } from '../../src/engine/index'
import { createGame, legalActions, step, validate, view } from '../../src/engine/index'
import { decideAi } from '../../src/ai/decider'
import { AiCtx, aiRng } from '../../src/ai/ctx'
import { enemyModels, shotOptions } from '../../src/ai/fire'
import { TIERS } from '../../src/ai/tiers'
import { threatModel, threatTint } from '../../src/client/interaction/ThreatOverlay'
import { benchCells } from '../../tools/ai-bench'
import { customSetup } from '../../tools/sim'
import { BUNDLE, answer, flatten, place, patchUnit } from './helpers'

/** A one-on-one skirmish played by the random bot until `kind` is pending on turn 2 or later, on a flat board. */
function duel(mechA: string, mechB: string, kind: string, seed: string): GameState {
  const setup = customSetup(BUNDLE, { mission: 'mission.skirmish', turnLimit: 30 }, [mechA, mechB])
  let s = createGame(setup, seed, BUNDLE).state
  for (let i = 0; i < 4000 && s.pending.kind !== 'gameOver' && !(s.pending.kind === kind && s.turn >= 2); i++) {
    const r = step(s, answer(s, 'random'))
    if (r.rejection) throw new Error(r.rejection.message)
    s = r.state
  }
  expect(s.pending.kind).toBe(kind)
  return flatten(s)
}

const ctxFor = (s: GameState): AiCtx => new AiCtx(s, s.pending.player, TIERS.normal, aiRng(s.seed, s.pending.player, s.decisionSeq, 'normal'), 2000)
const enemyOf = (s: GameState, me: UnitId): UnitId => s.unitOrder.find((id) => s.units[id]!.owner !== s.units[me]!.owner)!

/** Attacker at 0810 facing north, the enemy three hexes ahead, both fresh and cool. */
function facing(s: GameState): { s: GameState; me: UnitId; enemy: UnitId } {
  const me = s.pending.unitId!
  const enemy = enemyOf(s, me)
  const c = s.board.hexes['0810']!.hex
  s = place(s, me, c, 0)
  s = patchUnit(s, me, (u) => ({ move: { ...u.move, mode: 'standStill', attackerMod: 0, done: true } }))
  s = place(s, enemy, { q: c.q, r: c.r - 3 }, 3)
  s = patchUnit(s, enemy, (u) => ({ move: { ...u.move, mode: 'walk', hexesMoved: 3, tmm: 1, jumped: false, done: true } }))
  return { s: { ...s, heatLedger: { ...s.heatLedger, [me]: [] }, declarations: [] }, me, enemy }
}

describe('utility AI on the full roster', () => {
  it('AI-020 offers and can declare the Ultra AC double tap', () => {
    const { s, me, enemy } = facing(duel('mech.vulture-mk-iv.a', 'mech.vulture-mk-iv.a', 'declareFire', 'uac-1'))
    const ctx = ctxFor(s)
    const models = enemyModels(ctx)
    const opts = shotOptions(ctx, me, { targets: [{ id: enemy, model: models.get(enemy)! }], primaryId: enemy })
    const uac = opts.filter((o) => s.units[me]!.mounts[o.mountId]!.item.includes('ultra'))
    expect(uac.some((o) => o.rapidShots === 2)).toBe(true)
    const two = uac.find((o) => o.rapidShots === 2)!
    const one = uac.find((o) => !o.rapidShots)!
    expect(two.heat).toBe(2 * one.heat)
    expect(two.pv.cluster?.rackSize).toBe(2)
    const act: DeclareFireAction = { type: 'declareFire', decisionId: s.pending.id, player: s.pending.player, unitId: me, shots: [{ mountId: two.mountId, targetId: enemy, ...(two.binId ? { binId: two.binId } : {}), rapidShots: 2 }] }
    expect(validate(s, act)).toBeNull()
    const d = decideAi(view(s, s.pending.player), s.pending, legalActions(s), { tier: 'normal' })
    expect(validate(s, d.action)).toBeNull()
  })

  it('AI-021 prices an explosive Gauss rifle slot like an ammo bin', () => {
    const s = duel('mech.hollander.bzk-f3', 'mech.hollander.bzk-g1', 'move', 'gauss-1')
    const ctx = ctxFor(s)
    const id = s.unitOrder.find((x) => s.units[x]!.mechId === 'mech.hollander.bzk-f3')!
    const gauss = Object.values(s.units[id]!.mounts).find((m) => m.item.includes('gauss'))!
    // the Gauss location's mean crit value is well above the plain weapon value (2 x 15 damage per slot) once the blast counts
    expect(ctx.factsOf(id).locValue[gauss.location].crit).toBeGreaterThan(40)
  })

  it('AI-022 a withdrawing unit on its home edge leaves the map', () => {
    let s = duel('mech.hollander.bzk-g1', 'mech.hollander.bzk-g1', 'move', 'wd-1')
    const me = s.pending.unitId!
    const ctx0 = ctxFor(s)
    const edge = Object.values(s.board.hexes).map((h) => h.hex).filter((h) => ctx0.edgeDistance(s.units[me]!.owner, h) === 0)
    const spot = edge[Math.floor(edge.length / 2)]!
    s = place(s, me, spot, 0)
    s = patchUnit(s, me, { status: 'withdrawing' })
    const d = decideAi(view(s, s.pending.player), s.pending, legalActions(s), { tier: 'normal' })
    expect(validate(s, d.action)).toBeNull()
    expect((d.action as MoveAction).steps.some((st) => st.op === 'exit')).toBe(true)
  })

  it('AI-023 traces carry at most three labelled options with the chosen one marked', () => {
    for (const kind of ['move', 'declareFire']) {
      const s = duel('mech.regent.prime', 'mech.mad-cat-mk-ii.base', kind, `trace-${kind}`)
      const d = decideAi(view(s, s.pending.player), s.pending, legalActions(s), { tier: 'normal', trace: true })
      const o = d.trace!.options!
      expect(o.length).toBeGreaterThan(0)
      expect(o.length).toBeLessThanOrEqual(3)
      expect(o.filter((x) => x.chosen)).toHaveLength(1)
      for (const x of o) { expect(x.label.length).toBeGreaterThan(0); expect(Number.isFinite(x.score)).toBe(true) }
      expect(d.trace!.unitId).toBe(s.pending.unitId)
    }
  })

  it('AI-024 threat overlay model: enemy sources, weapons and tints come from query.threat', () => {
    const { s, me, enemy } = facing(duel('mech.regent.prime', 'mech.mad-cat-mk-ii.base', 'declareFire', 'threat-1'))
    const m = threatModel(s, s.units[me]!.pos!, s.units[me]!.owner)
    expect(m.expected).toBeGreaterThan(0)
    expect(m.sources[0]!.unitId).toBe(enemy)
    expect(m.sources[0]!.weapons.length).toBeGreaterThan(0)
    expect(m.cells.length).toBeGreaterThan(1)
    expect(threatTint(0.2)).toBeNull()
    expect(threatTint(12)!.colour).toBe('#d0402b')
  })

  it('AI-025 bench sweeps expand --map and --forces lists into cells', () => {
    const base = { games: 2, seed: '1', turnLimit: 30, pairs: [['normal', 'easy']] as ['normal', 'easy'][], mission: 'mission.skirmish', quiet: true }
    expect(benchCells({ ...base, map: 'map.sodden-hills,map.arid-canyons', forces: 'force.regent-lance,force.mad-cat-lance;random' })).toHaveLength(4)
    expect(benchCells({ ...base, map: 'all' }).map((c) => c.map)).toHaveLength(4)
    expect(benchCells(base)).toHaveLength(1)
  })
})

describe('AI trace panel', () => {
  it('AI-028 renders the published trace: three options, the chosen one marked, parts in words', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { AiTraceBody } = await import('../../src/client/ui/AiTrace')
    const { publishTrace, useAiTraceStore, clearTraces } = await import('../../src/client/bot/traceStore')
    const s = duel('mech.regent.prime', 'mech.mad-cat-mk-ii.base', 'move', 'trace-ui')
    const d = decideAi(view(s, s.pending.player), s.pending, legalActions(s), { tier: 'normal', trace: true })
    clearTraces()
    publishTrace(d.trace, { seed: s.seed, turn: s.turn, phase: s.phase, player: s.pending.player })
    const entry = useAiTraceStore.getState().entries[0]!
    const html = renderToStaticMarkup(createElement(AiTraceBody, { entry, who: 'Regent' }))
    expect(html.match(/data-testid="ai-trace-option"/g)?.length).toBe(d.trace!.options!.length)
    expect(html).toContain('data-chosen="true"')
    expect(html).toContain('Movement')
    expect(html).toMatch(/deal|take|range/)
  })
})
