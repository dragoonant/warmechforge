// Presentation director (50 §3): plays each engine step's events as timed beats and moves the presented state
// along with them. The engine has already resolved everything; this only paces what the player sees.
//   gameStore (writer of batches) -> enqueueBatch()  ->  beats (beats.ts)  ->  presentedStore / announceStore
// At speed 0 (instant) or after skipAll(), batches drain synchronously with one store commit per pump.
import { describe as engineDescribe, type GameState } from '../../engine/index'
import { getSettings, scaled } from '../store/settingsStore'
import { addNarration, clearBanner, resetAnnouncements, showBanner, type NarrationLine } from './announceStore'
import { applyEvent } from './apply'
import { buildBeats, type Beat, type SeqEvent } from './beats'
import { narrate, rollLabel, rollVerdict } from './labels'
import {
  DICE_LOG_LIMIT, FEED_LIMIT, INITIAL_PRESENTED, usePresentedStore,
  type ActiveBeat, type DamagePop, type FeedEntry, type PresentedState, type ShownRoll, type UnitTween,
} from './presentedStore'

/** One engine step's worth of events. `before`/`after` are the true engine states around it. */
export interface Batch { firstSeq: number; lastSeq: number; before: GameState; after: GameState; events: SeqEvent[] }

export interface DirectorClock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const defaultClock: DirectorClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

let clock: DirectorClock = defaultClock
/** Tests: replace the clock (null restores the real one). Also the clock tweens and pops are timed against. */
export function setDirectorClock(c: DirectorClock | null): void { clock = c ?? defaultClock }
export function directorNow(): number { return clock.now() }

interface Current { batch: Batch; beats: Beat[]; index: number; state: GameState }

const queue: Batch[] = []
let cur: Current | null = null
let timer: unknown = null
let timerBeat: Beat | null = null
let fastForward = false
let pumping = false
let beatSeq = 0
let popSeq = 0

// ---------- draft: changes collected during a pump, committed to the stores in one set ----------
interface Draft { patch: Partial<PresentedState>; feed: FeedEntry[]; dice: ShownRoll[]; lines: NarrationLine[] }
let draft: Draft = { patch: {}, feed: [], dice: [], lines: [] }

function commit(): void {
  const d = draft
  draft = { patch: {}, feed: [], dice: [], lines: [] }
  if (d.lines.length) addNarration(d.lines)
  if (!Object.keys(d.patch).length && !d.feed.length && !d.dice.length) return
  usePresentedStore.setState((s) => ({
    ...d.patch,
    feed: d.feed.length ? [...s.feed, ...d.feed].slice(-FEED_LIMIT) : s.feed,
    diceLog: d.dice.length ? [...s.diceLog, ...d.dice].slice(-DICE_LOG_LIMIT) : s.diceLog,
    rev: s.rev + 1,
  }))
}

/** Read a field as it will be after the pending commit. */
function peek<K extends keyof PresentedState>(k: K): PresentedState[K] {
  return (k in draft.patch ? draft.patch[k] : usePresentedStore.getState()[k]) as PresentedState[K]
}

// ---------- beats ----------
function lastSeqOf(beat: Beat): number { return beat.events.length ? beat.events[beat.events.length - 1]!.seq : peek('cursor') }

function applyBeatEvents(beat: Beat): void {
  if (!cur) return
  let s = cur.state
  for (const se of beat.events) s = applyEvent(s, se.event)
  cur.state = s
  draft.patch.state = s
  draft.patch.cursor = Math.max(peek('cursor'), lastSeqOf(beat))
}

function describeSafe(state: GameState, se: SeqEvent): string {
  try { return engineDescribe.event(state, se.event) } catch { return se.event.type }
}

function startBeat(beat: Beat, dur: number): void {
  if (!cur) return
  const now = clock.now()
  for (const se of beat.events) {
    draft.feed.push({ seq: se.seq, event: se.event, text: describeSafe(cur.state, se), turn: cur.state.turn })
    const line = narrate(cur.state, se.event)
    if (line) draft.lines.push({ seq: se.seq, text: line })
  }
  if (beat.applyAt === 'start') applyBeatEvents(beat)
  if (beat.rolls?.length) {
    const rollSeq = (r: unknown) => beat.events.find((e) => e.event === r)?.seq ?? beat.events[0]?.seq ?? 0
    const shown: ShownRoll[] = beat.rolls.map((r) => ({ seq: rollSeq(r), event: r, label: rollLabel(cur!.state, r), verdict: rollVerdict(r), startedAt: now, durationMs: dur }))
    draft.patch.rolls = shown
    draft.patch.roll = shown[shown.length - 1]!
    draft.dice.push(...shown)
  }
  if (dur > 0) {
    if (beat.tweens?.length) {
      const tweens: Record<string, UnitTween> = { ...peek('tweens') }
      for (const t of beat.tweens) tweens[t.unitId] = { unitId: t.unitId, kind: t.kind, keys: t.keys, startedAt: now, durationMs: dur }
      draft.patch.tweens = tweens
    }
    if (beat.pops?.length) {
      const live = peek('pops').filter((p) => now < p.startedAt + p.durationMs)
      const added: DamagePop[] = beat.pops.map((p) => ({ ...p, id: ++popSeq, startedAt: now, durationMs: Math.max(dur, 900) }))
      draft.patch.pops = [...live, ...added]
    }
    if (beat.banner) showBanner(beat.banner.text, beat.banner.kind, now, dur, beat.banner.sub)
    const active: ActiveBeat = {
      id: ++beatSeq, kind: beat.kind, startedAt: now, durationMs: dur, firstSeq: beat.events[0]?.seq ?? 0, lastSeq: lastSeqOf(beat),
      unitIds: beat.unitIds, fx: beat.fx ?? null,
    }
    draft.patch.beat = active
  }
}

function endBeat(beat: Beat): void {
  if (beat.applyAt === 'end') applyBeatEvents(beat)
  if (beat.tweens?.length) {
    const t = peek('tweens')
    if (beat.tweens.some((x) => t[x.unitId])) {
      const next = { ...t }
      for (const x of beat.tweens) delete next[x.unitId]
      draft.patch.tweens = next
    }
  }
  if (beat.banner) clearBanner()
  if (peek('beat')) draft.patch.beat = null
}

function finishBatch(): void {
  if (!cur) return
  // snap to the true engine state: the presented state never disagrees once a batch is shown
  draft.patch.state = cur.batch.after
  draft.patch.cursor = Math.max(peek('cursor'), cur.batch.lastSeq)
  cur = null
}

function pump(): void {
  if (pumping) return
  pumping = true
  try {
    for (;;) {
      if (timer !== null) break
      if (peek('paused')) break
      if (!cur) {
        const b = queue.shift()
        if (!b) {
          fastForward = false
          if (!peek('idle')) draft.patch.idle = true
          if (Object.keys(peek('tweens')).length) draft.patch.tweens = {}
          break
        }
        cur = { batch: b, beats: [], index: 0, state: b.before }
        cur.beats = buildBeats(b.before, b.events, { narration: getSettings().narration })
      }
      if (cur.index >= cur.beats.length) { finishBatch(); continue }
      const beat = cur.beats[cur.index]!
      const dur = fastForward ? 0 : scaled(beat.baseMs)
      startBeat(beat, dur)
      if (dur > 0) {
        timerBeat = beat
        timer = clock.setTimeout(() => {
          timer = null
          timerBeat = null
          endBeat(beat)
          if (cur) cur.index++
          pump()
        }, dur)
        break
      }
      endBeat(beat)
      cur.index++
    }
  } finally {
    pumping = false
    commit()
  }
}

// ---------- public API ----------
/** gameStore: queue one step's events for presentation. */
export function enqueueBatch(batch: Batch): void {
  queue.push(batch)
  if (peek('idle')) draft.patch.idle = false
  pump()
}

/** Skip the beat now playing (any click / Space). */
export function skipBeat(): void {
  if (timer === null || !timerBeat) return
  clock.clearTimeout(timer)
  const beat = timerBeat
  timer = null
  timerBeat = null
  endBeat(beat)
  if (cur) cur.index++
  pump()
}

/** Show everything queued at once (Esc); dice and narration still reach their logs. */
export function skipAll(): void {
  fastForward = true
  if (timer !== null) skipBeat()
  else pump()
}

/** Pause / resume playback. */
export function setPaused(paused: boolean): void {
  if (peek('paused') === paused) return
  draft.patch.paused = paused
  commit()
  if (!paused) pump()
}

/** New game or load: drop everything queued and present `state` as of `seq` with no animation. */
export function resetPresentation(state: GameState | null, seq = 0): void {
  if (timer !== null) clock.clearTimeout(timer)
  timer = null
  timerBeat = null
  queue.length = 0
  cur = null
  fastForward = false
  draft = { patch: {}, feed: [], dice: [], lines: [] }
  resetAnnouncements()
  usePresentedStore.setState({ ...INITIAL_PRESENTED, paused: usePresentedStore.getState().paused, state, cursor: seq, rev: usePresentedStore.getState().rev + 1 })
}

/** Batches waiting plus the one playing (diagnostics). */
export function queuedBatches(): number { return queue.length + (cur ? 1 : 0) }
