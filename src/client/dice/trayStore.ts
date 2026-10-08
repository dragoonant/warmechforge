// Which logged roll the tray shows instead of the latest one (click a log row to pin it; click again to release).
import { create } from 'zustand'

interface TrayState { pinned: string | null }
export const useTrayStore = create<TrayState>(() => ({ pinned: null }))
export const tray = {
  pin(rollId: string | null): void { useTrayStore.setState((s) => ({ pinned: rollId === s.pinned ? null : rollId })) },
  clear(): void { useTrayStore.setState({ pinned: null }) },
}
