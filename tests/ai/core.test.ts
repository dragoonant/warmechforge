// AI building blocks: dice math (AI-001), knapsack vs brute force (AI-006), determinism (AI-014), worker protocol (AI-016),
// source rules (AI-017).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { legalActions, registerBundle, view } from '../../src/engine/index'
import type { Action, AttackPreview } from '../../src/engine/index'
import { decideAi } from '../../src/ai/decider'
import { knapsack, knapsackBest, type ShotOption } from '../../src/ai/fire'
import { p2d6 } from '../../src/ai/prob'
import { handleWorkerMessage, type WorkerResponse } from '../../src/ai/worker'
import { BUNDLE, playUntil } from './helpers'

describe('utility AI core', () => {
  it('AI-001 P(2d6 ≥ t) equals brute force for t = 0..14', () => {
    for (let t = 0; t <= 14; t++) {
      let n = 0
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= t) n++
      expect(p2d6(t)).toBeCloseTo(t > 12 ? 0 : n / 36, 12)
    }
  })

  it('AI-006 the heat knapsack equals brute force over all subsets for 50 random loadouts', () => {
    let seed = 12345
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    for (let k = 0; k < 50; k++) {
      const n = 1 + Math.floor(rnd() * 8)
      const items = Array.from({ length: n }, (_, i) => ({
        mountId: `m${i}`,
        options: Array.from({ length: 1 + Math.floor(rnd() * 2) }, (_, j) => ({ mountId: `m${i}`, targetId: `t${j}`, heat: Math.floor(rnd() * 8), value: rnd() * 10, pv: {} as AttackPreview, attack: {} as ShotOption['attack'], shots: Infinity })),
      }))
      const cap = Math.floor(rnd() * 25)
      // brute force: each item holds or picks one option
      let best = 0
      const rec = (i: number, heat: number, val: number): void => {
        if (heat > cap) return
        if (i === items.length) { best = Math.max(best, val); return }
        rec(i + 1, heat, val)
        for (const o of items[i]!.options) rec(i + 1, heat + o.heat, val + o.value)
      }
      rec(0, 0, 0)
      expect(knapsackBest(items, cap).value).toBeCloseTo(best, 9)
      const sets = knapsack(items, cap)
      const viaSets = Math.max(0, ...sets.map((x) => x.value))
      expect(viaSets).toBeCloseTo(best, 9)
      for (const st of sets) expect(st.picks.reduce((a, o) => a + o.heat, 0)).toBeLessThanOrEqual(cap)
    }
  })

  it('AI-014 same view, pending and seed give the same action and trace', () => {
    const s = playUntil('det-1', (x) => x.pending.kind === 'move' && x.turn >= 3)
    const legal = legalActions(s)
    const a = decideAi(view(s, s.pending.player), s.pending, legal, { tier: 'normal', trace: true })
    const b = decideAi(view(s, s.pending.player), s.pending, legal, { tier: 'normal', trace: true })
    expect(b.action).toEqual(a.action)
    expect(b.trace?.top).toEqual(a.trace?.top)
  })

  it('AI-016 worker protocol: init → ready, decide → a validating action, bad input → error', () => {
    const s = playUntil('worker-1', (x) => x.pending.kind === 'declareFire')
    const out: WorkerResponse[] = []
    const post = (m: WorkerResponse): void => { out.push(m) }
    handleWorkerMessage({ type: 'init', bundle: structuredClone(BUNDLE) }, post)
    expect(out[0]).toEqual({ type: 'ready', version: BUNDLE.version })
    const legal = legalActions(s)
    handleWorkerMessage({ type: 'decide', id: 7, view: structuredClone(view(s, s.pending.player)), pending: s.pending, legal, decisionSeq: s.decisionSeq, tier: 'normal' }, post)
    const r = out[1]!
    expect(r.type).toBe('action')
    if (r.type === 'action') {
      expect(r.id).toBe(7)
      expect((r.action as Action).decisionId).toBe(s.pending.id)
    }
    handleWorkerMessage({ type: 'decide', id: 8, view: view(s, s.pending.player), pending: s.pending, legal: [], decisionSeq: 0, tier: 'normal' }, post)
    expect(out[2]).toMatchObject({ type: 'error', id: 8 })
    registerBundle(BUNDLE)
  })

  it('AI-017 no Math.random and no engine-internal imports in src/ai (prob.ts helpers excepted)', () => {
    const dir = path.resolve(__dirname, '../../src/ai')
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      expect(src, f).not.toMatch(/Math\.random/)
      for (const m of src.matchAll(/from '(\.\.\/engine\/[^']+)'/g)) expect(['../engine/index', '../engine/prob'], `${f}: ${m[1]}`).toContain(m[1])
    }
  })
})
