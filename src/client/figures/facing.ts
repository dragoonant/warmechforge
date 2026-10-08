// Which way a figure looks. Engine facing 0 = north (-z), clockwise, 60 degrees per hexside. Figures (GLB and procedural)
// have their FRONT on +z and their left on +x, so the root's yaw is pi - facing x pi/3 (facing 1 = north-east hexside).
import type { Facing, Twist } from '../../engine/index'

const SIXTH = Math.PI / 3

/** Yaw (about +y) of a figure's root for a feet facing; fractional facings (mid-turn tweens) interpolate smoothly. */
export const yawForFacing = (facing: number): number => Math.PI - facing * SIXTH

/** Yaw of the upper body relative to the feet for a (possibly fractional) torso twist: +1 = clockwise = right. */
export const twistYaw = (twist: number): number => -twist * SIXTH

/** World direction (unit vector on the xz plane) a figure with `facing` (and extra `twist`) looks toward. */
export function frontVector(facing: number, twist = 0): { x: number; z: number } {
  const a = yawForFacing(facing) + twistYaw(twist)
  return { x: Math.sin(a), z: Math.cos(a) }
}

/** Rotate a local offset (x = figure's left, z = front) into world xz for a given yaw. */
export function rotateLocal(x: number, z: number, yaw: number): { x: number; z: number } {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  return { x: x * c + z * s, z: -x * s + z * c }
}

/** Shortest signed turn from facing a to facing b in hexsides (-3..3]. */
export function facingDelta(a: number, b: number): number {
  let d = (((b - a) % 6) + 6) % 6
  if (d > 3) d -= 6
  return d
}

export const FACING_NAMES: Record<Facing, string> = { 0: 'north', 1: 'north-east', 2: 'south-east', 3: 'south', 4: 'south-west', 5: 'north-west' }
export const clampTwist = (t: number): Twist => (t < -0.5 ? -1 : t > 0.5 ? 1 : 0)
