// Player settings (50 §14), persisted under `wmf.settings`. Every storage access goes through storage.ts (try/catch).
import { create } from 'zustand'
import { readJson, writeJson } from './storage'

/**
 * Animation playback rate. 1 = normal, 2 = twice as fast, 0.5 = half speed.
 * 0 is special: INSTANT, every beat takes no time and batches drain synchronously (tests, "skip all animations").
 */
export type AnimSpeed = number
export const SPEED_PRESETS = { slow: 0.5, normal: 1, fast: 2, faster: 4, instant: 0 } as const
export type SpeedPreset = keyof typeof SPEED_PRESETS

export type GraphicsTier = 'low' | 'high'
export type HexLabelMode = 'hover' | 'always' | 'off'
export type OddsFormat = 'percent' | 'tn'

export interface Settings {
  speed: AnimSpeed
  graphics: GraphicsTier
  /** Narration line per beat (announce store). */
  narration: boolean
  tips: boolean
  hexLabels: HexLabelMode
  grid: boolean
  odds: OddsFormat
}

export const SETTINGS_KEY = 'wmf.settings'
export const DEFAULT_SETTINGS: Settings = {
  speed: 1, graphics: 'high', narration: true, tips: true, hexLabels: 'hover', grid: true, odds: 'percent',
}

function sanitize(raw: Partial<Settings> | null): Settings {
  const s = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return s
  if (typeof raw.speed === 'number' && Number.isFinite(raw.speed) && raw.speed >= 0 && raw.speed <= 8) s.speed = raw.speed
  if (raw.graphics === 'low' || raw.graphics === 'high') s.graphics = raw.graphics
  if (typeof raw.narration === 'boolean') s.narration = raw.narration
  if (typeof raw.tips === 'boolean') s.tips = raw.tips
  if (raw.hexLabels === 'hover' || raw.hexLabels === 'always' || raw.hexLabels === 'off') s.hexLabels = raw.hexLabels
  if (typeof raw.grid === 'boolean') s.grid = raw.grid
  if (raw.odds === 'percent' || raw.odds === 'tn') s.odds = raw.odds
  return s
}

interface SettingsStore extends Settings {
  set(patch: Partial<Settings>): void
  reload(): void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  set(patch) {
    const next = sanitize({ ...pick(get()), ...patch })
    set(next)
    writeJson(SETTINGS_KEY, next)
  },
  reload() { set(sanitize(readJson<Partial<Settings>>(SETTINGS_KEY))) },
}))

export function pick(s: Settings): Settings {
  return { speed: s.speed, graphics: s.graphics, narration: s.narration, tips: s.tips, hexLabels: s.hexLabels, grid: s.grid, odds: s.odds }
}

export function getSettings(): Settings { return pick(useSettingsStore.getState()) }

/** Scale a base duration (ms at speed 1) by the current speed; 0 at instant speed. */
export function scaled(ms: number, speed = useSettingsStore.getState().speed): number {
  if (speed <= 0) return 0
  return Math.round(ms / speed)
}
