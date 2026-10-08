// Establishing shot: a slow orbit that starts wide inside the shop and swoops down to the play camera's pose. Any click, key or
// wheel skips it (the skipping input is swallowed so it never reaches the board). Mount inside the <Canvas> after the board's camera.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { create } from 'zustand'
import { useSettingsStore } from '../store/settingsStore'
import { useEffectiveSurroundings } from './surroundings'
import { SHOT_DURATION_S } from './shotPath'
import { easeInOut, fromOrbit, lerp, shotPose, toOrbit, wideShopOrbit, wrapPi, type Orbit } from './shotPath'

interface ShotStore { active: boolean; request: number; play(): void; setActive(v: boolean): void }
export const useShotStore = create<ShotStore>((set) => ({
  active: false, request: 0,
  play() { set((s) => ({ request: s.request + 1 })) },
  setActive(v) { set({ active: v }) },
}))
/** True while the establishing shot plays (HUD can show a hint or hold its panels back). */
export const useEstablishingActive = (): boolean => useShotStore((s) => s.active)
/** Ask the mounted <EstablishingShot/> to play again (e.g. a menu replay). */
export const playEstablishingShot = (): void => useShotStore.getState().play()

export { SHOT_DURATION_S } from './shotPath'
const SKIP_S = 0.45
export interface EstablishingShotProps {
  /** Play once on mount (default true). Replays come from playEstablishingShot(). */
  auto?: boolean
  /** Fixed end view; default is the camera's pose when the shot starts. */
  endView?: { position: [number, number, number]; target: [number, number, number] }
  onDone?(): void
}
type Ctl = { enabled: boolean; target: THREE.Vector3; update(): void }

export function EstablishingShot({ auto = true, endView, onDone }: EstablishingShotProps) {
  const { camera, gl, invalidate } = useThree()
  const controls = useThree((s) => s.controls) as Ctl | null
  const mode = useEffectiveSurroundings()
  const request = useShotStore((s) => s.request)
  const run = useRef<null | { t0: number; start: Orbit; end: Orbit; skipAt: number | null; from?: Orbit; wait: number }>(null)
  const doneCb = useRef(onDone); doneCb.current = onDone
  const firstAuto = useRef(auto)

  // start on mount (auto) and on every explicit request
  useEffect(() => {
    const wanted = request > 0 || firstAuto.current
    if (!wanted) return
    firstAuto.current = false
    const speed = useSettingsStore.getState().speed
    if (mode !== 'shop' || speed === 0) { doneCb.current?.(); return }
    run.current = { t0: -1, start: null as unknown as Orbit, end: null as unknown as Orbit, skipAt: null, wait: 2 }
    useShotStore.getState().setActive(true)
    invalidate()
  }, [request, mode, invalidate])

  // any input skips
  useEffect(() => {
    const el = gl.domElement
    const skip = (e: Event): void => {
      const r = run.current
      if (!r || r.skipAt !== null) return
      e.stopPropagation(); if (e.cancelable) e.preventDefault()
      r.skipAt = -2 // stamped in the frame loop
      invalidate()
    }
    const kinds = ['pointerdown', 'mousedown', 'click', 'wheel', 'touchstart'] as const
    for (const k of kinds) el.addEventListener(k, skip, { capture: true })
    const key = (e: KeyboardEvent): void => { if (run.current) skip(e) }
    window.addEventListener('keydown', key, { capture: true })
    return () => { for (const k of kinds) el.removeEventListener(k, skip, { capture: true }); window.removeEventListener('keydown', key, { capture: true }) }
  }, [gl, invalidate])

  const ctlRef = useRef(controls); ctlRef.current = controls
  useEffect(() => () => { if (run.current && ctlRef.current) ctlRef.current.enabled = true; run.current = null; useShotStore.getState().setActive(false) }, [])

  useFrame((state) => {
    const r = run.current
    if (!r) return
    state.invalidate()
    if (r.wait > 0) { r.wait--; return } // let the board's Camera settle its pose first
    const now = state.clock.elapsedTime
    if (r.t0 < 0) {
      const endPos = endView ? new THREE.Vector3(...endView.position) : camera.position.clone()
      const endTarget = endView ? new THREE.Vector3(...endView.target) : (controls ? controls.target.clone() : new THREE.Vector3())
      r.end = toOrbit(endPos, endTarget)
      r.start = wideShopOrbit(r.end)
      r.t0 = now
      if (controls) controls.enabled = false
    }
    if (r.skipAt === -2) { r.skipAt = now; r.from = toOrbit(camera.position, controls ? controls.target : r.end.target) }
    let pose: Orbit; let finished = false
    if (r.skipAt !== null && r.from) {
      const k = Math.min(1, (now - r.skipAt) / SKIP_S)
      pose = { target: new THREE.Vector3().lerpVectors(r.from.target, r.end.target, easeInOut(k)), radius: lerp(r.from.radius, r.end.radius, easeInOut(k)), az: r.from.az + wrapPi(r.end.az - r.from.az) * easeInOut(k), el: lerp(r.from.el, r.end.el, easeInOut(k)) }
      finished = k >= 1
    } else {
      const k = (now - r.t0) / SHOT_DURATION_S
      pose = shotPose(r.start, r.end, k)
      finished = k >= 1
    }
    fromOrbit(pose, camera.position)
    if (controls) controls.target.copy(pose.target)
    camera.lookAt(pose.target)
    if (finished) {
      fromOrbit(r.end, camera.position)
      if (controls) { controls.target.copy(r.end.target); controls.enabled = true; controls.update() } else camera.lookAt(r.end.target)
      run.current = null
      useShotStore.getState().setActive(false)
      doneCb.current?.()
    }
  })
  return null
}

/** Skip hint (DOM, mount outside the Canvas): fades while the shot plays. */
export function EstablishingHint() {
  const active = useEstablishingActive()
  if (!active) return null
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 28, textAlign: 'center', pointerEvents: 'none', color: '#e8e6e1', font: '13px system-ui, sans-serif', letterSpacing: 1, textShadow: '0 1px 6px #000' }}>
      Click anywhere to skip
    </div>
  )
}
