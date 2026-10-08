// Force colours for figures (two-tone). Colours follow the force (50: not the seat): the main colour is the force's `color`,
// the trim is derived from it. The gallery's army painter can override either per side; overrides are display only.
import { create } from 'zustand'
import type { PlayerId } from '../../engine/index'

export interface ArmyPaint { primary?: string; secondary?: string }
export interface ResolvedPaint { primary: string; secondary: string }

export const paintKey = (p: ArmyPaint | undefined): string => (p && (p.primary || p.secondary) ? `${p.primary ?? ''}|${p.secondary ?? ''}` : '')

export const PAINT_PRESETS: readonly { id: string; label: string; primary: string; secondary: string }[] = [
  { id: 'blue', label: 'Blue lance', primary: '#3b6ea8', secondary: '#c9d6e6' },
  { id: 'red', label: 'Red lance', primary: '#a83b3b', secondary: '#e6c9c9' },
  { id: 'gold', label: 'Gold', primary: '#c9a227', secondary: '#3a3320' },
  { id: 'violet', label: 'Violet', primary: '#6b4fa0', secondary: '#d4c9e6' },
  { id: 'teal', label: 'Teal', primary: '#2f8f87', secondary: '#c9e6e3' },
]

interface PaintStore { bySide: Partial<Record<PlayerId, ArmyPaint>>; setSide(p: PlayerId, v: ArmyPaint): void }
export const usePaintStore = create<PaintStore>((set) => ({ bySide: {}, setSide: (p, v) => set((s) => ({ bySide: { ...s.bySide, [p]: v } })) }))

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1]!, 16) : 0x808080
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')

/** The trim colour for a main colour: much darker when the main is light, a pale tint when it is dark (two-tone). */
export function trimOf(primary: string): string {
  const [r, g, b] = hexToRgb(primary)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (lum > 0.55) return toHex(r * 0.3, g * 0.3, b * 0.3)
  const k = 0.72
  return toHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k)
}

/** Final two-tone colours of a force (a side's overrides win). */
export function resolvePaint(forceColour: string, over?: ArmyPaint): ResolvedPaint {
  const primary = over?.primary ?? forceColour
  return { primary, secondary: over?.secondary ?? trimOf(primary) }
}
export const darken = (hex: string, k: number): string => { const [r, g, b] = hexToRgb(hex); return toHex(r * (1 - k), g * (1 - k), b * (1 - k)) }
