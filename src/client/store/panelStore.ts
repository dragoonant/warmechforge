// Which HUD side rails are collapsed. Display-only; remembered between visits under `wmf.panels` (50 §12: `[` and `]`).
import { create } from 'zustand'
import { readJson, writeJson } from './storage'

export type Rail = 'left' | 'right'
export interface PanelFlags { left: boolean; right: boolean }
export const PANELS_KEY = 'wmf.panels'

/** Anything unreadable falls back to open rails. */
export function sanitizePanels(raw: unknown): PanelFlags {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { left: o.left === true, right: o.right === true }
}

interface PanelStore extends PanelFlags {
  /** Collapse or open one rail (persisted). */
  set(rail: Rail, collapsed: boolean): void
  toggle(rail: Rail): void
  /** Re-read the saved flags. */
  reload(): void
}

const save = (s: PanelFlags): void => writeJson(PANELS_KEY, { left: s.left, right: s.right })

export const usePanelStore = create<PanelStore>((set, get) => ({
  ...sanitizePanels(readJson(PANELS_KEY)),
  set(rail, collapsed) {
    set({ [rail]: collapsed } as unknown as Partial<PanelStore>)
    save(get())
  },
  toggle(rail) { get().set(rail, !get()[rail]) },
  reload() { set(sanitizePanels(readJson(PANELS_KEY))) },
}))

export const useRailCollapsed = (rail: Rail): boolean => usePanelStore((s) => s[rail])
export const panelActions = {
  toggle: (rail: Rail): void => usePanelStore.getState().toggle(rail),
  set: (rail: Rail, collapsed: boolean): void => usePanelStore.getState().set(rail, collapsed),
}
