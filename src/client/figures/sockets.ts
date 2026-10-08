// Socket points of a 'Mech (30-figures sections 3 and 6): where each location's muzzle / wound sits on the figure.
// Pure maths over the figure's local frame (front +z, left +x, y up from the hex top) so VFX can ask without a rig.
import type { Loc } from '../../engine/index'
import { BASE_THICKNESS } from './figureConstants'
import { rotateLocal, twistYaw, yawForFacing } from './facing'

export interface V3 { x: number; y: number; z: number }

/** Local socket offset of a location for a figure of height H (above the base). Rear mounts point backwards (-z). */
export function socketLocal(loc: Loc, H: number, rear = false): V3 {
  const y0 = BASE_THICKNESS
  const p = ((): V3 => {
    switch (loc) {
      case 'HD': return { x: 0, y: y0 + 0.88 * H, z: 0.1 * H }
      case 'CT': return { x: 0, y: y0 + 0.62 * H, z: 0.14 * H }
      case 'LT': return { x: 0.2 * H, y: y0 + 0.63 * H, z: 0.12 * H }
      case 'RT': return { x: -0.2 * H, y: y0 + 0.63 * H, z: 0.12 * H }
      case 'LA': return { x: 0.31 * H, y: y0 + 0.58 * H, z: 0.16 * H }
      case 'RA': return { x: -0.31 * H, y: y0 + 0.58 * H, z: 0.16 * H }
      case 'LL': return { x: 0.12 * H, y: y0 + 0.25 * H, z: 0.08 * H }
      case 'RL': return { x: -0.12 * H, y: y0 + 0.25 * H, z: 0.08 * H }
    }
  })()
  return rear ? { ...p, z: -p.z } : p
}

/** True when the location turns with the torso twist (everything above the hip). */
export const turnsWithTorso = (loc: Loc): boolean => loc !== 'LL' && loc !== 'RL'

export interface FigureFrame { x: number; y: number; z: number; facing: number; twist: number; H: number }

/** World position of a location's socket for a figure standing at (x, y, z) with the given feet facing and twist. */
export function socketWorld(loc: Loc, frame: FigureFrame, rear = false): V3 {
  const l = socketLocal(loc, frame.H, rear)
  const yaw = yawForFacing(frame.facing) + (turnsWithTorso(loc) ? twistYaw(frame.twist) : 0)
  const r = rotateLocal(l.x, l.z, yaw)
  return { x: frame.x + r.x, y: frame.y + l.y, z: frame.z + r.z }
}

/** World centre of mass (torso height) of a figure: aim points for beams and impacts. */
export function centreWorld(frame: FigureFrame): V3 {
  return { x: frame.x, y: frame.y + BASE_THICKNESS + 0.55 * frame.H, z: frame.z }
}
