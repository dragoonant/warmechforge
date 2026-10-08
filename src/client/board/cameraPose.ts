// Camera presets as pure maths (no three.js): where the eye and target go for each preset on a board of given bounds.
// 50-client §5: `1` top-down, `2` own home edge at 55 degrees, `3` follow the active unit, `0` overview.
export type CameraPreset = 'overview' | 'top' | 'home' | 'follow' | 'low'
export type HomeEdge = 'north' | 'south' | 'east' | 'west'

export interface PoseBounds { minX: number; maxX: number; minZ: number; maxZ: number; w: number; d: number }
export interface PoseOptions {
  /** Home edge for 'home' (the camera sits behind that edge looking across the board). */
  edge?: HomeEdge
  /** World point for 'follow' (x, y, z). */
  focus?: { x: number; y?: number; z: number }
  /** Viewport aspect, to fit wide boards. */
  aspect?: number
  /** Azimuth (radians) to keep for 'follow'. */
  azimuth?: number
}
export interface Pose { position: [number, number, number]; target: [number, number, number]; polar: number; azimuth: number; distance: number }

export const FOV_DEG = 38
export const MIN_DISTANCE = 3, MAX_DISTANCE = 30
export const MIN_POLAR = (15 * Math.PI) / 180, MAX_POLAR = (80 * Math.PI) / 180
const deg = (d: number): number => (d * Math.PI) / 180

/** Distance at which the whole board fits the view at the given polar angle. */
export function fitDistance(b: PoseBounds, aspect = 1.6, polar = deg(52)): number {
  const half = Math.tan(deg(FOV_DEG) / 2)
  const vertical = b.d * Math.cos(polar) + 2.2 * Math.sin(polar) + 1.2   // depth foreshortened + some height of the slab and the units
  const horizontal = b.w / aspect
  return Math.min(MAX_DISTANCE, Math.max(8, (Math.max(vertical, horizontal) * 0.5) / half * 1.32))
}

const AZ: Record<HomeEdge, number> = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 }

function make(target: [number, number, number], polar: number, azimuth: number, distance: number): Pose {
  const d = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance))
  const p = Math.min(MAX_POLAR, Math.max(MIN_POLAR, polar))
  const r = d * Math.sin(p)
  return { position: [target[0] + r * Math.sin(azimuth), target[1] + d * Math.cos(p), target[2] + r * Math.cos(azimuth)], target, polar: p, azimuth, distance: d }
}

export function cameraPose(preset: CameraPreset, b: PoseBounds, o: PoseOptions = {}): Pose {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, aspect = o.aspect ?? 1.6
  switch (preset) {
    case 'top': return make([cx, 0, cz], MIN_POLAR, 0, fitDistance(b, aspect, MIN_POLAR) * 1.05)
    case 'home': {
      const edge = o.edge ?? 'south'
      return make([cx, 0, cz], deg(55), AZ[edge], fitDistance(b, aspect, deg(55)) * 0.9)
    }
    case 'follow': {
      const f = o.focus ?? { x: cx, z: cz }
      return make([f.x, f.y ?? 0, f.z], deg(55), o.azimuth ?? 0, 11)
    }
    case 'low': return make([cx, 0, cz + b.d * 0.05], deg(77), 0, Math.min(MAX_DISTANCE, 15 + b.d * 0.35))
    case 'overview':
    default: return make([cx, 0, cz], deg(50), 0, fitDistance(b, aspect, deg(50)))
  }
}

/** Clamp a pan target to the board bounds plus a margin (spec: 2 hexes). Returns the shift to apply to eye and target. */
export function panClamp(t: { x: number; z: number }, b: PoseBounds, margin = 2): { dx: number; dz: number } {
  const dx = t.x < b.minX - margin ? b.minX - margin - t.x : t.x > b.maxX + margin ? b.maxX + margin - t.x : 0
  const dz = t.z < b.minZ - margin ? b.minZ - margin - t.z : t.z > b.maxZ + margin ? b.maxZ + margin - t.z : 0
  return { dx, dz }
}
