// State AS OF THE ANIMATION CURSOR (50 §3). Everything on screen renders from here; panels never show a number
// ahead of its animation. The director (director.ts) is the only writer. Arrays are replaced, never mutated, so
// selectors can return them directly.
import { create } from 'zustand'
import type { DiceRolled, GameEvent, GameState, UnitId } from '../../engine/index'
import type { BeatFx, BeatKind, PopSpec, TweenKey, TweenKind } from './beats'

export interface UnitTween {
  unitId: UnitId
  kind: TweenKind
  keys: TweenKey[] // keyframes, `at` = fraction of the beat
  startedAt: number // director clock ms
  durationMs: number
}

export interface ActiveBeat {
  id: number
  kind: BeatKind
  startedAt: number
  durationMs: number
  firstSeq: number
  lastSeq: number
  unitIds: UnitId[]
  fx: BeatFx | null
}

export interface ShownRoll { seq: number; event: DiceRolled; label: string; verdict: string | null; startedAt: number; durationMs: number }

export interface DamagePop extends PopSpec { id: number; startedAt: number; durationMs: number }

/** One event shown so far, with the engine's own sentence for it (describe.event). */
export interface FeedEntry { seq: number; event: GameEvent; text: string; turn: number }

export const FEED_LIMIT = 2000
export const DICE_LOG_LIMIT = 2000

export interface PresentedState {
  /** Engine state at the animation cursor; null before a game exists. */
  state: GameState | null
  /** Seq of the last event shown. */
  cursor: number
  /** True when nothing is queued or playing. Prompts and the bot wait for this. */
  idle: boolean
  /** Presentation paused (menu open, debugging). The bot watchdog still runs. */
  paused: boolean
  beat: ActiveBeat | null
  tweens: Record<UnitId, UnitTween>
  /** Last roll shown (stays in the tray after its beat; `beat?.kind` says whether it is still rolling). */
  roll: ShownRoll | null
  /** Every roll of the current / last rolling beat (initiative shows both sides). */
  rolls: ShownRoll[]
  pops: DamagePop[]
  /** Every roll shown so far this game, oldest first (ring of DICE_LOG_LIMIT). */
  diceLog: ShownRoll[]
  /** Every event shown so far, oldest first (ring of FEED_LIMIT). */
  feed: FeedEntry[]
  /** Bumped on every presented change: frameloop="demand" canvases invalidate on it. */
  rev: number
}

export const INITIAL_PRESENTED: PresentedState = {
  state: null, cursor: 0, idle: true, paused: false, beat: null, tweens: {}, roll: null, rolls: [], pops: [], diceLog: [], feed: [], rev: 0,
}

export const usePresentedStore = create<PresentedState>(() => ({ ...INITIAL_PRESENTED }))

export function isPresentationIdle(): boolean { return usePresentedStore.getState().idle }
