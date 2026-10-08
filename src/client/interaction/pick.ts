// Screen ray -> hex. The board sits at varying heights (one level = LEVEL_HEIGHT), so a ray is marched down until it dips below
// the top of the hex it is over. Pure maths over the presented state; used by the board-wide pick plane.
import { LEVEL_HEIGHT, type GameState, type Hex } from '../../engine/index'
import { onBoard, worldToHex } from '../../engine/hex'
import { levelAt } from '../figures/unitFrame'

export interface V3 { x: number; y: number; z: number }
export const MAX_PICK_LEVEL = 8
const STEP = 0.06

/** The hex under a ray (origin, direction), or null when it misses the board. */
export function rayToHex(state: GameState, origin: V3, dir: V3): Hex | null {
  if (dir.y >= -1e-6) return null
  const top = MAX_PICK_LEVEL * LEVEL_HEIGHT
  // start where the ray comes down to the highest possible top (or at its origin when that is lower)
  let t = origin.y > top ? (origin.y - top) / -dir.y : 0
  const tEnd = t + 90
  let prevT = t
  for (; t < tEnd; t += STEP) {
    const y = origin.y + dir.y * t
    const p = { x: origin.x + dir.x * t, z: origin.z + dir.z * t }
    const h = worldToHex(state.board, p)
    const inside = onBoard(state.board, h)
    const ground = inside ? levelAt(state, h) * LEVEL_HEIGHT : -0.02
    if (y <= ground) {
      if (inside) return h
      // went below ground off the board: the last point just before may still be on it
      const pp = { x: origin.x + dir.x * prevT, z: origin.z + dir.z * prevT }
      const hh = worldToHex(state.board, pp)
      return onBoard(state.board, hh) ? hh : null
    }
    prevT = t
    if (y < -0.5) break
  }
  return null
}

/** Hex under the ray on the flat y = 0 plane (cheap fallback). */
export function rayToHexFlat(state: GameState, origin: V3, dir: V3): Hex | null {
  if (dir.y >= -1e-6) return null
  const t = -origin.y / dir.y
  if (t <= 0) return null
  const h = worldToHex(state.board, { x: origin.x + dir.x * t, z: origin.z + dir.z * t })
  return onBoard(state.board, h) ? h : null
}
