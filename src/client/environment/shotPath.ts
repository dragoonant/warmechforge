// Pure camera path for the establishing shot (no React): wide in the shop, swooping down to the play camera pose.
import * as THREE from 'three'

export const SHOT_DURATION_S = 7
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

export type Orbit = { target: THREE.Vector3; radius: number; az: number; el: number }
export function toOrbit(pos: THREE.Vector3, target: THREE.Vector3): Orbit {
  const d = pos.clone().sub(target)
  const radius = d.length()
  return { target: target.clone(), radius, az: Math.atan2(d.x, d.z), el: Math.asin(THREE.MathUtils.clamp(d.y / Math.max(1e-6, radius), -1, 1)) }
}
export function fromOrbit(o: Orbit, outPos: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(o.el)
  return outPos.set(o.target.x + o.radius * c * Math.sin(o.az), o.target.y + o.radius * Math.sin(o.el), o.target.z + o.radius * c * Math.cos(o.az))
}
/** Pure path sampler (tested): k in 0..1 from the wide shop view to the end view. */
export function shotPose(start: Orbit, end: Orbit, k: number): Orbit {
  const e = easeInOut(Math.min(1, Math.max(0, k)))
  const swoop = Math.sin(Math.PI * e) * 0.12 // slight overshoot arc: dips low then settles
  return {
    target: new THREE.Vector3().lerpVectors(start.target, end.target, e),
    radius: lerp(start.radius, end.radius, e),
    az: start.az + wrapPi(end.az - start.az) * e,
    el: lerp(start.el, end.el, e) - swoop * 0.35,
  }
}
export function wideShopOrbit(end: Orbit): Orbit {
  return { target: new THREE.Vector3(0, 12, -60), radius: 125, az: end.az + 0.85, el: 0.26 }
}

