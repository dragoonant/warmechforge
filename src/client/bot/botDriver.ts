// Bot driver (50 §3, 40-ai §14): answers bot-owned decisions through gameStore.dispatch, only while the presentation is
// idle, so the bot never acts over an animation the player has not seen. A watchdog force-answers (skips the
// presentation, then the first legal action) when a bot decision has made no progress for WATCHDOG_MS.
// Tiers: 'random' plays src/ai/random.ts on the main thread; 'easy' and 'normal' are the utility AI (src/ai/decider.ts), run
// in a Web Worker when the browser has one (so a decision never blocks a frame) and on the main thread otherwise. A worker
// error or timeout answers that decision with the random bot.
import { view, type Action, type GameState, type PendingDecision } from '../../engine/index'
import { isPresentationIdle, usePresentedStore } from '../presentation/presentedStore'
import { skipAll } from '../presentation/director'
import { dispatch, isBotDecision, legalFor, useGameStore, type BotTier } from '../store/gameStore'
import { scaled, useSettingsStore } from '../store/settingsStore'
import { createAiWorkerClient, type AiWorkerClient } from './aiWorkerClient'
import { publishTrace } from './traceStore'

export const WATCHDOG_MS = 5000
/** Pause before the bot answers at speed 1, so a human can follow along (scaled by speed; 0 when instant). */
export const BOT_THINK_MS = 300

// The AI lives in its own chunk (code split from the start screen and the board): loaded on first need, then synchronous.
interface Brain {
  random: typeof import('../../ai/random').decideRandom
  ai: typeof import('../../ai/decider').decideAi
}
let brain: Brain | null = null
let brainLoad: Promise<Brain> | null = null
const brainListeners = new Set<() => void>()
/** Load the bot's decision code (idempotent). Tests await it before ticking a driver. */
export function loadBotBrain(): Promise<Brain> {
  brainLoad ??= Promise.all([import('../../ai/random'), import('../../ai/decider')]).then(([r, d]) => {
    brain = { random: r.decideRandom, ai: d.decideAi }
    for (const f of brainListeners) f()
    return brain
  })
  return brainLoad
}
export const botBrainReady = (): boolean => brain !== null

export const isAiTier = (t: BotTier): t is 'easy' | 'normal' => t === 'easy' || t === 'normal'

/** Random-bot answer (synchronous; the brain must be loaded). First legal action if the bot throws. */
function randomAnswer(state: GameState, pending: PendingDecision, legal: Action[], seed: string): Action {
  try {
    if (!brain) return legal[0]!
    return brain.random(view(state, pending.player), pending, legal, `${seed}|${pending.player}`)
  } catch {
    return legal[0]!
  }
}

/** Pick an answer for a bot decision on the main thread (sim, tests, no-worker fallback). Falls back to the random bot. */
export function chooseBotAction(state: GameState, pending: PendingDecision, legal: Action[], seed: string, tier: BotTier = 'random'): Action {
  if (!brain) return legal[0]!
  if (isAiTier(tier)) {
    try {
      const d = brain.ai(view(state, pending.player), pending, legal, { tier, trace: true })
      publishTrace(d.trace, { seed: state.seed, turn: state.turn, phase: state.phase, player: pending.player })
      return d.action
    } catch {
      return randomAnswer(state, pending, legal, seed)
    }
  }
  return randomAnswer(state, pending, legal, seed)
}

export interface BotDriverOptions {
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (h: unknown) => void
  watchdogMs?: number
  thinkMs?: number
  /** AI worker for the easy/normal tiers; null = always decide on the main thread. Default: a worker when available. */
  worker?: AiWorkerClient | null
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
  /** Count of decisions the random bot answered because the AI worker failed or timed out. */
  readonly fallbacks: number
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
  let fallbacks = 0
  let running = false
  let stopped = false // stop() drops worker answers that arrive later; tick() without start() still answers
  let unsubs: (() => void)[] = []
  let tickTimer: unknown = null
  let dogTimer: unknown = null
  let worker: AiWorkerClient | null | undefined = opts.worker
  let inflight: string | null = null // `${version}:${decision id}` the worker is thinking about

  function decisionKey(): string | null {
    const s = useGameStore.getState()
    return s.pending ? `${s.version}:${s.pending.id}` : null
  }
  function noteDecision(): void {
    const id = decisionKey()
    if (id !== seenDecision) { seenDecision = id; since = now() }
  }

  /** Ask the worker; the answer is dispatched when it comes back, if the same decision is still open. */
  function answerAsync(w: AiWorkerClient, tier: 'easy' | 'normal'): boolean {
    const s = useGameStore.getState()
    if (!s.state || !s.pending) return false
    const key = decisionKey()
    if (inflight === key) return true
    inflight = key
    const state = s.state
    const pending = s.pending
    const legal = legalFor(state)
    void w.decide(state, legal, tier).then((a) => {
      if (inflight === key) inflight = null
      const cur = useGameStore.getState()
      if (stopped || !cur.state || decisionKey() !== key || !isBotDecision(cur)) return
      if (!a) fallbacks++
      const pick = a ?? randomAnswer(state, pending, legal, cur.bot.seed)
      let rej = dispatch(pick, 'bot')
      if (rej && legal[0] && pick !== legal[0]) rej = dispatch(legal[0], 'watchdog')
    })
    return true
  }

  function answer(force: boolean): boolean {
    const s = useGameStore.getState()
    if (!s.state || !s.pending) return false
    const legal = legalFor(s.state)
    if (!legal.length) return false
    const tier = s.bot.tier
    if (!force && isAiTier(tier)) {
      if (worker === undefined) worker = createAiWorkerClient()
      if (worker && !worker.broken) return answerAsync(worker, tier)
    }
    const pick = force ? legal[0]! : chooseBotAction(s.state, s.pending, legal, s.bot.seed, tier)
    let rej = dispatch(pick, force ? 'watchdog' : 'bot')
    if (rej && pick !== legal[0]) rej = dispatch(legal[0]!, 'watchdog')
    return !rej
  }

  function tick(): 'answered' | 'forced' | 'waiting' | 'notBot' {
    noteDecision()
    const s = useGameStore.getState()
    if (s.fatal || !isBotDecision(s)) return 'notBot'
    if (inflight !== null && inflight === decisionKey() && now() - since < watchdogMs) return 'waiting'
    if (!brain) { void loadBotBrain() }
    else if (isPresentationIdle()) {
      const ok = answer(false)
      return ok && inflight !== decisionKey() ? 'answered' : 'waiting'
    }
    if (now() - since >= watchdogMs) {
      forced++
      console.warn('[bot] watchdog force-answer', {
        kind: s.pending?.kind, turn: s.state?.turn, ms: Math.round(now() - since), idle: isPresentationIdle(), brain: !!brain,
        thinking: inflight !== null && inflight === decisionKey(),
      })
      skipAll()
      inflight = null
      return answer(true) ? 'forced' : 'waiting'
    }
    return 'waiting'
  }

  function schedule(): void {
    if (!running || tickTimer !== null) return
    const s = useGameStore.getState()
    if (!isBotDecision(s) || !isPresentationIdle() || !brain) return
    if (inflight !== null && inflight === decisionKey()) return // the worker's answer re-schedules through the store
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
      stopped = false
      noteDecision()
      const onBrain = () => { if (running) schedule() }
      brainListeners.add(onBrain)
      void loadBotBrain()
      unsubs = [
        () => { brainListeners.delete(onBrain) },
        useGameStore.subscribe((s, prev) => { if (s.pending !== prev.pending || s.controllers !== prev.controllers || s.version !== prev.version) { schedule(); armWatchdog() } }),
        usePresentedStore.subscribe((s, prev) => {
          // a presentation that is still playing beats is progress: the watchdog only counts time with nothing moving
          // (a long ranged-phase replay at low speed used to eat the whole budget before the bot was even asked)
          if (s.rev !== prev.rev && !s.paused && isBotDecision()) since = now()
          if (s.idle !== prev.idle && s.idle) schedule()
        }),
      ]
      schedule()
      armWatchdog()
    },
    stop() {
      running = false
      stopped = true
      inflight = null
      for (const u of unsubs) u()
      unsubs = []
      if (tickTimer !== null) clearT(tickTimer)
      if (dogTimer !== null) clearT(dogTimer)
      tickTimer = null
      dogTimer = null
    },
    get running() { return running },
    get forced() { return forced },
    get fallbacks() { return fallbacks },
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
