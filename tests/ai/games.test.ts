// AI-013 / AI-007 over real games: the utility AI never answers illegally across 5 seeded intro games, and its fire
// declarations respect the normal tier's heat caps (H_end ≤ 9 unless a kill shot is likely or the unit is about to die;
// shutdown avoid TN 8+ only for a kill shot; never automatic shutdown).
import { describe, expect, it } from 'vitest'
import type { GameState } from '../../src/engine/index'
import { createGame, deriveSeedString, legalActions, query, step, validate, view } from '../../src/engine/index'
import { decideAi, type FireTrace } from '../../src/ai/decider'
import { decideRandom } from '../../src/ai/random'
import { BUNDLE, SETUP } from './helpers'

describe('utility AI in full games', () => {
  it('AI-013 never answers illegally across 5 seeded games (normal vs random, sides alternated) and respects the heat caps (AI-007)', () => {
    const problems: string[] = []
    let aiDecisions = 0, fires = 0
    for (let g = 0; g < 5; g++) {
      const seed = deriveSeedString('ai-test', g)
      const aiSide = g % 2 === 0 ? 'A' : 'B'
      let s: GameState = createGame(SETUP, seed, BUNDLE).state
      for (let i = 0; i < 4000 && s.pending.kind !== 'gameOver'; i++) {
        const p = s.pending
        const legal = legalActions(s)
        let action
        if (p.player === aiSide) {
          const d = decideAi(view(s, p.player), p, legal, { tier: 'normal', trace: true, onEvent: (k, why) => problems.push(`game ${g} ${k}: ${why}`) })
          action = d.action
          aiDecisions++
          const rej = validate(s, action)
          if (rej) problems.push(`game ${g} ${p.kind}: ${rej.code}`)
          if (p.kind === 'declareFire' && action.type === 'declareFire' && action.shots.length) {
            fires++
            const info = (d.trace?.top?.[0] ?? null) as FireTrace | null
            const H = query.heatProjection(s, p.unitId!, { mounts: action.shots.map((x) => x.mountId) }).end
            const e = query.heatEffects(H)
            if (e.autoShutdown) problems.push(`game ${g}: automatic shutdown planned (H ${H})`)
            const H0 = query.heatProjection(s, p.unitId!, { mounts: [] }).end // heat-free weapons may fire at any heat
            if (H > 9 && H > H0 && !(info && (info.pKill >= 0.5 || info.pDying >= 0.6))) problems.push(`game ${g}: H_end ${H} > 9 without a kill shot or last stand`)
            if ((e.shutdownTn ?? 0) >= 8 && !(info && info.pKill >= 0.5)) problems.push(`game ${g}: shutdown avoid ${e.shutdownTn} without a kill shot`)
          }
        } else {
          action = decideRandom(view(s, p.player), p, legal, `${seed}|${p.player}`)
        }
        const r = step(s, action)
        if (r.rejection) { problems.push(`game ${g} ${p.kind}: step rejected ${r.rejection.code}`); break }
        s = r.state
      }
      if (s.pending.kind !== 'gameOver') problems.push(`game ${g}: did not finish`)
    }
    expect(problems).toEqual([])
    expect(aiDecisions).toBeGreaterThan(100)
    expect(fires).toBeGreaterThan(10)
  }, 180_000)
})
