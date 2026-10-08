// ?gallery: every 'Mech on a turntable, procedural kit and GLB side by side (the owner gate of 30-figures section 1), with the
// twist, arm-loss, prone, shutdown, heat and per-location damage toggles, base ring, LOS column ghost and army painter.
// Self-contained: it builds rigs straight from rig.ts and needs no game state. Default export (App lazy-loads it).
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Group } from 'three'
import type { Loc, UnitState } from '../../engine/index'
import { LEVEL_HEIGHT } from '../../engine/index'
import { bundle } from '../store/setup'
import { BASE_RADIUS_BY_CLASS, HEIGHT_BY_CLASS, BASE_THICKNESS, weightClassOf, type WeightClass } from './figureConstants'
import { cloneGlb, glbStatus, useGlbScene } from './glbLoader'
import { enabledSlugs, glbSlugFor, useGlbManifestReady } from './glbModels'
import { PAINT_PRESETS, resolvePaint, type ResolvedPaint } from './paintStore'
import { chassisKey, styleFor, type FigureStyle } from './profile'
import { REST_POSE, applyStatus, buildGlbRig, buildProceduralRig, setGlow, setPose, type MechRig } from './rig'
import { unitVisual } from './visuals'
import { WorldLabel, WorldLabels } from './worldLabels'

export const galleryRequested = (search = typeof location !== 'undefined' ? location.search : ''): boolean => new URLSearchParams(search).has('gallery')

/** Tonnages for GLB slugs whose chassis is not in the data yet (the gallery still shows them). */
const EXTRA_TONNAGE: Record<string, number> = { regent: 85 }

export interface GalleryItem { id: string; chassis: string; key: string; tonnage: number; cls: WeightClass; style: FigureStyle; slug: string | undefined }

/** One item per chassis: every 'Mech in the data bundle plus every enabled GLB slug (de-duplicated by chassis key). */
export function galleryItems(): GalleryItem[] {
  const out = new Map<string, GalleryItem>()
  for (const m of Object.values(bundle().mechs) as { chassis: string; tonnage: number; figure?: string }[]) {
    const key = chassisKey(m.chassis)
    if (out.has(key)) continue
    out.set(key, { id: key, chassis: m.chassis, key, tonnage: m.tonnage, cls: weightClassOf(m.tonnage), style: styleFor(key), slug: glbSlugFor(key, m.figure) })
  }
  for (const slug of enabledSlugs()) {
    const key = slug.replace(/^bt-/, '')
    if (out.has(key)) continue
    const tonnage = EXTRA_TONNAGE[key] ?? 75
    out.set(key, { id: key, chassis: key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), key, tonnage, cls: weightClassOf(tonnage), style: styleFor(key), slug })
  }
  return [...out.values()].sort((a, b) => a.tonnage - b.tonnage || a.key.localeCompare(b.key))
}

interface Controls {
  rotate: boolean; baseRing: boolean; los: boolean; prone: boolean; shutdown: boolean; destroyed: boolean; pilotDown: boolean
  twist: -1 | 0 | 1; flip: boolean; heat: number; lost: Set<Loc>; exposed: Set<Loc>
}
const INITIAL: Controls = { rotate: true, baseRing: false, los: false, prone: false, shutdown: false, destroyed: false, pilotDown: false, twist: 0, flip: false, heat: 0, lost: new Set(), exposed: new Set() }
const ALL_LOCS: Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']

/** A synthetic unit for `unitVisual` (the gallery has no engine state). */
function fakeUnit(c: Controls): Parameters<typeof unitVisual>[0] {
  const locs = {} as UnitState['locs']
  for (const l of ALL_LOCS) locs[l] = { armor: c.exposed.has(l) ? 0 : 10, rear: null, structure: c.lost.has(l) ? 0 : 10, maxArmor: 10, maxRear: null, maxStructure: 10, destroyed: c.lost.has(l), destroyedCause: c.lost.has(l) ? 'damage' : null }
  return {
    status: c.destroyed ? 'destroyed' : 'active', prone: c.prone, shutdown: c.shutdown ? { cause: 'heat', turn: 0 } : null, heat: c.heat,
    pilot: { pilotId: null, name: 'Test', gunnery: 4, piloting: 5, hits: 0, conscious: !c.pilotDown, dead: false, koTurn: null, spas: [] },
    locs, attacks: { twist: c.twist, flipped: c.flip, twistPhase: null, rangedDeclared: false, physicalDeclared: false, primaryTargetId: null, propArm: null, firedMounts: [], charge: null, dfa: null },
  }
}

function GalleryFigure({ item, glb, paint, controls }: { item: GalleryItem; glb: boolean; paint: ResolvedPaint; controls: Controls }): ReactElement | null {
  const scene = useGlbScene(glb ? item.slug : undefined)
  const rig: MechRig | null = useMemo(() => {
    if (glb) return scene ? buildGlbRig(cloneGlb(scene), paint) : null
    return buildProceduralRig(item.cls, item.style, paint)
  }, [glb, scene, item.cls, item.style, paint])
  useEffect(() => () => rig?.dispose(), [rig])
  const live = useRef({ twist: 0, tip: 0 })
  const inv = useThree((s) => s.invalidate)
  useFrame((_, dt) => {
    if (!rig) return
    const v = unitVisual(fakeUnit(controls))
    applyStatus(rig, v)
    const s = live.current
    const k = Math.min(1, dt * 8)
    s.twist += (controls.twist - s.twist) * k
    s.tip += ((v.prone ? 1 : 0) - s.tip) * k
    setPose(rig, { ...REST_POSE, twist: s.twist, tip: s.tip, slump: v.shutdown ? 1 : 0, wreck: v.destroyed ? 1 : 0, flip: controls.flip ? 1 : 0 })
    setGlow(rig, v, performance.now() / 1000)
    inv()
  })
  if (!rig) return null
  return (
    <group>
      <primitive object={rig.root} />
      {controls.baseRing && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0]}><ringGeometry args={[rig.radius * 0.98, rig.radius * 1.08, 40]} /><meshBasicMaterial color="#c9a227" /></mesh>}
    </group>
  )
}

function Cell({ item, x, z, glb, paint, controls }: { item: GalleryItem; x: number; z: number; glb: boolean; paint: ResolvedPaint; controls: Controls }): ReactElement {
  const g = useRef<Group>(null)
  useFrame((_, dt) => { if (controls.rotate && g.current) g.current.rotation.y += dt * 0.6 })
  const H = HEIGHT_BY_CLASS[item.cls]
  const colH = 2 * LEVEL_HEIGHT
  const r = BASE_RADIUS_BY_CLASS[item.cls]
  const status = glb ? (item.slug ? glbStatus(item.slug) : 'none') : 'procedural'
  return (
    <group position={[x, 0, z]}>
      <group ref={g}>
        <GalleryFigure item={item} glb={glb} paint={paint} controls={controls} />
        {controls.los && <mesh position={[0, BASE_THICKNESS + colH / 2, 0]}><cylinderGeometry args={[r * 0.9, r * 0.9, colH, 20, 1, true]} /><meshBasicMaterial color="#6fd0ff" transparent opacity={0.18} depthWrite={false} /></mesh>}
      </group>
      <WorldLabel position={[x, 0, z + 0.62]}>
        <div data-testid={`gallery-item-${item.id}${glb ? '-glb' : ''}`} style={{ color: '#e8e6e1', font: '600 11px system-ui', textShadow: '0 1px 3px #000', textAlign: 'center', whiteSpace: 'nowrap' }}>
          {item.chassis} · {glb ? 'GLB' : 'procedural'}
          <div style={{ font: '10px system-ui', color: '#9aa0aa' }}>{item.cls} · {H.toFixed(2)} · {glb ? status : item.tonnage + ' t'}</div>
        </div>
      </WorldLabel>
    </group>
  )
}

const panel: React.CSSProperties = { position: 'fixed', right: 12, top: 12, zIndex: 10, background: '#1b1e24ee', color: '#e8e6e1', border: '1px solid #3a3f49', borderRadius: 10, padding: 12, font: '13px system-ui', maxWidth: 320, maxHeight: 'calc(100vh - 24px)', overflow: 'auto' }

export default function Gallery(): ReactElement {
  const ready = useGlbManifestReady()
  const items = useMemo(() => galleryItems(), [ready])
  const [c, setC] = useState<Controls>(INITIAL)
  const [primary, setPrimary] = useState('#3b6ea8')
  const [secondary, setSecondary] = useState<string | undefined>(undefined)
  const paint = useMemo(() => resolvePaint(primary, secondary ? { secondary } : undefined), [primary, secondary])
  const bool = (k: 'rotate' | 'baseRing' | 'los' | 'prone' | 'shutdown' | 'destroyed' | 'pilotDown' | 'flip') => (
    <label key={k}><input type="checkbox" data-testid={`gallery-toggle-${k}`} checked={c[k]} onChange={() => setC((o) => ({ ...o, [k]: !o[k] }))} /> {LABELS[k]}</label>
  )
  const toggleLoc = (set: 'lost' | 'exposed', l: Loc) => setC((o) => { const n = new Set(o[set]); if (n.has(l)) n.delete(l); else n.add(l); return { ...o, [set]: n } })
  const armsLost = c.lost.has('LA') && c.lost.has('RA')
  const cols = items.length
  const xOf = (i: number) => (i - (cols - 1) / 2) * 1.35
  return (
    <div data-testid="gallery" style={{ position: 'fixed', inset: 0, background: '#14161a' }}>
      <div style={panel}>
        <strong>Figure gallery</strong> <span style={{ color: '#9aa0aa' }}>{items.length} chassis, {items.filter((i) => i.slug).length} with a GLB</span>
        <p style={{ color: '#9aa0aa', margin: '4px 0 8px' }}>Procedural kit (front row) and generated model (back row). Unofficial fan project.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>{(['rotate', 'baseRing', 'los', 'prone', 'shutdown', 'destroyed', 'pilotDown', 'flip'] as const).map(bool)}</div>
        <div style={{ margin: '8px 0' }}>Torso twist{' '}
          {([-1, 0, 1] as const).map((t) => <button key={t} type="button" data-testid={`gallery-twist-${t}`} aria-pressed={c.twist === t} style={{ fontWeight: c.twist === t ? 700 : 400, marginRight: 4 }} onClick={() => setC((o) => ({ ...o, twist: t }))}>{t === -1 ? 'left' : t === 0 ? 'centre' : 'right'}</button>)}
        </div>
        <div style={{ margin: '8px 0' }}>
          <button type="button" data-testid="gallery-toggle-armLoss" aria-pressed={armsLost} onClick={() => setC((o) => { const n = new Set(o.lost); if (armsLost) { n.delete('LA'); n.delete('RA') } else { n.add('LA'); n.add('RA') } return { ...o, lost: n } })}>{armsLost ? 'Restore arms' : 'Lose both arms'}</button>
        </div>
        <label>Heat <input type="range" min={0} max={30} value={c.heat} data-testid="gallery-heat" onChange={(e) => setC((o) => ({ ...o, heat: Number(e.target.value) }))} /> {c.heat}</label>
        <div style={{ marginTop: 6 }}>Destroy location</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{ALL_LOCS.map((l) => <button key={l} type="button" data-testid={`gallery-destroy-${l}`} aria-pressed={c.lost.has(l)} style={{ fontWeight: c.lost.has(l) ? 700 : 400 }} onClick={() => toggleLoc('lost', l)}>{l}</button>)}</div>
        <div style={{ marginTop: 6 }}>Armour gone (exposed)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{ALL_LOCS.map((l) => <button key={l} type="button" data-testid={`gallery-expose-${l}`} aria-pressed={c.exposed.has(l)} style={{ fontWeight: c.exposed.has(l) ? 700 : 400 }} onClick={() => toggleLoc('exposed', l)}>{l}</button>)}</div>
        <div style={{ borderTop: '1px solid #3a3f49', paddingTop: 6, marginTop: 8 }}>
          <div>Army painter</div>
          <label>Main <input type="color" value={primary} data-testid="gallery-paint-primary" onChange={(e) => setPrimary(e.target.value)} /></label>{' '}
          <label>Trim <input type="color" value={secondary ?? paint.secondary} data-testid="gallery-paint-secondary" onChange={(e) => setSecondary(e.target.value)} /></label>
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button type="button" onClick={() => { setPrimary('#3b6ea8'); setSecondary(undefined) }}>Reset</button>
            {PAINT_PRESETS.map((p) => <button key={p.id} type="button" onClick={() => { setPrimary(p.primary); setSecondary(p.secondary) }}>{p.label}</button>)}
          </div>
        </div>
        <p style={{ color: '#9aa0aa', margin: '8px 0 0', fontSize: 11 }}>Unofficial fan project, not affiliated with or endorsed by Catalyst Game Labs, Topps or Microsoft.</p>
      </div>
      <Canvas dpr={[1, 1.5]} shadows camera={{ fov: 38, near: 0.1, far: 100, position: [cols * 0.14, 3.0 + cols * 0.3, 2.4 + cols * 0.95] }}>
        <color attach="background" args={['#14161a']} />
        <hemisphereLight args={['#e6ebf5', '#4a4c44', 1.4]} />
        <directionalLight position={[4, 8, 5]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow><planeGeometry args={[cols * 1.5 + 8, 12]} /><meshStandardMaterial color="#2a2d33" roughness={1} /></mesh>
        <OrbitControls target={[cols * 0.14, 0.45, 0]} maxPolarAngle={Math.PI / 2.05} />
        <WorldLabels />
        {items.map((it, i) => (
          <group key={it.id}>
            <Cell item={it} x={xOf(i)} z={0.8} glb={false} paint={paint} controls={c} />
            {it.slug && <Cell item={it} x={xOf(i)} z={-0.8} glb paint={paint} controls={c} />}
          </group>
        ))}
      </Canvas>
    </div>
  )
}

const LABELS = { rotate: 'Turntable', baseRing: 'Base ring', los: 'LOS column (2 levels)', prone: 'Prone', shutdown: 'Shut down', destroyed: 'Destroyed', pilotDown: 'Pilot down', flip: 'Arm flip' } as const
