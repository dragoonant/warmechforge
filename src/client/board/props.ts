// Deterministic placement of trees and rocks inside a hex (keyed by its label, so they never move). Pure: no three.js.
import { stream } from './hash'

/**
 * Tallest a tree may be, in world units. A 'Mech is two levels tall; the spec caps trees at 0.55 of the smallest figure
 * height so woods stay below shoulder height and never hide a unit: 0.55 * 2 * LEVEL_HEIGHT = 0.385.
 */
export const TREE_MAX_H = 0.385
export const TREE_MIN_H = 0.24

export interface Placement { x: number; z: number; rot: number; /** 0..1 size draw */ size: number; /** 0..1 tone draw */ tone: number }

/** How many trees stand in a hex: light woods 3 to 5, heavy woods dense. Low graphics thins heavy woods. */
export function treeCount(label: string, woods: 'light' | 'heavy', low = false): number {
  const r = stream(label, 'tree-count')()
  if (woods === 'light') return 3 + Math.floor(r * 3)
  const n = 8 + Math.floor(r * 3)
  return low ? Math.ceil(n * 0.6) : n
}

/** Scatter points inside a hex with a minimum spacing (relaxed after a few failed tries). Radius keeps crowns inside the hex. */
export function treePlacements(label: string, woods: 'light' | 'heavy', low = false): Placement[] {
  const n = treeCount(label, woods, low)
  const r = stream(label, 'trees-' + woods)
  const out: Placement[] = []
  let minD = woods === 'light' ? 0.20 : 0.115
  const reach = woods === 'light' ? 0.30 : 0.34
  for (let i = 0; i < n; i++) {
    let best: Placement | null = null
    for (let tries = 0; tries < 14; tries++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * reach
      const p: Placement = { x: Math.cos(a) * d, z: Math.sin(a) * d, rot: r() * Math.PI * 2, size: r(), tone: r() }
      if (out.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= minD)) { best = p; break }
      best ??= p
    }
    out.push(best!)
    if (i % 3 === 2) minD *= 0.92
  }
  return out
}

export function rockCount(label: string): number { return 6 + Math.floor(stream(label, 'rock-count')() * 4) }

/** Rocks of a rough hex: a few chunky ones and several small stones. */
export function rockPlacements(label: string): Placement[] {
  const n = rockCount(label)
  const r = stream(label, 'rocks')
  const out: Placement[] = []
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.38
    out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rot: r() * Math.PI * 2, size: i < 3 ? 0.55 + r() * 0.45 : r() * 0.5, tone: r() })
  }
  return out
}
/** Rock radius from its size draw (spec: 0.05 to 0.1 for the chunky ones). */
export const rockRadius = (size: number): number => 0.035 + size * 0.065
/** Tree height from its size draw. */
export const treeHeight = (size: number): number => TREE_MIN_H + size * (TREE_MAX_H - TREE_MIN_H)
