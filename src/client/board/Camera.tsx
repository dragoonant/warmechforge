// Camera: right-drag orbit, middle-drag / WASD pan, wheel zoom; the left button is reserved for the board. Preset transitions are
// eased and at most 600 ms. Adapted from Whirr Machine's CameraRig (own preset store instead of its interaction store).
import { useEffect, useRef, type ReactElement } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MOUSE, TOUCH, Vector3, type InstancedMesh } from 'three'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import { create } from 'zustand'
import { MAX_DISTANCE, MAX_POLAR, MIN_DISTANCE, MIN_POLAR, cameraPose, panClamp, type CameraPreset, type HomeEdge, type PoseBounds, type PoseOptions } from './cameraPose'

export const TRANSITION_MS = 500   // spec: transitions at most 600 ms
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const PAN_KEYS: Record<string, [number, number]> = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }

interface CamRequest { preset: CameraPreset; opts: PoseOptions; nonce: number; instant: boolean }
export const useCameraStore = create<{ req: CamRequest | null }>(() => ({ req: null }))
let nonce = 0

/** Ask the camera for a preset (any component, keyboard handlers, the start of a decision). */
export const cameraActions = {
  preset(preset: CameraPreset, opts: PoseOptions & { instant?: boolean } = {}): void {
    const { instant, ...rest } = opts
    useCameraStore.setState({ req: { preset, opts: rest, nonce: ++nonce, instant: !!instant } })
  },
  overview: (): void => cameraActions.preset('overview'),
  topDown: (): void => cameraActions.preset('top'),
  home: (edge: HomeEdge): void => cameraActions.preset('home', { edge }),
  follow: (x: number, z: number, y = 0): void => cameraActions.preset('follow', { focus: { x, y, z } }),
}

/** Dev / e2e hooks: window.__boardCam.set(position, target), .screen(x, y, z) -> page pixels. Installed only with ?test=1 or in dev. */
function hooksWanted(): boolean {
  try {
    const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true
    return dev || /[?&]test=1\b/.test(location.search)
  } catch { return false }
}

export function CameraRig({ bounds, aspectHint }: { bounds: PoseBounds; aspectHint?: number }): ReactElement {
  const controls = useRef<OrbitImpl>(null)
  const ctl = useThree((s) => s.controls)   // set once drei mounts OrbitControls: effects below wait for it
  const { camera, invalidate, gl, scene } = useThree()
  const req = useCameraStore((s) => s.req)
  const size = useThree((s) => s.size)
  const tween = useRef<{ t0: number; fromP: Vector3; toP: Vector3; fromT: Vector3; toT: Vector3 } | null>(null)
  const keys = useRef(new Set<string>())
  const boundsRef = useRef(bounds); boundsRef.current = bounds
  const aspect = aspectHint ?? size.width / Math.max(1, size.height)
  const aspectRef = useRef(aspect); aspectRef.current = aspect

  // initial pose, and again when the board changes shape
  const bKey = `${bounds.w.toFixed(2)}x${bounds.d.toFixed(2)}`
  useEffect(() => {
    const c = controls.current; if (!c) return
    const p = cameraPose('overview', boundsRef.current, { aspect: aspectRef.current })
    tween.current = null
    camera.position.set(...p.position); c.target.set(...p.target); c.update(); invalidate()
  }, [bKey, camera, invalidate, ctl])

  // preset requests
  useEffect(() => {
    const c = controls.current
    if (!req || !c) return
    const pose = cameraPose(req.preset, boundsRef.current, { aspect: aspectRef.current, ...req.opts })
    if (req.instant) { tween.current = null; camera.position.set(...pose.position); c.target.set(...pose.target); c.update(); invalidate(); return }
    tween.current = { t0: performance.now(), fromP: camera.position.clone(), toP: new Vector3(...pose.position), fromT: c.target.clone(), toT: new Vector3(...pose.target) }
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.nonce, ctl])

  // test hooks (dev server or ?test=1): jump the camera and project world points to page pixels, for screenshots and e2e clicks
  useEffect(() => {
    if (!hooksWanted()) return
    const w = window as unknown as { __boardCam?: unknown }
    w.__boardCam = {
      set: (p: [number, number, number], t: [number, number, number]) => {
        const c = controls.current; if (!c) return
        tween.current = null; camera.position.set(...p); c.target.set(...t); c.update(); invalidate()
      },
      screen: (x: number, y: number, z: number) => {
        camera.updateMatrixWorld()
        const v = new Vector3(x, y, z).project(camera), r = gl.domElement.getBoundingClientRect()
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
      },
      dump: () => { const out: string[] = []; scene.traverse((o) => { const m = o as InstancedMesh; if (m.isMesh || (o as {isLine?: boolean}).isLine) out.push(o.name + ':' + o.type + (m.isInstancedMesh ? '#' + m.count : '') + ' vis=' + o.visible + ' pos=' + o.position.toArray().map((n) => n.toFixed(2)).join(',')) }); return out },
      info: () => ({ bg: String((scene.background as { getHexString?: () => string } | null)?.getHexString?.()), fog: !!scene.fog, ...gl.info.render, memory: { ...gl.info.memory }, programs: gl.info.programs?.length ?? 0, children: scene.children.length }),
    }
    return () => { delete w.__boardCam }
  }, [camera, invalidate, gl, scene, ctl])

  // WASD pan (ignored while typing)
  useEffect(() => {
    const typing = (e: KeyboardEvent): boolean => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) }
    const down = (e: KeyboardEvent): void => { if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key.toLowerCase(); if (k in PAN_KEYS) { keys.current.add(k); invalidate() } }
    const up = (e: KeyboardEvent): void => { keys.current.delete(e.key.toLowerCase()) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [invalidate])

  const fwd = useRef(new Vector3()), right = useRef(new Vector3())
  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    const tw = tween.current
    if (tw) {
      const f = Math.min(1, (performance.now() - tw.t0) / TRANSITION_MS), e = easeInOut(f)
      camera.position.lerpVectors(tw.fromP, tw.toP, e); c.target.lerpVectors(tw.fromT, tw.toT, e); c.update()
      if (f >= 1) tween.current = null
      invalidate()
    }
    if (keys.current.size) {
      camera.getWorldDirection(fwd.current); fwd.current.y = 0; fwd.current.normalize()
      right.current.crossVectors(fwd.current, camera.up).normalize()
      const speed = 14 * Math.min(dt, 0.05)
      for (const k of keys.current) {
        const [dx, dz] = PAN_KEYS[k]!
        const move = right.current.clone().multiplyScalar(dx * speed).addScaledVector(fwd.current, -dz * speed)
        camera.position.add(move); c.target.add(move)
      }
      c.update(); invalidate()
    }
    // keep the pan target within the board plus two hexes
    const { dx, dz } = panClamp(c.target, boundsRef.current)
    if (dx || dz) { camera.position.x += dx; camera.position.z += dz; c.target.x += dx; c.target.z += dz; c.update(); invalidate() }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={MAX_POLAR}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      zoomSpeed={0.8}
      mouseButtons={{ LEFT: null as unknown as MOUSE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }}
      touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }}
      screenSpacePanning={false}
    />
  )
}
