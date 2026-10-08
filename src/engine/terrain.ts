// Terrain helpers (10 HEX-008/009, LOS-010). Pure; read from BoardState.
import { hexToLabel } from './hex'
import type { BoardHex, BoardState, Hex } from './types'

export const STANDING_HEIGHT = 2
export const PRONE_HEIGHT = 1

export const hexAt = (board: BoardState, h: Hex): BoardHex | null => {
  const label = hexToLabel(board, h)
  return label ? board.hexes[label] ?? null : null
}
/** HEX-008: water floor = surface minus depth; otherwise the ground level. */
export const floorLevel = (bh: BoardHex): number => bh.level - bh.depth
export const woodsPointsOf = (bh: BoardHex): number => (bh.woods === 'heavy' ? 2 : bh.woods === 'light' ? 1 : 0)
/** HEX-009: floor plus height. */
export const losLevel = (bh: BoardHex, prone: boolean): number => floorLevel(bh) + (prone ? PRONE_HEIGHT : STANDING_HEIGHT)
/** LOS-010: ground (water: surface), plus 2 with woods. */
export const obstacleLevel = (bh: BoardHex): number => bh.level + (bh.woods === 'none' ? 0 : 2)
/** Submerged: whole body under the surface (prone in depth 1+, standing in depth 2+). */
export const isSubmerged = (bh: BoardHex, prone: boolean): boolean => bh.depth >= (prone ? 1 : 2)
