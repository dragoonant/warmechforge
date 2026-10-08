// Flat hex highlights (50 section 1 overlays): one InstancedMesh per distinct opacity (per-instance colour), plus one merged
// LineSegments for outlines. Every overlay draws through these, so a reach set of 100 hexes is two draw calls.
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Shape, ShapeGeometry, type LineSegments } from 'three'
import type { GameState, Hex } from '../../engine/index'
import { query } from '../../engine/index'
import { hexTopY } from '../figures/unitFrame'
import { usePresentedState } from '../contract'
import type { HexFillSpec } from './overlayModel'

/** Circumradius of a hex of 1.0 flat-to-flat (corner to centre). */
export const HEX_R = 1 / Math.sqrt(3)

const hexGeo = ((): BufferGeometry => {
  const s = new Shape()
  const r = HEX_R * 0.94
  for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) s.moveTo(x, y); else s.lineTo(x, y) }
  s.closePath()
  return new ShapeGeometry(s).rotateX(-Math.PI / 2) // lies on the xz plane, facing up
})()

/** Corner points of a hex outline on the xz plane around (cx, cz), scaled by k. */
export function hexCorners(cx: number, cz: number, k = 0.94): [number, number][] {
  const r = HEX_R * k
  return Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as [number, number] })
}

function worldOf(state: GameState, h: Hex): { x: number; z: number } { return query.hexToWorld(state, h) }

interface Props { specs: readonly HexFillSpec[]; lift?: number; renderOrder?: number }

function FillBucket({ specs, opacity, lift, renderOrder, state }: { specs: HexFillSpec[]; opacity: number; lift: number; renderOrder: number; state: GameState }): ReactElement {
  const ref = useRef<InstancedMesh>(null)
  const invalidate = useThree((s) => s.invalidate)
  const mat = useMemo(() => new MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), [opacity])
  useEffect(() => () => mat.dispose(), [mat])
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const mx = new Matrix4(), c = new Color()
    specs.forEach((sp, i) => {
      const w = worldOf(state, sp.hex)
      mx.makeTranslation(w.x, hexTopY(state, sp.hex) + lift, w.z)
      m.setMatrixAt(i, mx)
      m.setColorAt(i, c.set(sp.colour))
    })
    m.count = specs.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    invalidate()
  }, [specs, state, lift, invalidate])
  return <instancedMesh ref={ref} args={[hexGeo, mat, Math.max(1, specs.length)]} renderOrder={renderOrder} frustumCulled={false} />
}

function Outlines({ specs, lift, renderOrder, state }: { specs: HexFillSpec[]; lift: number; renderOrder: number; state: GameState }): ReactElement | null {
  const ref = useRef<LineSegments>(null)
  const invalidate = useThree((s) => s.invalidate)
  const geo = useMemo(() => {
    const pos: number[] = [], col: number[] = []
    const c = new Color()
    for (const sp of specs) {
      const w = worldOf(state, sp.hex)
      const y = hexTopY(state, sp.hex) + lift + 0.004
      const pts = hexCorners(w.x, w.z, 0.97)
      c.set(sp.colour)
      for (let i = 0; i < 6; i++) {
        const a = pts[i]!, b = pts[(i + 1) % 6]!
        pos.push(a[0], y, a[1], b[0], y, b[1])
        col.push(c.r, c.g, c.b, c.r, c.g, c.b)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new Float32BufferAttribute(col, 3))
    return g
  }, [specs, state, lift])
  useEffect(() => () => geo.dispose(), [geo])
  useEffect(() => { invalidate() }, [geo, invalidate])
  if (!specs.length) return null
  return <lineSegments ref={ref} geometry={geo} renderOrder={renderOrder + 1} frustumCulled={false}><lineBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} /></lineSegments>
}

/** Draws fills (grouped by opacity) and outlines for a list of specs. */
export function HexFill({ specs, lift = 0.02, renderOrder = 3 }: Props): ReactElement | null {
  const state = usePresentedState()
  const buckets = useMemo(() => {
    const m = new Map<number, HexFillSpec[]>()
    for (const s of specs) if (!s.outline) { const l = m.get(s.opacity) ?? []; l.push(s); m.set(s.opacity, l) }
    return [...m.entries()]
  }, [specs])
  const outlines = useMemo(() => specs.filter((s) => s.outline), [specs])
  if (!state) return null
  return (
    <group>
      {buckets.map(([op, list]) => <FillBucket key={`${op}:${list.length}`} specs={list} opacity={op} lift={lift} renderOrder={renderOrder} state={state} />)}
      <Outlines specs={outlines} lift={lift} renderOrder={renderOrder} state={state} />
    </group>
  )
}
