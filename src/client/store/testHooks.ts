// Test hooks (50 §16): `?test=1` exposes window.__game, and URL params give E2E a fast setup that skips the start screen.
import type { Action, GameState, HexLabel, PendingDecision, PlayerId, SaveFile } from '../../engine/index'
import { skipAll, skipBeat } from '../presentation/director'
import { isPresentationIdle, usePresentedStore } from '../presentation/presentedStore'
import { dispatch, exportSave, importSave, legalFor, newGame, useGameStore, type ClientRejection, type ClientSave } from './gameStore'
import { BOT_TIERS, resolveForceId, resolveMapId, resolveMissionId, type BotTier, type Controller, type NewGameOptions } from './setup'
import { useSettingsStore } from './settingsStore'
import { useUiStore } from './uiStore'

/** Page pixels of a hex centre, registered by the board (the camera lives there). */
export type HexToScreen = (label: HexLabel) => { x: number; y: number } | null
let hexToScreenFn: HexToScreen | null = null
/** Board: register the projector used by window.__game.hexToScreen (pass null on unmount). */
export function registerHexToScreen(fn: HexToScreen | null): void { hexToScreenFn = fn }

export interface GameTestApi {
  state(): GameState | null
  presented(): GameState | null
  pending(): PendingDecision | null
  legal(): Action[]
  /** Dispatch as 'test': allowed for either side's decision. Returns the rejection or null. */
  dispatch(action: Action): ClientRejection | null
  /** Show everything queued at once. */
  skipAll(): void
  /** Animation speed: 1 normal, 2 fast, 0 instant. */
  speed(n: number): void
  presentedIdle(): boolean
  readonly seed: string | null
  load(save: ClientSave | SaveFile): ClientRejection | null
  /** Page pixels of a hex centre (null before the board registers its projector). */
  hexToScreen(label: HexLabel): { x: number; y: number } | null
  // additive extras
  newGame(opts: NewGameOptions): ClientRejection | null
  save(): ClientSave | null
  skip(): void
  events(): { seq: number; type: string }[]
  rejection(): ClientRejection | null
  ui(): ReturnType<typeof useUiStore.getState>
  controllers(): Record<PlayerId, Controller>
}

export function createTestApi(): GameTestApi {
  return {
    state: () => useGameStore.getState().state,
    presented: () => usePresentedStore.getState().state,
    pending: () => useGameStore.getState().pending,
    legal: () => legalFor(useGameStore.getState().state),
    dispatch: (a) => dispatch(a, 'test'),
    skipAll: () => skipAll(),
    speed: (n) => useSettingsStore.getState().set({ speed: n }),
    presentedIdle: () => isPresentationIdle(),
    get seed() { return useGameStore.getState().state?.seed ?? null },
    load: (s) => importSave(s),
    hexToScreen: (label) => (hexToScreenFn ? hexToScreenFn(label) : null),
    newGame: (o) => newGame(o),
    save: () => exportSave('test'),
    skip: () => skipBeat(),
    events: () => useGameStore.getState().events.map((e) => ({ seq: e.seq, type: e.event.type })),
    rejection: () => useGameStore.getState().lastRejection,
    ui: () => useUiStore.getState(),
    controllers: () => useGameStore.getState().controllers,
  }
}

declare global {
  interface Window { __game?: GameTestApi }
}

export function isTestMode(search = typeof location !== 'undefined' ? location.search : ''): boolean {
  return new URLSearchParams(search).get('test') === '1'
}

/** Install window.__game when `?test=1` (or `force`). Idempotent. */
export function installTestHooks(force = false): GameTestApi | null {
  if (typeof window === 'undefined') return null
  if (!force && !isTestMode()) return null
  window.__game ??= createTestApi()
  return window.__game
}

/**
 * Fast setup from the URL (50 §16): `?scenario=mission.intro&forces=force.intro-a,force.intro-b&control=bot,bot&seed=7&map=map.test-canyons`
 * plus `&bot=random` and `&turnLimit=30`. Short ids work ('intro', 'intro-a', 'test-canyons'). Null when the URL names
 * no scenario (show the start screen).
 */
export function setupFromUrl(search = typeof location !== 'undefined' ? location.search : ''): NewGameOptions | null {
  const q = new URLSearchParams(search)
  const scenario = q.get('scenario')
  if (!scenario) return null
  const forces = q.get('forces')?.split(',').map((s) => s.trim()).filter(Boolean)
  const ctl = q.get('control')?.split(',').map((s): Controller => (s.trim() === 'bot' ? 'bot' : 'human'))
  const tier = q.get('bot') as BotTier | null
  const tl = q.get('turnLimit')
  const opts: NewGameOptions = { mission: resolveMissionId(scenario) }
  if (forces && forces.length >= 2) opts.forces = [resolveForceId(forces[0]!), resolveForceId(forces[1]!)]
  if (q.get('map')) opts.map = resolveMapId(q.get('map')!)
  if (ctl?.length) opts.controllers = { A: ctl[0] ?? 'human', B: ctl[1] ?? 'bot' }
  if (tier && BOT_TIERS.includes(tier)) opts.bot = { tier }
  if (q.get('seed')) opts.seed = q.get('seed')!
  if (tl !== null) opts.turnLimit = tl === '' || tl === 'none' ? null : Math.max(1, Math.floor(Number(tl)) || 30)
  return opts
}

/** `?speed=0|0.5|1|2|4` from the URL (E2E runs instant), or null. */
export function speedFromUrl(search = typeof location !== 'undefined' ? location.search : ''): number | null {
  const v = new URLSearchParams(search).get('speed')
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 8 ? n : null
}
