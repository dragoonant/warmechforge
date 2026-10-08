import { describe, expect, it } from 'vitest'
import { AUDIO_BY_ID } from '../../src/client/audio/manifest'
import { audioPath } from '../../src/client/audio/paths'
import { BATTLE_ORDER } from '../../src/client/audio/music'
import { DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings } from '../../src/client/audio/settings'
import { endScene } from '../../src/client/audio/beatAudio'
import { shotSound, soundsForBeat, weightClass } from '../../src/client/audio/eventSounds'
import type { Beat, SeqEvent } from '../../src/client/presentation/beats'
import { FLAVOURS } from '../../src/client/weaponFlavour'
import type { GameEvent, GameState } from '../../src/engine/index'

const se = (event: unknown, seq = 1): SeqEvent => ({ seq, event: event as GameEvent })
const beat = (b: Partial<Beat> & Pick<Beat, 'kind'>): Beat => ({ events: [], baseMs: 600, applyAt: 'start', unitIds: [], ...b })
const state = { units: { A1: { owner: 'A', tonnage: 85 }, B1: { owner: 'B', tonnage: 20 } } } as unknown as GameState

describe('client audio', () => {
  it('maps tonnage to a footstep class', () => {
    expect(['20', '35', '40', '55', '60', '75', '80', '100'].map((t) => weightClass(Number(t)))).toEqual(
      ['light', 'light', 'medium', 'medium', 'heavy', 'heavy', 'assault', 'assault'])
  })

  it('music ids and paths exist in the manifest', () => {
    for (const id of BATTLE_ORDER) expect(AUDIO_BY_ID[id]?.kind).toBe('music')
    expect(audioPath({ id: 'mus-title-a', kind: 'music' })).toBe('audio/music/mus-title-a.mp3')
    expect(audioPath({ id: 'wp-ppc', kind: 'sfx' })).toBe('audio/wp-ppc.mp3')
  })

  it('every flavour shot and physical blow exists in the manifest', () => {
    for (const f of FLAVOURS) expect(AUDIO_BY_ID[shotSound(f.melee ? 'punch' : 'ranged', f.id).id]).toBeDefined()
    for (const k of ['punch', 'kick', 'charge', 'dfa', 'push'] as const) expect(AUDIO_BY_ID[shotSound(k, null).id], k).toBeDefined()
    expect(shotSound('ranged', 'is.w.gauss-rifle').id).toBe('wp-gauss')
    expect(shotSound('ranged', 'is.w.lrm-10')).toEqual({ id: 'wp-lrm', impact: 'wp-missile-impact' })
  })

  it('plays footsteps by weight class and a missile impact after a missile shot', () => {
    const step = (q: number) => se({ type: 'UnitStepped', unitId: 'A1', op: 'forward', from: { q, r: 0 }, to: { q: q + 1, r: 0 }, facing: 0, cost: 1, mpLeft: 3 })
    const move = soundsForBeat(beat({ kind: 'move', baseMs: 360, events: [step(0), step(1)], unitIds: ['A1'], tweens: [{ unitId: 'A1', kind: 'walk', keys: [] }] }), { state, perspective: 'A' })
    expect(move.map((s) => s.id)).toEqual(['mv-step-assault', 'mv-step-assault'])
    const impacts = new Map<number | string, string>()
    const fire = beat({ kind: 'fire', fx: { kind: 'fire', attackId: 'x7', attackerId: 'A1', targetId: 'B1', attack: 'ranged', mountId: null, weaponId: 'is.w.srm-6', hit: true, tn: 7, roll: 8 } })
    expect(soundsForBeat(fire, { state, impacts })[0]!.id).toBe('wp-srm')
    const hit = beat({ kind: 'hit', fx: { kind: 'hit', unitId: 'B1', location: 'CT', side: 'front', damage: 4, attackId: 'x7' }, events: [se({ type: 'DamageApplied', unitId: 'B1', armorBefore: 10, armorAfter: 6, structureBefore: 8, structureAfter: 8 })] })
    expect(soundsForBeat(hit, { state, impacts }).map((s) => s.id)).toContain('wp-missile-impact')
  })

  it('heat warning and cockpit voice only for the human side', () => {
    const heat = (unitId: string) => beat({ kind: 'heat', fx: { kind: 'heat', unitId, before: 10, after: 20 } })
    const mine = soundsForBeat(heat('A1'), { state, perspective: 'A' }).map((s) => s.id)
    expect(mine).toContain('ht-warning')
    expect(mine).toContain('cmp-heat-critical')
    expect(soundsForBeat(heat('B1'), { state, perspective: 'A' })).toEqual([])
    expect(soundsForBeat(beat({ kind: 'heat', fx: { kind: 'heat', unitId: 'A1', before: 4, after: 13 } }), { state, perspective: 'A' }).map((s) => s.id)).not.toContain('ht-warning')
  })

  it('narrates phases, shutdown and destruction; every emitted id exists', () => {
    const phase = soundsForBeat(beat({ kind: 'banner', events: [se({ type: 'PhaseStarted', phase: 'rangedAttack', turn: 1 })] }))
    expect(phase.map((s) => s.id)).toEqual(['nar-ranged'])
    const all = [
      ...phase,
      ...soundsForBeat(beat({ kind: 'shutdown', fx: { kind: 'shutdown', unitId: 'A1', on: false } }), { state, perspective: 'A' }),
      ...soundsForBeat(beat({ kind: 'destroyed', fx: { kind: 'destroyed', unitId: 'B1' } })),
      ...soundsForBeat(beat({ kind: 'explosion', events: [se({ type: 'AmmoExploded' })] })),
      ...soundsForBeat(beat({ kind: 'banner', events: [se({ type: 'GameEnded', result: { winner: 'B', reason: 'eliminate', turn: 3 } })] }), { perspective: 'A' }),
    ]
    expect(all.map((s) => s.id)).toContain('nar-defeat')
    for (const s of all) expect(AUDIO_BY_ID[s.id], s.id).toBeDefined()
  })

  it('end music scene follows the human seat; settings sanitize', () => {
    expect(endScene('A', 'A')).toBe('victory')
    expect(endScene('B', 'A')).toBe('defeat')
    expect(sanitizeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS)
    expect(sanitizeAudioSettings({ master: 7, sfx: -1, voice: Number.NaN, muted: true })).toEqual({ ...DEFAULT_AUDIO_SETTINGS, master: 1, sfx: 0, muted: true })
  })
})
