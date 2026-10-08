// Board overlays (50 sections 6 and 7): reach highlights, path preview, facing picker, firing arcs, LOS lines, range rings and
// the ruler. All numbers come from the engine through the contract hooks; this file only draws them.
import { useEffect, useMemo, type ReactElement } from 'react'
import { Line } from '@react-three/drei'
import { Shape, ShapeGeometry, DoubleSide, type Object3D } from 'three'
import { LEVEL_HEIGHT, query, type Facing, type GameState, type Hex, type UnitId } from '../../engine/index'
import { hexesWithin } from '../../engine/hex'
import {
  findReachEntry, groupReach, hexName, queryDistance, unitName, uiActions, useActiveUnitId, useArcs, useFireDraft, useHoverHex, useHoverUnitId, useLos,
  useMeasure, useMoveDraft, usePhysicalDraft, usePresentedState, usePrompt, useReach, useSelectedId, useShowRanges, useUiMode, useForceColour, MOVE_MODE_LABELS,
} from '../contract'
import { bundle } from '../store/setup'
import { buildProceduralRig, setPose, REST_POSE } from '../figures/rig'
import { yawForFacing } from '../figures/facing'
import { profileOf } from '../figures/profile'
import { resolvePaint, usePaintStore } from '../figures/paintStore'
import { hexTopY } from '../figures/unitFrame'
import { WorldLabel } from '../figures/worldLabels'
import { HexFill, HEX_R } from './HexFill'
import {
  BAND_COLOURS, BAND_WORDS, LOS_COLOUR_HEX, arcFills, attackTargets, bandOfDistance, facingChoices, losView, pathView, reachFillSpecs, sameHex,
  type HexFillSpec, type RangesData, type RingBand,
} from './overlayModel'
import { chooseFacing, confirmDraft, deployZone, deployUnitId } from './controller'
import { interactionActions, useInteractionStore } from './store'
import { THEME_COLOURS } from './labels'

const LABEL_STYLE: React.CSSProperties = { pointerEvents: 'none', color: '#e8e6e1', font: '600 11px system-ui', textShadow: '0 1px 3px #000', whiteSpace: 'nowrap' }

function worldOf(state: GameState, h: Hex, lift = 0): [number, number, number] {
  const w = query.hexToWorld(state, h)
  return [w.x, hexTopY(state, h) + lift, w.z]
}

/** Text chip anchored in the world (DOM, no pointer events). */
function Label({ pos, children, tone }: { pos: [number, number, number]; children: React.ReactNode; tone?: string }): ReactElement {
  return (
    <WorldLabel position={pos}>
      <span style={{ ...LABEL_STYLE, background: '#14161acc', border: `1px solid ${tone ?? '#3a3f49'}`, borderRadius: 6, padding: '1px 5px' }}>{children}</span>
    </WorldLabel>
  )
}

// =====================================================================================================
// Reach (move mode) and deployment zone
// =====================================================================================================
export function ReachOverlay(): ReactElement | null {
  const p = usePrompt()
  const mode = useUiMode()
  const draft = useMoveDraft()
  const state = usePresentedState()
  const unitId = p?.kind === 'move' ? p.unitId : null
  const entries = useReach(unitId)
  const specs = useMemo<HexFillSpec[]>(() => {
    if (mode !== 'move' || !state) return []
    const out: HexFillSpec[] = []
    if (p?.kind === 'deploy') {
      for (const h of deployZone()) out.push({ hex: h, colour: THEME_COLOURS.accent, opacity: 0.28, kind: 'zone' })
    } else if (p?.kind === 'move') {
      out.push(...reachFillSpecs(entries, draft.mode))
      for (const [id] of attackTargets(entries, draft.mode)) {
        const u = state.units[id]
        if (u?.pos) out.push({ hex: u.pos, colour: THEME_COLOURS.heat, opacity: 0.95, outline: true, kind: 'attack-target' })
      }
    }
    if (draft.hex) out.push({ hex: draft.hex, colour: THEME_COLOURS.accent, opacity: 0.95, outline: true, kind: 'locked' })
    return out
  }, [mode, p?.kind, p?.id, entries, draft.mode, draft.hex, state])
  if (!specs.length) return null
  return <HexFill specs={specs} />
}

// =====================================================================================================
// Path preview
// =====================================================================================================
export function PathPreview(): ReactElement | null {
  const p = usePrompt()
  const mode = useUiMode()
  const draft = useMoveDraft()
  const hover = useHoverHex()
  const state = usePresentedState()
  const unitId = p?.kind === 'move' ? p.unitId : null
  const entries = useReach(unitId)
  const entry = useMemo(() => {
    if (!unitId || mode !== 'move') return null
    if (draft.hex) return findReachEntry(entries, draft)
    if (hover) return findReachEntry(entries, { mode: draft.mode, hex: hover, facing: null, attack: false })
    return null
  }, [unitId, mode, entries, draft, hover])
  const view = useMemo(() => (entry ? pathView(entry) : null), [entry])
  if (!entry || !view || !state) return null
  const lift = 0.07
  if (view.jump) {
    const from = entry.path[0] ? worldOf(state, entry.path[0].hex, lift) : null
    const here = state.units[unitId!]?.pos
    const start = from ?? (here ? worldOf(state, here, lift) : worldOf(state, entry.hex, lift))
    const end = worldOf(state, entry.hex, lift)
    const hexes = Math.max(1, entry.hexesMoved || (here ? queryDistance(here, entry.hex) : 1))
    const apex = Math.min(2.0, 0.6 + 0.15 * hexes)
    const pts = Array.from({ length: 17 }, (_, i) => { const t = i / 16; return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t + Math.sin(Math.PI * t) * apex, start[2] + (end[2] - start[2]) * t] as [number, number, number] })
    return (
      <group>
        <Line points={pts} color={THEME_COLOURS.reachJump} lineWidth={2} dashed dashSize={0.12} gapSize={0.08} />
        <Label pos={[end[0], end[1] + 0.3, end[2]]} tone={THEME_COLOURS.reachJump}>{MOVE_MODE_LABELS.jump} · {entry.mpUsed} MP</Label>
      </group>
    )
  }
  const stepsOnly = view.steps.filter((s) => !s.turn)
  const startHex = state.units[unitId!]?.pos ?? null // null while off the board (edge entry): the path starts at the entry hex
  const line = [...(startHex ? [worldOf(state, startHex, lift)] : []), ...stepsOnly.map((s) => worldOf(state, s.hex, lift))]
  const colour = entry.mode === 'run' ? THEME_COLOURS.reachRun : THEME_COLOURS.reachWalk
  const turns = view.steps.filter((s) => s.turn).length
  return (
    <group>
      {line.length > 1 && <Line points={line} color={colour} lineWidth={2.5} />}
      {stepsOnly.map((s, i) => {
        const pos = worldOf(state, s.hex, lift + 0.02)
        const last = i === stepsOnly.length - 1
        return (
          <group key={i}>
            <mesh position={pos} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}><circleGeometry args={[last ? 0.07 : 0.05, 12]} /><meshBasicMaterial color={s.backward ? THEME_COLOURS.hazard : colour} depthWrite={false} /></mesh>
            {(last || s.chips.length > 0 || s.psr) && (
              <Label pos={[pos[0], pos[1] + 0.18, pos[2]]} tone={s.psr ? THEME_COLOURS.hazard : colour}>
                {s.cumulative} MP{s.backward ? ' (back)' : ''}{s.chips.length ? ` · ${s.chips.join(' ')}` : ''}{s.psr ? ` · ⚠ ${s.psr.label}: PSR` : ''}
              </Label>
            )}
          </group>
        )
      })}
      {turns > 0 && stepsOnly.length === 0 && <Label pos={worldOf(state, entry.hex, 0.4)} tone={colour}>{view.total} MP</Label>}
    </group>
  )
}

// =====================================================================================================
// Facing picker (with the figure ghost, attack chips and the confirm chip)
// =====================================================================================================
const arrowGeo = ((): ShapeGeometry => {
  const s = new Shape()
  s.moveTo(0, 0.2); s.lineTo(-0.12, -0.04); s.lineTo(0, 0.03); s.lineTo(0.12, -0.04); s.closePath()
  return new ShapeGeometry(s).rotateX(-Math.PI / 2) // points north (-z) on the table
})()

function GhostFigure({ unitId, hex, facing }: { unitId: UnitId; hex: Hex; facing: Facing }): ReactElement | null {
  const state = usePresentedState()
  const u = state?.units[unitId]
  const colour = useForceColour(u?.owner ?? 'A')
  const over = usePaintStore((s) => (u ? s.bySide[u.owner] : undefined))
  const rig = useMemo(() => {
    if (!u) return null
    const prof = profileOf(u)
    const r = buildProceduralRig(prof.cls, prof.style, resolvePaint(colour, over))
    for (const m of r.glowMats) { m.transparent = true; m.opacity = 0.42; m.depthWrite = false }
    setPose(r, REST_POSE)
    return r
  }, [u?.mechId, u?.tonnage, colour, over])
  useEffect(() => () => rig?.dispose(), [rig])
  if (!state || !rig) return null
  const pos = worldOf(state, hex, 0)
  return <group position={pos} rotation={[0, yawForFacing(facing), 0]}><primitive object={rig.root as Object3D} /></group>
}

export function FacingPicker(): ReactElement | null {
  const p = usePrompt()
  const mode = useUiMode()
  const draft = useMoveDraft()
  const state = usePresentedState()
  const hoverFacing = useInteractionStore((s) => s.hoverFacing)
  const attackTarget = useInteractionStore((s) => s.attackTarget)
  const unitId = p?.kind === 'move' ? p.unitId : p?.kind === 'deploy' ? deployUnitId() : null
  const entries = useReach(p?.kind === 'move' ? unitId : null)
  const choices = useMemo(() => {
    if (!draft.hex) return []
    if (p?.kind === 'deploy') return ([0, 1, 2, 3, 4, 5] as Facing[]).map((f) => ({ facing: f, enabled: true, mp: null as number | null }))
    return facingChoices(entries, draft.hex, draft.mode, draft.attack)
  }, [draft.hex, draft.mode, draft.attack, entries, p?.kind])
  const group = useMemo(() => (draft.hex ? groupReach(entries.filter((e) => e.mode === draft.mode)).get(`${draft.hex.q},${draft.hex.r}`) : undefined), [entries, draft.hex, draft.mode])
  if (mode !== 'move' || !state || !draft.hex || !unitId || !choices.length) return null
  const centre = worldOf(state, draft.hex, 0.05)
  const shown: Facing | null = hoverFacing ?? draft.facing
  const attacks = group?.attacks ?? []
  const confirmable = draft.facing !== null
  const chosenEntry = p?.kind === 'move' && confirmable ? findReachEntry(entries, draft) : null
  return (
    <group>
      {shown !== null && choices[shown]?.enabled && <GhostFigure unitId={unitId} hex={draft.hex} facing={shown} />}
      {choices.map((c) => {
        const a = (c.facing * Math.PI) / 3
        const dx = Math.sin(Math.PI - a), dz = Math.cos(Math.PI - a)
        const pos: [number, number, number] = [centre[0] + dx * 0.66, centre[1] + 0.02, centre[2] + dz * 0.66]
        const chosen = draft.facing === c.facing
        const col = !c.enabled ? '#555a63' : chosen ? THEME_COLOURS.accent : THEME_COLOURS.reachWalk
        return (
          <group key={c.facing} position={pos} rotation={[0, -a, 0]}>
            <mesh
              geometry={arrowGeo} scale={chosen ? 1.5 : 1.2} renderOrder={9}
              onClick={(e) => { if (e.nativeEvent.button !== 0 || e.delta > 4 || !c.enabled) return; e.stopPropagation(); chooseFacing(c.facing) }}
              onPointerOver={(e) => { if (!c.enabled) return; e.stopPropagation(); interactionActions.setHoverFacing(c.facing) }}
              onPointerOut={() => interactionActions.setHoverFacing(null)}
            >
              <meshBasicMaterial color={col} transparent opacity={c.enabled ? 0.95 : 0.35} side={DoubleSide} depthTest={false} />
            </mesh>
            {c.enabled && c.mp !== null && (
              <WorldLabel position={[centre[0] + dx * 0.9, centre[1] + 0.04, centre[2] + dz * 0.9]}>
                <span style={{ ...LABEL_STYLE, fontSize: 10 }} data-testid={`board-facing-mp-${c.facing}`}>{c.mp}</span>
              </WorldLabel>
            )}
          </group>
        )
      })}
      <WorldLabel position={[centre[0], centre[1] + 0.55, centre[2]]} pointer z={9}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', background: '#1e2127ee', border: `1px solid ${THEME_COLOURS.accent}`, borderRadius: 8, padding: 4, font: '600 11px system-ui', color: '#e8e6e1' }} data-testid="board-picker">
          {attacks.length > 0 && (
            <>
              <button type="button" data-testid="board-move-here" aria-pressed={!draft.attack} style={chipStyle(!draft.attack)} onClick={() => { interactionActions.setAttackTarget(null); uiActions.setMoveDraft({ attack: false, facing: null }) }}>Move here</button>
              {attacks.map((a) => (
                <button type="button" key={a.physical!.targetId} data-testid={`board-attack-${a.physical!.targetId}`} aria-pressed={draft.attack && attackTarget === a.physical!.targetId} style={chipStyle(draft.attack && attackTarget === a.physical!.targetId)}
                  onClick={() => { interactionActions.setAttackTarget(a.physical!.targetId); uiActions.setMoveDraft({ attack: true, facing: null }) }}>
                  {a.physical!.kind === 'dfa' ? 'DFA' : 'Charge'} {unitName(state, a.physical!.targetId)}
                </button>
              ))}
            </>
          )}
          <button type="button" disabled={!confirmable} data-testid="board-confirm" style={{ ...chipStyle(confirmable), opacity: confirmable ? 1 : 0.5 }} onClick={() => confirmDraft()}>
            Confirm{chosenEntry ? ` · ${chosenEntry.mpUsed} MP` : ''}
          </button>
          <button type="button" data-testid="board-cancel" style={chipStyle(false)} onClick={() => { uiActions.resetMoveDraft(); interactionActions.setAttackTarget(null) }}>Reset</button>
        </div>
      </WorldLabel>
    </group>
  )
}
const chipStyle = (on: boolean): React.CSSProperties => ({
  font: '600 11px system-ui', color: on ? '#14161a' : '#e8e6e1', background: on ? THEME_COLOURS.accent : '#2a2e36', border: '1px solid #3a3f49', borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
})

// =====================================================================================================
// Firing arcs
// =====================================================================================================
export function ArcOverlay(): ReactElement | null {
  const p = usePrompt()
  const mode = useUiMode()
  const draft = useFireDraft()
  const unitId = mode === 'fire' && (p?.kind === 'torsoTwist' || p?.kind === 'declareFire') ? p.unitId : null
  const arcs = useArcs(unitId, draft.twist)
  const fills = useMemo(() => arcFills(arcs), [arcs])
  const specs = useMemo<HexFillSpec[]>(() => [...fills.fills, ...fills.frontOutline.map((h) => ({ hex: h, colour: '#c9d6e6', opacity: 0.5, outline: true, kind: 'front' }))], [fills])
  if (!unitId || !specs.length) return null
  return <HexFill specs={specs} lift={0.015} />
}

// =====================================================================================================
// LOS lines
// =====================================================================================================
const debugLos = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === 'los'

export function LosLayer(): ReactElement | null {
  const p = usePrompt()
  const mode = useUiMode()
  const fire = useFireDraft()
  const phys = usePhysicalDraft()
  const hoverUnit = useHoverUnitId()
  const hoverHex = useHoverHex()
  const selected = useSelectedId()
  const active = useActiveUnitId()
  const { from: mFrom, to: mTo } = useMeasure()
  const state = usePresentedState()
  const attackerId = p?.unitId ?? active
  const hoverEnemy = state && hoverUnit && attackerId && state.units[hoverUnit]?.owner !== state.units[attackerId]?.owner ? hoverUnit : null
  let from: UnitId | Hex | null = null, to: UnitId | Hex | null = null
  if (mode === 'los') {
    from = mFrom ?? (selected ? state?.units[selected]?.pos ?? null : null)
    to = mTo ?? hoverHex
  } else if (mode === 'fire') { from = attackerId ?? null; to = fire.targetId ?? hoverEnemy }
  else if (mode === 'physical') { from = attackerId ?? null; to = phys.targetId ?? hoverEnemy }
  else if (debugLos() && selected) { from = selected; to = hoverEnemy }
  const verdict = useLos(from, to)
  const view = useMemo(() => losView(verdict), [verdict])
  if (!view || !state || view.hexes.length < 2) return null
  const colour = LOS_COLOUR_HEX[view.colour]
  const lift = 0.5
  const pts = view.hexes.map((h) => worldOf(state, h, lift))
  const alt = view.alt?.map((h) => worldOf(state, h, lift)) ?? null
  const blockers = view.blockers.map((h): HexFillSpec => ({ hex: h, colour: THEME_COLOURS.heat, opacity: 0.3, kind: 'blocker' }))
  // two-level rules column ghost at both ends (the figures are drawn a little taller than the rules say)
  const colH = 2 * LEVEL_HEIGHT
  const ends = [view.hexes[0]!, view.hexes[view.hexes.length - 1]!]
  return (
    <group>
      <Line points={pts} color={colour} lineWidth={3} />
      {alt && <Line points={alt} color={colour} lineWidth={2} dashed dashSize={0.1} gapSize={0.08} />}
      {blockers.length > 0 && <HexFill specs={blockers} />}
      {mode === 'los' && ends.map((h, i) => {
        const w = worldOf(state, h, colH / 2)
        return <mesh key={i} position={w} renderOrder={4}><cylinderGeometry args={[HEX_R * 0.5, HEX_R * 0.5, colH, 16, 1, true]} /><meshBasicMaterial color={colour} transparent opacity={0.14} depthWrite={false} side={DoubleSide} /></mesh>
      })}
      {view.chips.map((c, i) => {
        const at = c.hex ?? view.hexes[Math.floor(view.hexes.length / 2)]!
        const pos = worldOf(state, at, lift + 0.12 + i * 0.28)
        return <Label key={i} pos={pos} tone={colour}>{c.text}</Label>
      })}
      {view.chips.length === 0 && view.colour === 'clear' && <Label pos={worldOf(state, view.hexes[Math.floor(view.hexes.length / 2)]!, lift + 0.12)} tone={colour}>clear</Label>}
    </group>
  )
}

// =====================================================================================================
// Range rings
// =====================================================================================================
interface WeaponRanges { mountId: string; name: string; ranges: RangesData }

/** Ranges (data) of the unit's mounts. */
export function weaponRangesOf(state: GameState, unitId: UnitId): WeaponRanges[] {
  const u = state.units[unitId]
  if (!u) return []
  const out: WeaponRanges[] = []
  for (const m of Object.values(u.mounts)) {
    if (m.destroyed) continue
    const w = bundle().weapons[m.item] as { name?: string; shortName?: string; ranges?: RangesData } | undefined
    if (w?.ranges) out.push({ mountId: m.id, name: w.shortName ?? w.name ?? m.item, ranges: w.ranges })
  }
  return out
}

export function RangeRings(): ReactElement | null {
  const p = usePrompt()
  const mode = useUiMode()
  const showAll = useShowRanges()
  const fire = useFireDraft()
  const hoverWeapon = useInteractionStore((s) => s.hoverWeapon)
  const active = useActiveUnitId()
  const state = usePresentedState()
  const unitId = p?.unitId ?? active
  const specs = useMemo<HexFillSpec[]>(() => {
    if (!state || !unitId || mode !== 'fire') return []
    const u = state.units[unitId]
    if (!u?.pos) return []
    const all = weaponRangesOf(state, unitId)
    const chosen = hoverWeapon ? all.filter((w) => w.mountId === hoverWeapon)
      : showAll ? (fire.shots.length ? all.filter((w) => fire.shots.some((s) => s.mountId === w.mountId)) : all) : []
    if (!chosen.length) return []
    const far = Math.max(...chosen.map((w) => w.ranges.long))
    const order: RingBand[] = ['short', 'medium', 'long']
    const out: HexFillSpec[] = []
    for (const h of hexesWithin(u.pos, far)) {
      const d = queryDistance(u.pos, h)
      if (d === 0) continue
      let best: RingBand | null = null
      let allMin = true
      for (const w of chosen) {
        const b = bandOfDistance(w.ranges, d)
        if (b && b !== 'min') { allMin = false; if (!best || order.indexOf(b) < order.indexOf(best)) best = b }
        else if (b === 'min') { /* inside the minimum of this weapon */ } else allMin = false
      }
      if (best) out.push({ hex: h, colour: BAND_COLOURS[best], opacity: 0.16, kind: best })
      else if (allMin) out.push({ hex: h, colour: BAND_COLOURS.min, opacity: 0.8, outline: true, kind: 'min' })
    }
    return out
  }, [state, unitId, mode, showAll, hoverWeapon, fire.shots])
  if (!specs.length) return null
  return <HexFill specs={specs} lift={0.012} />
}

// =====================================================================================================
// Ruler
// =====================================================================================================
export function Ruler(): ReactElement | null {
  const mode = useUiMode()
  const { from, to } = useMeasure()
  const hover = useHoverHex()
  const selected = useSelectedId()
  const state = usePresentedState()
  const end = to ?? hover
  const view = useMemo(() => {
    if (!state || mode !== 'measure' || !from || !end || sameHex(from, end)) return null
    const d = queryDistance(from, end)
    // bands of the selected unit's weapons at that distance (data ranges bucketed; the engine prices real shots)
    const groups = new Map<RingBand, string[]>()
    if (selected) for (const w of weaponRangesOf(state, selected)) {
      const b = bandOfDistance(w.ranges, d)
      if (b) groups.set(b, [...(groups.get(b) ?? []), w.name])
    }
    const bands = (['short', 'medium', 'long', 'min'] as RingBand[]).filter((b) => groups.has(b)).map((b) => `${BAND_WORDS[b]}: ${groups.get(b)!.join(', ')}`)
    return { d, bands }
  }, [state, mode, from, end, selected])
  if (!state || !from || !view || !end) return null
  const a = worldOf(state, from, 0.3), b = worldOf(state, end, 0.3)
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 0.15, (a[2] + b[2]) / 2]
  return (
    <group>
      <Line points={[a, b]} color={THEME_COLOURS.accent} lineWidth={2.5} />
      <HexFill specs={[{ hex: from, colour: THEME_COLOURS.accent, opacity: 0.9, outline: true, kind: 'ruler' }, { hex: end, colour: THEME_COLOURS.accent, opacity: 0.9, outline: true, kind: 'ruler' }]} />
      <Label pos={mid} tone={THEME_COLOURS.accent}><span data-testid="ruler-label">{view.d} {view.d === 1 ? 'hex' : 'hexes'}{view.bands.length ? ` · ${view.bands.join(' · ')}` : ''}</span></Label>
      <Label pos={[a[0], a[1] + 0.15, a[2]]}>{hexName(state, from)}</Label>
    </group>
  )
}
