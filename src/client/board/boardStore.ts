// Board-local view settings that the shared settings store does not carry (the contract's Settings has the grid toggle and
// the label mode; the grid opacity lives here). Stored under `wmf.board`; every storage access is wrapped.
import { create } from 'zustand'

const KEY = 'wmf.board'

interface Persisted { gridOpacity: number }
function read(): Persisted {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    const o = raw ? (JSON.parse(raw) as Partial<Persisted>) : {}
    return { gridOpacity: typeof o.gridOpacity === 'number' && o.gridOpacity >= 0 && o.gridOpacity <= 1 ? o.gridOpacity : 0.35 }
  } catch { return { gridOpacity: 0.35 } }
}
function write(p: Persisted): void { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* storage blocked: the setting lasts for the session */ } }

interface BoardViewStore extends Persisted {
  setGridOpacity(v: number): void
}

/** Hex outline opacity 0..1 (spec default 0.35). The on/off toggle is `settings.grid` in the shared settings store. */
export const useBoardView = create<BoardViewStore>((set, get) => ({
  ...read(),
  setGridOpacity(v) {
    const gridOpacity = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.35))
    set({ gridOpacity }); write({ gridOpacity: get().gridOpacity })
  },
}))
