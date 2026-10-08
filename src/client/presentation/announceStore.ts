// Banners (big centred text: turn, phase, crit, explosion, destroyed, game over) and the narration log (one line per
// notable event). Written by the director as beats start; read by the UI.
import { create } from 'zustand'
import type { BannerKind } from './beats'

export interface Banner { id: number; text: string; sub?: string; kind: BannerKind; startedAt: number; durationMs: number }
export interface NarrationLine { seq: number; text: string }

export const NARRATION_LIMIT = 300

interface AnnounceState {
  banner: Banner | null
  lines: NarrationLine[]
}

export const useAnnounceStore = create<AnnounceState>(() => ({ banner: null, lines: [] }))

let bannerSeq = 0

export function showBanner(text: string, kind: BannerKind, startedAt: number, durationMs: number, sub?: string): void {
  useAnnounceStore.setState({ banner: { id: ++bannerSeq, text, kind, startedAt, durationMs, ...(sub ? { sub } : {}) } })
}

export function clearBanner(): void {
  if (useAnnounceStore.getState().banner) useAnnounceStore.setState({ banner: null })
}

export function addNarration(lines: NarrationLine[]): void {
  if (!lines.length) return
  useAnnounceStore.setState((s) => ({ lines: [...s.lines, ...lines].slice(-NARRATION_LIMIT) }))
}

export function resetAnnouncements(): void {
  useAnnounceStore.setState({ banner: null, lines: [] })
}
