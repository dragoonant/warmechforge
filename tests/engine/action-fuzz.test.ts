// Action fuzz (60-testing §5): seeded random play; every open decision has a non-empty legal set whose members validate,
// malformed actions are rejected (never thrown) with the same state reference, and validate and step agree.
import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data/index'
import type { Action, DeclareFireAction, GameState } from '../../src/engine/index'
import {
  REJECTION_CODES, createGame, deriveSeed, deriveSeedString, legalActions, nextFloat, step, validate, view,
} from '../../src/engine/index'
import { decideRandom } from '../../src/ai/random'
import { introSetup } from '../../tools/sim'
import { checkState } from '../../tools/invariants'

const bundle = loadBundle()
const setup = introSetup(bundle, 'mission.intro', 30)
const GAMES = 6
const DECISIONS = 400

function rngOf(seed: string): () => number {
  let s = deriveSeed(seed, 'fuzz')
  return () => { const [f, n] = nextFloat(s); s = n; return f }
}

/** Malformed variants of a legal action (60-testing §5 mutation list, the ones that apply to this decision kind). */
function mutations(s: GameState, a: Action, rnd: () => number): Action[] {
  const out: Action[] = []
  const p = s.pending
  const other = s.unitOrder.find((id) => s.units[id]!.owner !== p.player) ?? 'B1'
  out.push({ ...a, decisionId: 'd:999999' } as Action)
  out.push({ type: 'deploy', decisionId: p.id, player: p.player, unitId: 'Z9', hex: { q: 0, r: 0 }, facing: 0 })
  if ('unitId' in a) {
    out.push({ ...a, unitId: 'Z9' } as Action)
    out.push({ ...a, unitId: other } as Action)
  }
  if (a.type === 'move') {
    out.push({ ...a, facing: 6 as never })
    out.push({ ...a, facing: -1 as never })
    out.push({ ...a, mode: 'jump', steps: [], jumpTo: { q: 99, r: 99 } })
    out.push({ ...a, steps: Array.from({ length: 40 }, () => ({ op: 'forward' as const })) })
  }
  if (a.type === 'declareFire') {
    const u = s.units[a.unitId]!
    const mounts = Object.keys(u.mounts)
    out.push({ ...a, shots: [{ mountId: 'nope', targetId: other }] })
    out.push({ ...a, shots: [{ mountId: mounts[0]!, targetId: a.unitId }] })
    if (mounts.length) out.push({ ...a, shots: [{ mountId: mounts[0]!, targetId: other }, { mountId: mounts[0]!, targetId: other }] })
    out.push({ ...a, shots: [{ mountId: mounts[Math.floor(rnd() * mounts.length)]!, targetId: other, binId: 'no-bin' }] })
  }
  if (a.type === 'torsoTwist') out.push({ ...a, twist: 2 as never })
  if (a.type === 'standUp') out.push({ ...a, mode: 'jump' as never })
  out.push({ type: 'powerChoice', decisionId: p.id, player: p.player, changes: [{ unitId: 'Z9', to: 'restart' }] } as Action)
  return out
}

describe('action fuzz', () => {
  it('FUZZ-01 FUZZ-02 random play: legal sets are non-empty and valid, malformed actions are rejected without a throw', () => {
    let decisions = 0
    for (let g = 0; g < GAMES; g++) {
      const seed = deriveSeedString('fuzz', g)
      const rnd = rngOf(seed)
      let s = createGame(setup, seed, bundle).state
      for (let n = 0; n < DECISIONS && s.pending.kind !== 'gameOver'; n++) {
        const legal = legalActions(s)
        expect(legal.length, `${seed} ${s.pending.kind}`).toBeGreaterThan(0)
        if (n % 5 === 0) expect(checkState(s, { fullLegal: true }), seed).toEqual([])
        // half the games play uniformly at random, half with the watchable bot
        const a = g % 2 === 0 ? legal[Math.floor(rnd() * legal.length)]! : decideRandom(view(s, s.pending.player), s.pending, legal, seed)
        if (n % 10 === 0) {
          for (const bad of mutations(s, a, rnd)) {
            let r: ReturnType<typeof step> | null = null
            expect(() => { r = step(s, bad) }).not.toThrow()
            const res = r as unknown as ReturnType<typeof step>
            if (res.rejection) {
              expect(REJECTION_CODES).toContain(res.rejection.code)
              expect(res.state).toBe(s)
              expect(validate(s, bad)?.code).toBe(res.rejection.code)
            } else {
              expect(validate(s, bad)).toBeNull() // a mutation that happens to be legal must step cleanly
            }
          }
        }
        const r = step(s, a)
        expect(r.rejection, `${seed} ${JSON.stringify(a).slice(0, 200)}`).toBeUndefined()
        s = r.state
        decisions++
      }
    }
    expect(decisions).toBeGreaterThan(GAMES * 100)
  })

  it('FUZZ-03 random composite fire selections: validate and step agree', () => {
    let tried = 0, accepted = 0
    for (let g = 0; g < 3; g++) {
      const seed = deriveSeedString('fuzz-fire', g)
      const rnd = rngOf(seed)
      let s = createGame(setup, seed, bundle).state
      for (let n = 0; n < DECISIONS && s.pending.kind !== 'gameOver'; n++) {
        const legal = legalActions(s)
        if (s.pending.kind === 'declareFire') {
          const u = s.units[s.pending.unitId!]!
          const enemies = s.unitOrder.filter((id) => s.units[id]!.owner !== u.owner)
          for (let k = 0; k < 5; k++) {
            const shots = Object.keys(u.mounts).filter(() => rnd() < 0.5).map((m) => ({ mountId: m, targetId: enemies[Math.floor(rnd() * enemies.length)]! }))
            const a: DeclareFireAction = { type: 'declareFire', decisionId: s.pending.id, player: s.pending.player, unitId: u.id, shots }
            const v = validate(s, a)
            const r = step(s, a)
            tried++
            expect(r.rejection?.code ?? null).toBe(v?.code ?? null)
            if (!r.rejection) accepted++
            else expect(r.state).toBe(s)
          }
        }
        const a = decideRandom(view(s, s.pending.player), s.pending, legal, seed)
        s = step(s, a).state
      }
    }
    expect(tried).toBeGreaterThan(20)
    expect(accepted).toBeGreaterThan(0)
  })
})
