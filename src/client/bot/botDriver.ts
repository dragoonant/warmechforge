// Bot driver (50 §3, 40-ai): answers bot-owned decisions through gameStore.dispatch, only while the presentation is
// idle, so the bot never acts over an animation the player has not seen. A watchdog force-answers (skips the
// presentation, then the first legal action) when a bot decision has made no progress for WATCHDOG_MS.
// M3 tiers: every tier plays the random bot (src/ai/random.ts); the utility AI (M4) plugs in at chooseBotAction.
import { view, type Action, type GameState, type PendingDecision } from '../../engine/index'
import { isPresentationIdle, usePresentedStore } from '../presentation/presentedStore'
import { skipAll } from '../presentation/director'
import { dispatch, isBotDecision, legalFor, useGameStore, type BotTier } from '../store/gameStore'
import { scaled, useSettingsStore } from '../store/settingsStore'

export const WATCHDOG_MS = 5000
/** Pause before the bot answers at speed 1, so a human can follow along (scaled by speed; 0 when instant). */
export const BOT_THINK_MS = 300

// The AI lives in its own chunk (code split from the start screen and the board): loaded on first need, then synchronous.
type Brain = typeof import('../../ai/random').decideRandom
let brain: Brain | null = null
let brainLoad: Promise<Brain> | null = null
const brainListeners = new Set<() => void>()
/** Load the bot's decision code (idempotent). Tests await it before ticking a driver. */
export function loadBotBrain(): Promise<Brain> {
  brainLoad ??= import('../../ai/random').then((m) => { brain = m.decideRandom; for (const f of brainListeners) f(); return brain })
  return brainLoad
}
export const botBrainReady = (): boolean => brain !== null

/** Pick an answer for a bot decision (synchronous; the brain must be loaded). Falls back to the first legal action if the bot throws. */
export function chooseBotAction(state: GameState, pending: PendingDecision, legal: Action[], seed: string, _tier: BotTier = 'random'): Action {
  try {
    if (!brain) return legal[0]!
    return brain(view(state, pending.player), pending, legal, `${seed}|${pending.player}`)
  } catch {
    return legal[0]!
  }
}

export interface BotDriverOptions {
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (h: unknown) => void
  watchdogMs?: number
  thinkMs?: number
}

export interface BotDriver {
  /** Answer one bot decision if allowed right now. Returns what happened. */
  tick(): 'answered' | 'forced' | 'waiting' | 'notBot'
  /** Subscribe to the stores and keep answering until stop(). */
  start(): void
  stop(): void
  readonly running: boolean
  /** Count of watchdog force-answers since creation. */
  readonly forced: number
}

export function createBotDriver(opts: BotDriverOptions = {}): BotDriver {
  const now = opts.now ?? (() => Date.now())
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clearT = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const watchdogMs = opts.watchdogMs ?? WATCHDOG_MS
  const thinkMs = opts.thinkMs ?? BOT_THINK_MS

  let seenDecision: string | null = null
  let since = now()
  let forced = 0
  let running = false
  let unsubs: (() => void)[] = []
  let tickTimer: unknown = null
  let dogTimer: unknown = null

  function noteDecision(): void {
    const s = useGameStore.getState()
    const id = s.pending ? `${s.version}:${s.pending.id}` : null
    if (id !== seenDecision) { seenDecision = id; since = now() }
  }

  function answer(force: boolean): boolean {
    const s = useGameStore.getState()
    if (!s.state || !s.pending) return false
    const legal = legalFor(s.state)
    if (!legal.length) return false
    const pick = force ? legal[0]! : chooseBotAction(s.state, s.pending, legal, s.bot.seed, s.bot.tier)
    let rej = dispatch(pick, force ? 'watchdog' : 'bot')
    if (rej && pick !== legal[0]) rej = dispatch(legal[0]!, 'watchdog')
    return !rej
  }

  function tick(): 'answered' | 'forced' | 'waiting' | 'notBot' {
    noteDecision()
    const s = useGameStore.getState()
    if (s.fatal || !isBotDecision(s)) return 'notBot'
    if (!brain) { void loadBotBrain(); }
    else if (isPresentationIdle()) return answer(false) ? 'answered' : 'waiting'
    if (now() - since >= watchdogMs) {
      forced++
      skipAll()
      return answer(true) ? 'forced' : 'waiting'
    }
    return 'waiting'
  }

  function schedule(): void {
    if (!running || tickTimer !== null) return
    const s = useGameStore.getState()
    if (!isBotDecision(s) || !isPresentationIdle() || !brain) return
    tickTimer = setT(() => { tickTimer = null; if (running) { tick(); schedule() } }, scaled(thinkMs, useSettingsStore.getState().speed))
  }

  function armWatchdog(): void {
    if (dogTimer !== null) clearT(dogTimer)
    dogTimer = null
    if (!running) return
    noteDecision()
    if (!isBotDecision()) return
    const left = Math.max(0, since + watchdogMs - now())
    dogTimer = setT(() => { dogTimer = null; if (running) { tick(); schedule(); armWatchdog() } }, left + 1)
  }

  return {
    tick,
    start() {
      if (running) return
      running = true
      noteDecision()
      const onBrain = () => { if (running) schedule() }
      brainListeners.add(onBrain)
      void loadBotBrain()
      unsubs = [
        () => { brainListeners.delete(onBrain) },
        useGameStore.subscribe((s, prev) => { if (s.pending !== prev.pending || s.controllers !== prev.controllers || s.version !== prev.version) { schedule(); armWatchdog() } }),
        usePresentedStore.subscribe((s, prev) => { if (s.idle !== prev.idle && s.idle) schedule() }),
      ]
      schedule()
      armWatchdog()
    },
    stop() {
      running = false
      for (const u of unsubs) u()
      unsubs = []
      if (tickTimer !== null) clearT(tickTimer)
      if (dogTimer !== null) clearT(dogTimer)
      tickTimer = null
      dogTimer = null
    },
    get running() { return running },
    get forced() { return forced },
  }
}

let appDriver: BotDriver | null = null
/** The app's single driver (started by bootClient). */
export function startBotDriver(): BotDriver {
  appDriver ??= createBotDriver()
  appDriver.start()
  return appDriver
}
export function stopBotDriver(): void { appDriver?.stop() }
