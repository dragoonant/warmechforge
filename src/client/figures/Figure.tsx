// One 'Mech on the table: the rig (GLB when one is enabled and loaded, else the procedural kit), selection / target rings, the
// facing arrow, status visuals and smoke. Renders from the PRESENTED state and follows the move tween while one plays. Status
// visuals are driven by state, never by animation clips (30-figures section 6). Everything per frame is imperative.
import { memo, useEffect, useMemo, useRef, type ReactElement } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DoubleSide, Group, MeshBasicMaterial, RingGeometry } from 'three'
import type { UnitId } from '../../engine/index'
import {
  directorNow, uiActions, useActiveUnitId, useForceColour, useHoverUnitId, usePresentedUnit, useSelectedId, useUnitTween, usePrompt,
} from '../contract'
import { handleUnitClick } from '../interaction/controller'
import { usePresentedStore } from '../presentation/presentedStore'
import { useSettingsStore } from '../store/settingsStore'
import { useUiStore } from '../store/uiStore'
import { ambientFrame } from '../vfx/frames'
import { COLOURS, puff, sparks } from '../vfx/particles'
import { BASE_THICKNESS, FIGURE_SCALE } from './figureConstants'
import { yawForFacing } from './facing'
import { cloneGlb, useGlbScene } from './glbLoader'
import { glbSlugFor, useGlbManifestReady } from './glbModels'
import { resolvePaint, usePaintStore } from './paintStore'
import { dataFigureSlug, profileOf } from './profile'
import { REST_POSE, applyStatus, buildGlbRig, buildProceduralRig, setGlow, setPose, type MechRig, type RigPose } from './rig'
import { socketWorld } from './sockets'
import { moveLabel, useWorldLabel } from './worldLabels'
import { isOnTable, unitFrame } from './unitFrame'
import { needsAmbient, unitVisual, type UnitVisual } from './visuals'

/** Flat ring on the xz plane (radius 1 outside, 0.93 inside), scaled per figure. */
const RING_GEO = new RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2)

const ringMats = new Map<string, MeshBasicMaterial>()
/** Shared translucent ring material per (colour, opacity). */
function ringMat(colour: string, opacity = 1): MeshBasicMaterial {
  const k = `${colour}:${opacity}`
  let m = ringMats.get(k)
  if (!m) { m = new MeshBasicMaterial({ color: colour, transparent: true, opacity, side: DoubleSide, depthWrite: false }); ringMats.set(k, m) }
  return m
}
const HIT_MATERIAL = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
export const ACTIVE_RING = ringMat('#e6c24a', 0.9)
const SEL = '#c9a227', TARGET = '#d0402b', HOVER = '#e8e6e1', ELIGIBLE = '#c9a227'

export interface FigureProps { id: UnitId }

/** Seconds a posed value takes to ease to its target at speed 1. */
const EASE_S = { twist: 0.25, tip: 0.5, slump: 0.3, wreck: 0.6, flip: 0.25 } as const

function approach(cur: number, target: number, dt: number, seconds: number, speed: number): number {
  if (speed <= 0 || seconds <= 0) return target
  const step = (dt * speed) / seconds
  return Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step
}

export const Figure = memo(function Figure({ id }: FigureProps): ReactElement | null {
  const unit = usePresentedUnit(id)
  const tween = useUnitTween(id)
  const colour = useForceColour(unit?.owner ?? 'A')
  const over = usePaintStore((s) => (unit ? s.bySide[unit.owner] : undefined))
  const selectedId = useSelectedId()
  const hoverId = useHoverUnitId()
  const activeId = useActiveUnitId()
  const prompt = usePrompt()
  const targeted = useUiStore((s) => s.fire.targetId === id || s.physical.targetId === id)
  const graphics = useSettingsStore((s) => s.graphics)
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const outer = useRef<Group>(null)
  const live = useRef({ twist: 0, tip: 0, slump: 0, wreck: 0, flip: 0, init: false, vkey: '', emit: 0, prevPos: '' })

  useGlbManifestReady()
  const prof = useMemo(() => (unit ? profileOf(unit) : null), [unit?.mechId, unit?.tonnage])
  const slug = unit && prof ? glbSlugFor(prof.key, dataFigureSlug(unit.mechId)) : undefined
  const scene = useGlbScene(slug)
  const paint = useMemo(() => resolvePaint(colour, over), [colour, over?.primary, over?.secondary])
  const rig: MechRig | null = useMemo(() => {
    if (!prof) return null
    return scene ? buildGlbRig(cloneGlb(scene), paint) : buildProceduralRig(prof.cls, prof.style, paint)
  }, [scene, prof?.cls, prof?.style, paint])
  useEffect(() => () => rig?.dispose(), [rig])
  useEffect(() => { live.current.vkey = ''; invalidate() }, [rig, invalidate])

  const eligible = prompt?.kind === 'selectUnit' && (prompt.context.eligible ?? []).includes(id)

  useFrame((_, delta) => {
    const g = outer.current
    const st = usePresentedStore.getState()
    const u = st.state?.units[id]
    if (!g || !rig || !st.state || !u) return
    const speed = useSettingsStore.getState().speed
    const dt = Math.min(0.1, delta)
    const s = live.current
    const f = unitFrame(st.state, u, st.tweens[id], directorNow())
    g.visible = isOnTable(u)
    g.position.set(f.x, f.y, f.z)
    moveLabel(`badge-${id}`, f.x, f.y + rig.height + 0.32, f.z)
    rig.root.rotation.y = yawForFacing(f.facing)

    // twist preview: while the twist decision (or the declaration it leads to) is open for this unit, show the draft
    const ui = useUiStore.getState()
    const previewing = ui.mode === 'fire' && st.state.selection?.activeUnit === id && st.state.pending?.unitId === id && (st.state.pending.kind === 'torsoTwist' || st.state.pending.kind === 'declareFire')
    const twistTarget = f.tweening ? f.twist : previewing ? ui.fire.twist : u.attacks.twist
    const flipTarget = previewing ? ui.fire.flip : u.attacks.flipped
    const v: UnitVisual = unitVisual(u, { prone: f.prone, twist: twistTarget })
    const vkey = `${v.destroyed}|${v.prone}|${v.shutdown}|${v.pilotDown}|${v.destroyedLocs.join()}|${v.exposedLocs.join()}`
    if (vkey !== s.vkey) { s.vkey = vkey; applyStatus(rig, v); gl.shadowMap.needsUpdate = true }

    const first = !s.init
    if (first) { s.init = true; s.twist = twistTarget; s.tip = v.prone ? 1 : 0; s.slump = v.shutdown ? 1 : 0; s.wreck = v.destroyed ? 1 : 0; s.flip = flipTarget ? 1 : 0 }
    s.twist = f.tweening ? f.twist : approach(s.twist, twistTarget, dt, EASE_S.twist * 2, speed) // twist spans up to 2 hexsides
    s.tip = approach(s.tip, v.prone ? 1 : 0, dt, EASE_S.tip, speed)
    s.slump = approach(s.slump, v.shutdown && !v.destroyed ? 1 : 0, dt, EASE_S.slump, speed)
    s.wreck = approach(s.wreck, v.destroyed ? 1 : 0, dt, EASE_S.wreck, speed)
    s.flip = approach(s.flip, flipTarget ? 1 : 0, dt, EASE_S.flip, speed)
    const swing = f.walking && rig.nodes.legL ? Math.sin(f.stride * Math.PI) * 0.35 : 0
    const bob = f.walking ? Math.abs(Math.sin(f.stride * Math.PI)) * 0.02 * f.H : 0
    const pose: RigPose = { ...REST_POSE, twist: s.twist, tip: s.tip, slump: s.slump, wreck: s.wreck, flip: s.flip, bob, swing, jets: f.air > 0.02 ? 1 : 0 }
    setPose(rig, pose)
    setGlow(rig, v, performance.now() / 1000)
    if (st.state.selection?.activeUnit === id) pulseActiveRing(performance.now())

    // smoke and sparks from damaged locations (pooled particles; Low graphics draws none)
    const ambient = needsAmbient(v)
    if (graphics === 'high' && ambient && !st.paused) {
      s.emit -= dt
      if (s.emit <= 0) {
        s.emit = 0.35
        const frame = { x: f.x, y: f.y, z: f.z, facing: f.facing, twist: s.twist, H: f.H }
        for (const loc of v.exposedLocs) { const p = socketWorld(loc, frame); if (Math.random() < 0.5) puff(p.x, p.y, p.z, COLOURS.smoke, 0.14, 0.9, 0.5) }
        for (const loc of v.destroyedLocs) { const p = socketWorld(loc, frame); puff(p.x, p.y, p.z, COLOURS.smoke, 0.2, 1.2, 0.6); if (Math.random() < 0.3) sparks(p.x, p.y, p.z, 2, COLOURS.electric, 1.2) }
        if (v.wreck) { const p = socketWorld('CT', frame); puff(p.x, p.y + 0.1, p.z, COLOURS.smoke, 0.32, 1.8, 0.8) }
      }
    }
    // keep the demand frameloop going while something moves, eases or pulses
    const posKey = `${f.x.toFixed(3)},${f.z.toFixed(3)},${f.y.toFixed(3)},${f.facing.toFixed(3)}`
    const moved = posKey !== s.prevPos
    s.prevPos = posKey
    const easing = Math.abs(s.twist - twistTarget) > 1e-3 || Math.abs(s.tip - (v.prone ? 1 : 0)) > 1e-3 || Math.abs(s.slump - (v.shutdown && !v.destroyed ? 1 : 0)) > 1e-3 || Math.abs(s.wreck - (v.destroyed ? 1 : 0)) > 1e-3 || Math.abs(s.flip - (flipTarget ? 1 : 0)) > 1e-3
    if (f.tweening || easing || first) { if (moved || easing || first) gl.shadowMap.needsUpdate = true; invalidate() }
    else if (v.glow.pulse || (graphics === 'high' && ambient) || activeId === id) ambientFrame(invalidate, g, 20)
  })

  const badges: string[] = []
  if (unit) {
    if (unit.status === 'destroyed') badges.push('destroyed')
    else {
      if (unit.shutdown) badges.push('shut down')
      if (!unit.pilot.conscious) badges.push('pilot down')
      if (unit.move.jumped) badges.push('jumped')
    }
  }
  useWorldLabel(`badge-${id}`, rig && badges.length ? {
    pos: [outer.current?.position.x ?? 0, (outer.current?.position.y ?? 0) + rig.height + 0.32, outer.current?.position.z ?? 0],
    node: (
      <div data-testid={`mech-badges-${id}`} style={{ display: 'flex', gap: 3, font: '600 10px system-ui', color: '#e8e6e1', textShadow: '0 1px 2px #000', whiteSpace: 'nowrap' }}>
        {badges.map((b) => <span key={b} style={{ background: '#14161acc', border: '1px solid #3a3f49', borderRadius: 5, padding: '0 4px' }}>{b}</span>)}
      </div>
    ),
  } : null)
  if (!unit || !rig || !prof) return null
  const r = rig.radius
  // the pick volume keeps the data height (not the enlarged drawing) so it never covers the hexes behind a figure
  const pickH = rig.height / FIGURE_SCALE
  const selected = selectedId === id
  const hovered = hoverId === id
  const active = activeId === id
  return (
    <group ref={outer} name={`unit-${id}`}>
      <primitive object={rig.root} />
      {/* invisible pick volume */}
      <mesh
        material={HIT_MATERIAL} position={[0, (pickH + BASE_THICKNESS) / 2, 0]}
        onClick={(e) => { if (e.nativeEvent.button !== 0 || e.delta > 4) return; e.stopPropagation(); handleUnitClick(id) }}
        onPointerOver={(e) => { e.stopPropagation(); uiActions.hoverUnit(id) }}
        onPointerOut={() => uiActions.hoverUnit(null)}
      >
        <cylinderGeometry args={[r + 0.05, r + 0.05, pickH + BASE_THICKNESS, 12]} />
      </mesh>
      {/* rings on the base edge: selected gold, active pulsing gold, target red, hovered white, eligible soft gold */}
      {eligible && !selected && <mesh geometry={RING_GEO} material={ringMat(ELIGIBLE, 0.5)} position={[0, 0.02, 0]} scale={[r + 0.12, 1, r + 0.12]} />}
      {selected && <mesh geometry={RING_GEO} material={ringMat(SEL)} position={[0, 0.03, 0]} scale={[r + 0.1, 1, r + 0.1]} />}
      {active && <mesh geometry={RING_GEO} material={ACTIVE_RING} position={[0, 0.032, 0]} scale={[r + 0.17, 1, r + 0.17]} />}
      {targeted && <mesh geometry={RING_GEO} material={ringMat(TARGET)} position={[0, 0.04, 0]} scale={[r + 0.24, 1, r + 0.24]} />}
      {hovered && !selected && <mesh geometry={RING_GEO} material={ringMat(HOVER, 0.5)} position={[0, 0.025, 0]} scale={[r + 0.08, 1, r + 0.08]} />}
    </group>
  )
})

/** Pulses the shared active-unit ring (called once a frame by the layer). */
export function pulseActiveRing(timeMs: number): void { ACTIVE_RING.opacity = 0.55 + 0.4 * Math.sin(timeMs / 260) }

