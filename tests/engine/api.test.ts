// Public engine API (00 §2, §9, §11, §12): createGame, step, validate, legalActions, save/load/replay, query, describe.
import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data/index'
import type { Action, DeclareFireAction, GameState } from '../../src/engine/index'
import {
  createGame, describe as text, hashState, legalActions, load, query, replay, save, step, validate, view,
} from '../../src/engine/index'
import { decideRandom } from '../../src/ai/random'
import { introSetup } from '../../tools/sim'

const bundle = loadBundle()
const setup = introSetup(bundle, 'mission.intro', 30)

function playUntil(seed: string, stop: (s: GameState) => boolean, cap = 3000): { s: GameState; log: Action[] } {
  let s = createGame(setup, seed, bundle).state
  for (let i = 0; i < cap && !stop(s) && s.pending.kind !== 'gameOver'; i++) {
    const a = decideRandom(view(s, s.pending.player), s.pending, legalActions(s), seed)
    const r = step(s, a)
    if (r.rejection) throw new Error(r.rejection.message)
    s = r.state
  }
  return { s, log: s.log }
}

describe('engine API', () => {
  it('API-001 createGame starts turn 1 with edge entry and an initiativeAck; a bad setup is a rejection, not a throw', () => {
    const r = createGame(setup, 'api', bundle)
    expect(r.rejection).toBeUndefined()
    expect(r.state.turn).toBe(1)
    expect(r.pending.kind).toBe('initiativeAck')
    expect(r.events.map((e) => e.type)).toContain('InitiativeResolved')
    const bad = createGame({ ...setup, missionId: 'mission.nope' }, 'api', bundle)
    expect(bad.rejection?.code).toBe('E_BAD_SETUP')
    expect(bad.pending.kind).toBe('gameOver')
  })

  it('API-002 a rejected action returns the same state reference and an ActionRejected event', () => {
    const s = createGame(setup, 'api', bundle).state
    const wrong: Action = { type: 'ack', decisionId: 'd:999', player: s.pending.player }
    const r = step(s, wrong)
    expect(r.rejection?.code).toBe('E_WRONG_DECISION')
    expect(r.state).toBe(s)
    expect(r.events[0]?.type).toBe('ActionRejected')
    expect(validate(s, { type: 'ack', decisionId: s.pending.id, player: s.pending.player === 'A' ? 'B' : 'A' })?.code).toBe('E_NOT_YOUR_DECISION')
  })

  it('API-003 declareFire legal actions start with hold fire and every TN matches the preview (INV-18)', () => {
    const { s } = playUntil('api-fire', (x) => x.pending.kind === 'declareFire')
    expect(s.pending.kind).toBe('declareFire')
    const legal = legalActions(s) as DeclareFireAction[]
    expect(legal[0]!.shots).toEqual([])
    for (const a of legal.slice(1)) {
      expect(validate(s, a)).toBeNull()
      const sh = a.shots[0]!
      const pv = query.attackPreview(s, { attackerId: a.unitId, mountId: sh.mountId, targetId: sh.targetId!, primaryTargetId: a.shots[0]!.targetId })
      expect(pv.legal).toBe(true)
      expect(pv.tn).toBe(pv.mods.reduce((n, m) => n + m.value, 0))
    }
    const single = legal.find((a) => a.shots.length === 1)
    if (single) {
      const sh = single.shots[0]!
      const pv = query.attackPreview(s, { attackerId: single.unitId, mountId: sh.mountId, targetId: sh.targetId! })
      const r = step(s, single)
      const declared = r.events.find((e) => e.type === 'FireDeclared')
      expect(declared && declared.type === 'FireDeclared' ? declared.shots[0]!.tn : null).toBe(pv.tn)
    }
  })

  it('API-004 save/load and replay reproduce the state hash (INV-20, INV-21)', () => {
    const { s } = playUntil('api-save', (x) => x.turn >= 3)
    const loaded = load(save(s, 'test', '2026-10-08'), bundle)
    expect(loaded.rejection).toBeUndefined()
    expect(hashState(loaded.state)).toBe(hashState(s))
    expect(loaded.pending).toEqual(s.pending)
    const rep = replay(setup, s.seed, bundle, s.log)
    expect(hashState(rep.state)).toBe(hashState(s))
    const wrongData = load({ ...save(s), dataVersion: 'other' }, bundle)
    expect(wrongData.rejection?.code).toBe('E_DATA_VERSION')
  })

  it('SCN-020 a bot-vs-bot intro game ends with a result and a gameOver decision', () => {
    const { s } = playUntil('api-end', () => false, 5000)
    expect(s.phase).toBe('ended')
    expect(s.pending.kind).toBe('gameOver')
    expect(s.result).not.toBeNull()
    const ack = step(s, { type: 'ack', decisionId: s.pending.id, player: s.pending.player })
    expect(ack.rejection).toBeUndefined()
    expect(ack.state).toBe(s)
  })

  it('API-005 queries and describe answer for a live game', () => {
    const { s } = playUntil('api-query', (x) => x.phase === 'rangedAttack')
    const id = s.unitOrder.find((u) => s.units[u]!.pos)!
    const u = s.units[id]!
    expect(query.reachable(s, id)).toEqual([]) // movement is over for this turn
    const sheet = query.sheet(s, id)
    expect(sheet.weapons.length).toBeGreaterThan(0)
    expect(query.heatProjection(s, id, {}).now).toBe(u.heat)
    expect(query.heatScale()).toHaveLength(31)
    expect(query.heatEffects(14).shutdownTn).toBe(4)
    expect(query.clusterTable(10, 0).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(query.terrainInfo(s, u.pos!).label).toMatch(/^\d{4}$/)
    expect(query.arcs(s, id).front.length).toBeGreaterThan(0)
    expect(query.psrPreview(s, id, 'kicked').tn).toBe(u.pilot.piloting + query.psrPreview(s, id, 'kicked').mods.slice(1).reduce((n, m) => n + m.value, 0))
    expect(query.fallPreview(s, id).damage).toBe(Math.ceil(u.tonnage / 10))
    expect(query.isKillLocation(s, id, 'CT')).toBe(true)
    expect(query.threat(s, u.pos!).sources.length).toBeGreaterThan(0)
    expect(text.decision(s, s.pending).prompt.length).toBeGreaterThan(0)
    expect(text.unit(s, id)).toContain(u.name)
    for (const a of legalActions(s).slice(0, 3)) expect(text.action(s, a).length).toBeGreaterThan(0)
    expect(text.decision(s, s.pending).title).not.toMatch(/Weapon Attack Phase/)
  })
})
