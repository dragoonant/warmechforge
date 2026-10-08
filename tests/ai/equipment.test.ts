// M6 equipment choices in the utility AI (normal tier): coolant pod, PPC capacitor charge and MASC, read from the engine's sheet
// equipment states and priced with query.heatProjection / query.reachable({masc}). Every answer must pass validate.
import { describe, expect, it } from 'vitest'
import type { DeclareFireAction, GameState, MoveAction, UnitId } from '../../src/engine/index'
import { createGame, legalActions, query, step, validate, view } from '../../src/engine/index'
import { decideAi } from '../../src/ai/decider'
import { customSetup } from '../../tools/sim'
import { BUNDLE, answer, flatten, patchUnit, place } from './helpers'

function duel(mechA: string, mechB: string, kind: string, seed: string, mine: string): GameState {
  const setup = customSetup(BUNDLE, { mission: 'mission.skirmish', turnLimit: 30 }, [mechA, mechB])
  let s = createGame(setup, seed, BUNDLE).state
  const ok = (x: GameState): boolean => x.pending.kind === kind && x.turn >= 2 && x.units[x.pending.unitId!]?.mechId === mine
  for (let i = 0; i < 4000 && s.pending.kind !== 'gameOver' && !ok(s); i++) {
    const r = step(s, answer(s, 'random'))
    if (r.rejection) throw new Error(r.rejection.message)
    s = r.state
  }
  expect(ok(s)).toBe(true)
  return flatten(s)
}
const enemyOf = (s: GameState, me: UnitId): UnitId => s.unitOrder.find((id) => s.units[id]!.owner !== s.units[me]!.owner)!
const decide = (s: GameState) => decideAi(view(s, s.pending.player), s.pending, legalActions(s), { tier: 'normal', trace: true })

describe('utility AI equipment choices', () => {
  it('AI-026 vents the coolant pod when the end heat would be costly', () => {
    let s = duel('mech.regent.a', 'mech.regent.prime', 'declareFire', 'pod-1', 'mech.regent.a')
    const me = s.pending.unitId!
    const c = s.board.hexes['0810']!.hex
    s = place(s, me, c, 0)
    s = place(s, enemyOf(s, me), { q: c.q, r: c.r - 4 }, 3)
    s = patchUnit(s, me, { heat: 16 })
    s = { ...s, declarations: [] }
    const eq = query.sheet(s, me).equipment ?? []
    expect(eq.some((e) => e.kind === 'coolantPod' && e.state === 'ready')).toBe(true)
    const d = decide(s)
    expect(validate(s, d.action)).toBeNull()
    expect((d.action as DeclareFireAction).coolantPod).toBeDefined()
  })

  it('AI-027 MASC moves are offered only when valid and every answer validates', () => {
    let s = duel('mech.solitaire.2', 'mech.regent.prime', 'move', 'masc-1', 'mech.solitaire.2')
    const me = s.pending.unitId!
    s = place(s, me, s.board.hexes['0816']!.hex, 0)
    s = place(s, enemyOf(s, me), s.board.hexes['0801']!.hex, 3)
    const d = decide(s)
    expect(validate(s, d.action)).toBeNull()
    expect((d.action as MoveAction).type).toBe('move')
    expect(d.trace!.options!.length).toBeGreaterThan(0)
  })
})
