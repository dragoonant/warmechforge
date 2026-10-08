// M9 playtest follow-ups: accidental prone moves, twist notes with real shots, MML ammo, feed attribution, wording.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { query } from '../../src/engine/index'
import { dispatch, legalFor, newGame, resetGameStore, useGameStore } from '../../src/client/store/gameStore'
import { memoryStorage, setStorage } from '../../src/client/store/storage'
import { useSettingsStore } from '../../src/client/store/settingsStore'
import { useUiStore } from '../../src/client/store/uiStore'
import { loadBotBrain } from '../../src/client/bot/botDriver'
import { findReachEntry, queryReach, uiActions } from '../../src/client/contract'
import { facingChoices } from '../../src/client/interaction/overlayModel'
import { narrate } from '../../src/client/presentation/labels'
import { buildFeed } from '../../src/client/ui/feedView'
import { decisionLine } from '../../src/client/ui/topbarView'
import { holdChargeSentence } from '../../src/client/ui/equipView'
import { twistOutcomes } from '../../src/client/ui/fireView'
import type { GameEvent } from '../../src/engine/index'

beforeAll(async () => { await loadBotBrain() })
beforeEach(() => {
  setStorage(memoryStorage())
  useSettingsStore.getState().set({ speed: 0, narration: true })
  resetGameStore()
})

describe('M9 client follow-ups', () => {
  it('MOVE-PRONE-001 keeping your own hex and facing never picks the drop-prone entry', () => {
    newGame({ mission: 'mission.intro', turnLimit: 30, controllers: { A: 'human', B: 'human' }, seed: 'prone-1' })
    const onBoard = () => { const g = useGameStore.getState(); const pd = g.pending; return pd?.kind === 'move' && !!pd.unitId && !!g.state!.units[pd.unitId]!.pos }
    for (let i = 0; i < 400 && !onBoard(); i++) expect(dispatch(legalFor(useGameStore.getState().state)[0]!)).toBeNull()
    const st = useGameStore.getState().state!
    const id = useGameStore.getState().pending!.unitId!
    const u = st.units[id]!
    // the engine does list the prone entry (that is why the client must filter it)
    const raw = query.reachable(st, id)
    expect(raw.some((e) => e.endsProne && e.hex.q === u.pos!.q && e.hex.r === u.pos!.r && e.facing === u.facing)).toBe(true)
    const reach = queryReach(id)
    expect(reach.some((e) => e.endsProne)).toBe(false)
    uiActions.setMoveDraft({ mode: 'walk', hex: u.pos!, facing: u.facing, attack: false })
    const e = findReachEntry(reach, useUiStore.getState().move)
    expect(e === null || !e.endsProne).toBe(true)
    expect(facingChoices(reach, u.pos!, 'walk', false).find((c) => c.facing === u.facing)!.enabled).toBe(false)
  })

  it('FEED-001 a move that drops prone says so; a two-arm punch names each arm', () => {
    const ev = { type: 'MoveEnded', unitId: 'x', mode: 'walk', hexesMoved: 0, jumped: false, mpSpent: 1, tmm: 0, attackerMod: 0 } as unknown as GameEvent
    expect(narrate(null, ev, { droppedProne: true })).toMatch(/drops prone/)
    const punch = (limb: string) => ({ type: 'PhysicalDeclared', unitId: 'x', attackId: 'a', kind: 'punch', targetId: 'y', limb, tn: 7 }) as unknown as GameEvent
    expect(narrate(null, punch('LA'))).toMatch(/left arm punch/)
    expect(narrate(null, punch('RA'))).toMatch(/right arm punch/)
  })

  it('FEED-002 damage groups after a crit check stay on the attack row; a fully stopped cluster is not a bare takes-0 row', () => {
    const e = (event: object, seq: number) => ({ seq, event: event as GameEvent })
    const feed = [
      e({ type: 'AttackRolled', attackId: 'a1', attackerId: 'A1', targetId: 'B1', mountId: 'm1', kind: 'ranged', tn: 6, roll: 9, hit: true }, 1),
      e({ type: 'CritCheckRolled', unitId: 'B1', location: 'CT', roll: 8, crits: 0, why: 'structure' }, 2),
      e({ type: 'DamageApplied', unitId: 'B1', location: 'RT', side: 'front', damage: 2, armorBefore: 3, armorAfter: 1, structureBefore: 10, structureAfter: 10, lost: 0, source: 'weapon', attackId: 'a1' }, 3),
      e({ type: 'DamageApplied', unitId: 'B1', location: 'LT', side: 'front', damage: 0, armorBefore: 5, armorAfter: 5, structureBefore: 10, structureAfter: 10, lost: 0, reduced: 1, source: 'weapon', attackId: 'a1' }, 4),
      e({ type: 'AttackEnded', attackId: 'a1', damageDealt: 2 }, 5),
    ]
    const rows = buildFeed(null, feed)
    expect(rows.some((r) => /^[^:]* takes \d+:/.test(r.text))).toBe(false)
    const atk = rows.find((r) => /→/.test(r.text))!
    expect(atk.text).toContain('ferro-lamellor stopped 1')
    expect(atk.text).toContain('RT-R'.slice(0, 2))
  })

  it('PLAY-009 twist notes count legal shots and name the blocker; an uncharged hold wording exists', () => {
    expect(holdChargeSentence(['ER PPC (RA)'])).toMatch(/skips the charged \+5 shot/)
    const state = { units: { me: { owner: 'A', status: 'active', pos: { q: 0, r: 0 } }, foe: { owner: 'B', status: 'active', pos: { q: 0, r: -3 }, name: 'Foe' } } } as never
    const sheet = { weapons: [{ mountId: 'w1', destroyed: false }] } as never
    const arcs = { front: [{ q: 0, r: -3 }], left: [], right: [], rear: [], mountArcs: { w1: ['front'] } } as never
    const out = twistOutcomes(state, 'me', [0], () => arcs, sheet, false, {
      shot: () => ({ legal: false, reason: 'E_NO_LOS', pHit: 0 }) as never, punch: () => null,
    })
    expect(out[0]!.legal).toBe(0)
    expect(out[0]!.text).toMatch(/no line of sight/)
    const ok = twistOutcomes(state, 'me', [0], () => arcs, sheet, false, { shot: () => ({ legal: true, pHit: 0.4 }) as never, punch: () => null })
    expect(ok[0]!.legal).toBe(1)
  })

  it('HUD-001 the top bar says results are showing while playback runs', () => {
    const s = { phase: 'rangedAttack', sides: { A: { label: 'A' }, B: { label: 'B' } } } as never
    expect(decisionLine(s, { player: 'B', controller: 'bot' }, 1, true)).toMatch(/Showing results/)
    expect(decisionLine(s, { player: 'B', controller: 'bot' }, 1, false)).toMatch(/deciding/)
  })
})
