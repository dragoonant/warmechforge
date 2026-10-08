// Hex <-> world mapping for the board. No rules math and no re-derived hex maths: this wraps the engine's hex.ts (axial hex,
// labels, world mapping, neighbours, distance) and only adds a registered "active board" so callers can pass a label or an
// axial hex without carrying the BoardState around. Flat-topped, 1 unit flat-to-flat, board centred at the origin, north = -z.
import type { BoardState, Hex, HexLabel } from '../../engine/types'
import { LEVEL_HEIGHT } from '../../engine/types'
import { hexToLabel, hexToWorld as engineHexToWorld, labelToHex, worldToHex as engineWorldToHex } from '../../engine/hex'

// The engine's hex maths, re-exported (not re-derived).
export {
  distance, hexEq, hexKey, hexToLabel, hexToOffset, hexesWithin, labelToHex, neighbor, neighbors, offsetToHex, onBoard, ring,
} from '../../engine/hex'
export { COLUMN_STEP, HEX_FLAT, LEVEL_HEIGHT } from '../../engine/types'
export type { BoardState, Hex, HexLabel } from '../../engine/types'

let active: BoardState | null = null
/** HexBoard registers the board it draws, so hexToWorld(label) works anywhere in the client. */
export function setActiveBoard(b: BoardState | null): void { active = b }
export function getActiveBoard(): BoardState | null { return active }

export interface WorldPoint { x: number; y: number; z: number }

function asHex(h: Hex | HexLabel): Hex | null { return typeof h === 'string' ? labelToHex(h) : h }

/** Hex centre on the table plane (x east, z south), board centred at the origin. Origin when there is no board. */
export function hexToWorld(h: Hex | HexLabel, board: BoardState | null = active): { x: number; z: number } {
  const hex = asHex(h)
  if (!hex || !board) return { x: 0, z: 0 }
  return engineHexToWorld(board, hex)
}

/** Which hex a world point lies in (axial); null when there is no board. Use hexToLabel(board, hex) to test it is on the board. */
export function worldToHex(p: { x: number; z: number }, board: BoardState | null = active): Hex | null {
  return board ? engineWorldToHex(board, p) : null
}

/** World y of the walkable surface of a hex (ground level, or the water surface for a water hex): where 'Mechs stand. */
export function hexSurfaceY(h: Hex | HexLabel, board: BoardState | null = active): number {
  const hex = asHex(h)
  const label = hex && board ? hexToLabel(board, hex) : null
  const bh = label && board ? board.hexes[label] : undefined
  return bh ? bh.level * LEVEL_HEIGHT : 0
}

/** Centre of the top of a hex in world space: where a figure's feet go and a label or marker floats. */
export function hexTopPoint(h: Hex | HexLabel, board: BoardState | null = active): WorldPoint {
  const { x, z } = hexToWorld(h, board)
  return { x, y: hexSurfaceY(h, board), z }
}
