// 'Surroundings' setting (Game shop / Plain). The HUD settings popover imports { useSurroundings, setSurroundings,
// SURROUNDINGS_OPTIONS } from here. Low graphics always resolves to Plain (useEffectiveSurroundings).
import { create } from 'zustand'
import { readJson, writeJson } from '../store/storage'
import { useSettingsStore } from '../store/settingsStore'

export type Surroundings = 'shop' | 'plain'
export const SURROUNDINGS_KEY = 'wmf.surroundings'
export const SURROUNDINGS_OPTIONS: ReadonlyArray<{ value: Surroundings; label: string; hint: string }> = [
  { value: 'shop', label: 'Game shop', hint: 'Play on a table inside a cosy hobby shop.' },
  { value: 'plain', label: 'Plain', hint: 'Dark, empty surround. Lighter on slow machines.' },
]

interface SurroundingsStore {
  value: Surroundings
  set(v: Surroundings): void
  reload(): void
}
const sane = (v: unknown): Surroundings => (v === 'plain' ? 'plain' : 'shop')

export const useSurroundingsStore = create<SurroundingsStore>((set) => ({
  value: sane(readJson<Surroundings>(SURROUNDINGS_KEY)),
  set(v) { const s = sane(v); set({ value: s }); writeJson(SURROUNDINGS_KEY, s) },
  reload() { set({ value: sane(readJson<Surroundings>(SURROUNDINGS_KEY)) }) },
}))

/** The player's choice (not forced by graphics tier). Default 'shop'. */
export const useSurroundings = (): Surroundings => useSurroundingsStore((s) => s.value)
export const setSurroundings = (v: Surroundings): void => useSurroundingsStore.getState().set(v)
/** True when Low graphics forces Plain, so the popover can grey the control out. */
export const useSurroundingsForced = (): boolean => useSettingsStore((s) => s.graphics === 'low')
/** What actually renders: Plain when graphics is Low, else the choice. */
export function resolveSurroundings(choice: Surroundings, graphics: 'low' | 'high'): Surroundings {
  return graphics === 'low' ? 'plain' : choice
}
export function useEffectiveSurroundings(): Surroundings {
  const choice = useSurroundingsStore((s) => s.value)
  const graphics = useSettingsStore((s) => s.graphics)
  return resolveSurroundings(choice, graphics)
}
