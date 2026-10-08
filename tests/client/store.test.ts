// Client core (50 §3, §15, §16): GameRunner store, presentation director, bot driver, autosave, test hooks.
// Headless: no React, no DOM. Animation speed 0 makes the director drain synchronously.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ROLL_PURPOSES, type Action, type GameEvent } from '../../src/engine/index'
import {
  AUTOSAVE_KEY, EVENT_LOG_LIMIT, autosave, continueGame, dispatch, hasAutosave, installAutosave, legalFor, newGame, resetGameStore,
  useGameStore,
} from '../../src/client/store/gameStore'
import { getStorage, memoryStorage, readJson, setStorage, writeJson } from '../../src/client/store/storage'
import { useSettingsStore } from '../../src/client/store/settingsStore'
import { useUiStore } from '../../src/client/store/uiStore'
import { createBotDriver, loadBotBrain } from '../../src/client/bot/botDriver'
beforeAll(async () => { await loadBotBrain() })
import { usePresentedStore } from '../../src/client/presentation/presentedStore'
import { setDirectorClock, setPaused, skipAll, skipBeat, type DirectorClock } from '../../src/client/presentation/director'
import { useAnnounceStore } from '../../src/client/presentation/announceStore'
import { BEAT_MS, buildBeats, type SeqEvent } from '../../src/client/presentation/beats'
import { ROLL_PURPOSE_LABELS, formatOdds } from '../../src/client/presentation/labels'
import { createTestApi, setupFromUrl } from '../../src/client/store/testHooks'
import { findReachEntry, game, queryReach, uiActions } from '../../src/client/contract'

const INTRO = { mission: 'mission.intro', turnLimit: 30 } as const

/** Manual clock: timers fire only when advance() passes them. */
function manualClock(): DirectorClock & { advance(ms: number): void; t: number; pending(): number } {
  let t = 0, id = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    get t() { return t },
    now: () => t,
    setTimeout(fn, ms) { const h = ++id; timers.set(h, { at: t + ms, fn }); return h },
    clearTimeout(h) { timers.delete(h as number) },
    pending: () => timers.size,
    advance(ms) {
      const end = t + ms
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null
        for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e
        if (!next) break
        timers.delete(next[0])
        t = next[1].at
        next[1].fn()
      }
      t = end
    },
  }
}

beforeEach(() => {
  setStorage(memoryStorage())
  setDirectorClock(null)
  useSettingsStore.getState().set({ speed: 0, narration: true })
  setPaused(false)
  resetGameStore()
})
afterEach(() => {
  setDirectorClock(null)
  setPaused(false)
})

describe('client store: bot vs bot through the store', () => {
  it('plays a whole game headless; the presented state ends equal to the true state', () => {
    expect(newGame({ ...INTRO, controllers: { A: 'bot', B: 'bot' }, seed: 'store-1' })).toBeNull()
    const offAutosave = installAutosave()
    const driver = createBotDriver({ thinkMs: 0 })
    let steps = 0
    let autosaved = false
    for (; steps < 6000; steps++) {
      const g = useGameStore.getState()
      if (g.pending?.kind === 'gameOver') break
      const r = driver.tick()
      expect(r, `tick ${steps} on ${g.pending?.kind}`).toBe('answered')
      expect(useGameStore.getState().fatal).toBeNull()
      // the presented state never runs ahead: at speed 0 it is the true state after every step
      expect(usePresentedStore.getState().state).toBe(useGameStore.getState().state)
      if (!autosaved && getStorage().getItem(AUTOSAVE_KEY)) autosaved = true
    }
    offAutosave()
    const g = useGameStore.getState()
    const p = usePresentedStore.getState()
    expect(g.pending?.kind).toBe('gameOver')
    expect(g.state?.phase).toBe('ended')
    expect(g.state?.result).toBeTruthy()
    expect(driver.forced).toBe(0)
    // presentation caught up exactly
    expect(p.idle).toBe(true)
    expect(p.state).toBe(g.state)
    expect(p.cursor).toBe(g.eventSeq)
    expect(p.beat).toBeNull()
    expect(Object.keys(p.tweens)).toHaveLength(0)
    // logs
    expect(steps).toBeGreaterThan(30)
    expect(g.events.length).toBe(Math.min(g.eventSeq, EVENT_LOG_LIMIT))
    expect(g.events[g.events.length - 1]!.seq).toBe(g.eventSeq)
    expect(p.diceLog.length).toBeGreaterThan(10)
    expect(p.diceLog.every((r) => r.label.length > 0)).toBe(true)
    expect(p.feed.every((f) => f.text.length > 0)).toBe(true)
    const lines = useAnnounceStore.getState().lines
    expect(lines.some((l) => /wins|draw/i.test(l.text))).toBe(true)
    // end-screen tallies come from event numbers
    expect(g.stats.A.damageTaken + g.stats.B.damageTaken).toBeGreaterThan(0)
    expect(g.stats.A.damageDealt).toBe(g.stats.B.damageTaken - selfDamage(g.events.map((e) => e.event), g.state!, 'B'))
    // autosave happened during play and was cleared when the battle ended; the bot does not answer gameOver
    expect(autosaved).toBe(true)
    expect(hasAutosave()).toBe(false)
    expect(driver.tick()).toBe('notBot')
  })
})

/** Damage a side took from no enemy source (falls, own ammo): not counted as dealt by the other side. */
function selfDamage(events: GameEvent[], state: NonNullable<ReturnType<typeof useGameStore.getState>['state']>, victim: 'A' | 'B'): number {
  let n = 0
  for (const e of events) {
    if (e.type !== 'DamageApplied' || state.units[e.unitId]?.owner !== victim) continue
    const by = e.sourceUnitId ? state.units[e.sourceUnitId]?.owner : null
    if (by && by !== victim) continue
    n += e.armorBefore - e.armorAfter + (e.structureBefore - e.structureAfter)
  }
  return n
}

describe('client store: dispatch, rejections and decisions', () => {
  it('rejects with our words and keeps the state; an accepted step clears the rejection', () => {
    newGame({ ...INTRO, controllers: { A: 'human', B: 'human' }, seed: 'rej-1' })
    const s0 = useGameStore.getState().state!
    const rej = dispatch({ type: 'ack', decisionId: 'd:bogus', player: s0.pending.player } as Action)
    expect(rej?.code).toBe('E_WRONG_DECISION')
    expect(rej?.text).toMatch(/current question/)
    expect(useGameStore.getState().state).toBe(s0)
    expect(dispatch(legalFor(s0)[0]!)).toBeNull()
    expect(useGameStore.getState().lastRejection).toBeNull()
    expect(useGameStore.getState().state).not.toBe(s0)
  })

  it("refuses a human answer to the bot's decision, but the test hook may answer it", () => {
    newGame({ ...INTRO, controllers: { A: 'bot', B: 'bot' }, seed: 'own-1' })
    const s0 = useGameStore.getState().state!
    expect(game.dispatch(legalFor(s0)[0]!)?.code).toBe('E_NOT_YOUR_DECISION')
    expect(useGameStore.getState().state).toBe(s0)
    expect(createTestApi().dispatch(legalFor(s0)[0]!)).toBeNull()
  })

  it('a bad setup is refused and leaves no game', () => {
    expect(newGame({ mission: 'mission.nope' })?.code).toBe('E_BAD_SETUP')
    expect(useGameStore.getState().state).toBeNull()
  })

  it('a human move goes through the engine reach set and the move draft (no client-built actions)', () => {
    newGame({ ...INTRO, controllers: { A: 'human', B: 'human' }, seed: 'move-1' })
    for (let i = 0; i < 50 && useGameStore.getState().pending?.kind !== 'move'; i++) expect(dispatch(legalFor(useGameStore.getState().state)[0]!)).toBeNull()
    const p = useGameStore.getState().pending!
    expect(p.kind).toBe('move')
    const reach = queryReach(p.unitId!)
    expect(reach.length).toBeGreaterThan(1)
    const target = reach.find((e) => e.mode === 'walk' && !e.physical && e.hexesMoved > 0)!
    uiActions.setMoveDraft({ mode: 'walk', hex: target.hex, facing: target.facing, attack: false })
    expect(findReachEntry(reach, useUiStore.getState().move)).toBe(target)
    expect(game.commitMoveDraft()).toBeNull()
    const u = useGameStore.getState().state!.units[p.unitId!]!
    expect(u.pos).toEqual(target.hex)
    expect(u.facing).toBe(target.facing)
  })
})

describe('presentation director', () => {
  it('plays beats in time order (phase banner 2.4 s, turn 1.6 s at speed 1, halved at speed 2) and skipAll reaches the true state', () => {
    const clock = manualClock()
    setDirectorClock(clock)
    useSettingsStore.getState().set({ speed: 1 })
    newGame({ ...INTRO, controllers: { A: 'human', B: 'human' }, seed: 'dir-1' })
    const g = useGameStore.getState()
    // the opening batch: GameStarted, TurnStarted (banner), PhaseStarted (banner), initiative dice
    expect(usePresentedStore.getState().idle).toBe(false)
    expect(usePresentedStore.getState().beat?.kind).toBe('banner')
    expect(useAnnounceStore.getState().banner?.text).toBe('Turn 1')
    expect(usePresentedStore.getState().beat?.durationMs).toBe(BEAT_MS.turn)
    clock.advance(BEAT_MS.turn)
    expect(useAnnounceStore.getState().banner?.text).toBe('Initiative Phase')
    expect(usePresentedStore.getState().beat?.durationMs).toBe(BEAT_MS.phase)
    // never ahead of the cursor: the presented state is not the true one until the batch finishes
    expect(usePresentedStore.getState().cursor).toBeLessThan(g.eventSeq)
    expect(usePresentedStore.getState().state).not.toBe(g.state)
    skipBeat()
    expect(usePresentedStore.getState().beat?.kind).toBe('initiative')
    expect(usePresentedStore.getState().rolls.length).toBeGreaterThanOrEqual(2)
    skipAll()
    expect(usePresentedStore.getState().idle).toBe(true)
    expect(usePresentedStore.getState().state).toBe(useGameStore.getState().state)
    expect(usePresentedStore.getState().cursor).toBe(useGameStore.getState().eventSeq)
    // speed 2 halves the next banner
    useSettingsStore.getState().set({ speed: 2 })
    expect(dispatch(legalFor(useGameStore.getState().state)[0]!)).toBeNull() // initiativeAck -> Movement Phase banner
    expect(usePresentedStore.getState().beat?.durationMs).toBe(BEAT_MS.phase / 2)
    clock.advance(10_000)
    expect(usePresentedStore.getState().idle).toBe(true)
  })

  it('a walk becomes one tween with keys per hex and hexside turn (180 / 90 ms at speed 1)', () => {
    newGame({ ...INTRO, controllers: { A: 'human', B: 'human' }, seed: 'tween-1' })
    for (let i = 0; i < 50 && useGameStore.getState().pending?.kind !== 'move'; i++) dispatch(legalFor(useGameStore.getState().state)[0]!)
    const before = useGameStore.getState().state!
    const entry = queryReach(before.pending.unitId!).find((e) => e.mode === 'walk' && !e.physical && e.hexesMoved >= 2)!
    const seq0 = useGameStore.getState().eventSeq
    expect(game.commitMove(entry)).toBeNull()
    const events: SeqEvent[] = useGameStore.getState().events.filter((e) => e.seq > seq0)
    const beats = buildBeats(before, events)
    const move = beats.find((b) => b.kind === 'move')!
    const steps = events.filter((e) => e.event.type === 'UnitStepped').map((e) => e.event as Extract<GameEvent, { type: 'UnitStepped' }>)
    const want = steps.reduce((ms, s) => ms + (s.from.q !== s.to.q || s.from.r !== s.to.r ? BEAT_MS.hex : BEAT_MS.hexTurn), 0)
    expect(move.baseMs).toBe(want)
    const keys = move.tweens![0]!.keys
    expect(keys[0]!.at).toBe(0)
    expect(keys[keys.length - 1]!.at).toBe(1)
    expect(keys[keys.length - 1]!.hex).toEqual(entry.hex)
    expect(keys[keys.length - 1]!.facing).toBe(entry.facing)
  })
})

describe('bot driver', () => {
  it('drives a timed game on its own (subscriptions + timers) without the watchdog, waiting for each beat', () => {
    const clock = manualClock()
    setDirectorClock(clock)
    useSettingsStore.getState().set({ speed: 4 })
    newGame({ ...INTRO, controllers: { A: 'bot', B: 'bot' }, seed: 'timed-1', turnLimit: 3 })
    const driver = createBotDriver({ now: () => clock.t, setTimeout: (fn, ms) => clock.setTimeout(fn, ms), clearTimeout: (h) => clock.clearTimeout(h) })
    driver.start()
    let answeredWhileBusy = 0
    let steps = 0
    // commitStep stores the new state before handing its batch to the director: at that moment every earlier event
    // must already be on screen (the bot only answers an idle presentation)
    const off = useGameStore.subscribe((g, prev) => {
      if (g.version === prev.version || !prev.state) return
      steps++
      if (usePresentedStore.getState().cursor < prev.eventSeq) answeredWhileBusy++
    })
    for (let i = 0; i < 20000 && useGameStore.getState().pending?.kind !== 'gameOver'; i++) clock.advance(250)
    clock.advance(60_000)
    off()
    driver.stop()
    expect(useGameStore.getState().pending?.kind).toBe('gameOver')
    expect(driver.forced).toBe(0)
    expect(steps).toBeGreaterThan(20)
    expect(answeredWhileBusy).toBe(0)
    expect(usePresentedStore.getState().idle).toBe(true)
    expect(usePresentedStore.getState().state).toBe(useGameStore.getState().state)
  })

  it('waits while the presentation plays, then the 5 s watchdog force-answers', () => {
    const clock = manualClock()
    setDirectorClock(clock)
    useSettingsStore.getState().set({ speed: 1 })
    let t = 0
    newGame({ ...INTRO, controllers: { A: 'bot', B: 'bot' }, seed: 'dog-1' })
    const driver = createBotDriver({ now: () => t, setTimeout: () => 0, clearTimeout: () => {}, thinkMs: 0 })
    expect(usePresentedStore.getState().idle).toBe(false)
    const id0 = useGameStore.getState().pending!.id
    expect(driver.tick()).toBe('waiting')
    t = 4999
    expect(driver.tick()).toBe('waiting')
    t = 5000
    expect(driver.tick()).toBe('forced')
    expect(driver.forced).toBe(1)
    expect(useGameStore.getState().pending!.id).not.toBe(id0)
  })
})

describe('autosave, continue and URL setup', () => {
  it('Continue loads the autosave; a version mismatch hides it; a broken slot is deleted', () => {
    newGame({ ...INTRO, controllers: { A: 'human', B: 'bot' }, seed: 'save-1' })
    const driver = createBotDriver({ thinkMs: 0 })
    for (let i = 0; i < 200 && (useGameStore.getState().state?.turn ?? 0) < 2; i++) {
      if (driver.tick() === 'notBot') dispatch(legalFor(useGameStore.getState().state)[0]!)
    }
    expect(autosave()).toBe(true)
    const before = JSON.stringify(useGameStore.getState().state)
    resetGameStore()
    expect(hasAutosave()).toBe(true)
    expect(continueGame()).toBeNull()
    expect(JSON.stringify(useGameStore.getState().state)).toBe(before)
    expect(usePresentedStore.getState().state).toBe(useGameStore.getState().state)
    expect(useGameStore.getState().controllers).toEqual({ A: 'human', B: 'bot' })
    // another build's data: no Continue
    const slot = readJson<{ version: string }>(AUTOSAVE_KEY)!
    writeJson(AUTOSAVE_KEY, { ...slot, version: 'old' })
    expect(hasAutosave()).toBe(false)
    // a slot that matches but cannot replay is deleted with a message
    writeJson(AUTOSAVE_KEY, { ...slot, save: { ...(slot as unknown as { save: object }).save, file: { format: 1, setup: {}, seed: 'x', actions: [{ type: 'ack' }], dataVersion: 'nope', engine: '0', meta: { savedAt: '', label: '' } } } })
    const rej = continueGame()
    expect(rej?.text).toMatch(/removed/)
    expect(getStorage().getItem(AUTOSAVE_KEY)).toBeNull()
  })

  it('reads ?scenario=&forces=&control=&seed=&map= with short ids', () => {
    expect(setupFromUrl('?test=1')).toBeNull()
    const o = setupFromUrl('?scenario=intro&forces=intro-a,intro-b&control=bot,bot&seed=7&map=test-canyons&bot=random')!
    expect(o).toEqual({ mission: 'mission.intro', forces: ['force.intro-a', 'force.intro-b'], map: 'map.test-canyons', controllers: { A: 'bot', B: 'bot' }, bot: { tier: 'random' }, seed: '7' })
    expect(newGame(o)).toBeNull()
    expect(useGameStore.getState().state?.seed).toBe('7')
  })
})

describe('labels', () => {
  it('every engine roll purpose has a tray label; odds never print 0% or 100%', () => {
    for (const p of ROLL_PURPOSES) expect(ROLL_PURPOSE_LABELS[p], p).toBeTruthy()
    expect(formatOdds(1, 2)).toBe('auto')
    expect(formatOdds(0, 13)).toBe('impossible')
    expect(formatOdds(35 / 36, 3)).toBe('97%')
    expect(formatOdds(0.999, 3)).toBe('>99%')
    expect(formatOdds(0.001, 12)).toBe('<1%')
  })
})
