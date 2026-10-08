// Pure board layout: one TileInfo per on-board hex (world position, heights, terrain, deterministic jitter), the distinct level
// groups the renderer makes one InstancedMesh for, and the board bounds. No three.js, no React: unit-testable.
import type { BoardState, Hex, HexLabel, Woods } from '../../engine/types'
import { LEVEL_HEIGHT } from '../../engine/types'
import { hexToLabel, hexToWorld, neighbors } from '../../engine/hex'
import { stream } from './hash'

/** How far a tile prism reaches below the lowest top (the slab thickness at the board edge). */
export const SLAB_DEPTH = 0.3
/** Water surface sits this far below the surrounding ground, so shorelines read as recessed. */
export const WATER_DROP = 0.03

export interface TileInfo {
  label: HexLabel
  hex: Hex
  x: number
  z: number
  /** Integer level of the solid top: the ground, or the sea bed under water. */
  topLevel: number
  /** Water surface level (the map's level), or null when dry. */
  surfaceLevel: number | null
  depth: number
  woods: Woods
  rough: boolean
  pavement: boolean
  road: boolean
  /** Per-tile vertical jitter (world units, tiny) and colour multiplier (linear rgb), deterministic by label. */
  dy: number
  tint: [number, number, number]
}

export interface BoardLayout {
  tiles: TileInfo[]
  byLabel: Map<HexLabel, TileInfo>
  /** Distinct topLevel values, ascending. */
  levels: number[]
  /** Tiles grouped by topLevel. */
  groups: Map<number, TileInfo[]>
  baseY: number
  /** World y of the lowest visible surface (ground or water surface): everything below it on the slab edge is the dark plinth. */
  plinthY: number
  minLevel: number
  maxLevel: number
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; w: number; d: number }
}

export const topYOf = (t: Pick<TileInfo, 'topLevel'>): number => t.topLevel * LEVEL_HEIGHT

export function jitterFor(label: HexLabel): { dy: number; tint: [number, number, number] } {
  const r = stream(label, 'tile')
  const lum = 0.93 + r() * 0.12            // +-6 % brightness
  const hue = (r() - 0.5) * 0.06           // slight warm / cool drift
  return { dy: (r() - 0.5) * 0.010, tint: [lum * (1 + hue), lum, lum * (1 - hue)] }
}

export function layoutBoard(board: BoardState): BoardLayout {
  const tiles: TileInfo[] = []
  const byLabel = new Map<HexLabel, TileInfo>()
  const groups = new Map<number, TileInfo[]>()
  let minLevel = Infinity, maxLevel = -Infinity, minSurface = Infinity
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const label of Object.keys(board.hexes).sort()) {
    const bh = board.hexes[label]!
    const { x, z } = hexToWorld(board, bh.hex)
    const wet = bh.depth > 0
    const j = jitterFor(label)
    const t: TileInfo = {
      label, hex: bh.hex, x, z,
      topLevel: wet ? bh.level - bh.depth : bh.level, surfaceLevel: wet ? bh.level : null, depth: bh.depth,
      woods: bh.woods, rough: bh.rough, pavement: bh.pavement, road: bh.road.length > 0, dy: j.dy, tint: j.tint,
    }
    tiles.push(t); byLabel.set(label, t)
    let g = groups.get(t.topLevel); if (!g) groups.set(t.topLevel, (g = [])); g.push(t)
    minSurface = Math.min(minSurface, t.surfaceLevel ?? t.topLevel)
    minLevel = Math.min(minLevel, t.topLevel); maxLevel = Math.max(maxLevel, t.surfaceLevel ?? t.topLevel)
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  if (!tiles.length) { minLevel = 0; minSurface = 0; maxLevel = 0; minX = maxX = minZ = maxZ = 0 }
  const bounds = { minX: minX - 0.5774, maxX: maxX + 0.5774, minZ: minZ - 0.5, maxZ: maxZ + 0.5, w: 0, d: 0 }
  bounds.w = bounds.maxX - bounds.minX; bounds.d = bounds.maxZ - bounds.minZ
  return {
    tiles, byLabel, groups, levels: [...groups.keys()].sort((a, b) => a - b), baseY: minLevel * LEVEL_HEIGHT - SLAB_DEPTH, plinthY: minSurface * LEVEL_HEIGHT, minLevel, maxLevel, bounds,
  }
}

/** Neighbour tiles of a hex that are on the board, in facing order 0..5 (null where off board). */
export function neighbourTiles(layout: BoardLayout, board: BoardState, t: TileInfo): (TileInfo | null)[] {
  return neighbors(t.hex).map((h) => { const l = hexToLabel(board, h); return l ? layout.byLabel.get(l) ?? null : null })
}
