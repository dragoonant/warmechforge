// Threat overlay (T, or the top bar's Threat button): for the hovered hex (else the selected or acting unit's hex), the enemy
// 'Mechs and weapons that can reach it from where they stand, and the expected damage a standing 'Mech there would take
// (engine query.threat; the weapon list comes from query.attackPreview with the same target the threat query uses). The hex
// and its neighbours are tinted by that expected damage; each enemy that can reach it gets a ring and a label. Every number
// is the engine's. Mounted inside the board canvas by GameScreen through optionalOverlays (ThreatLayer).
import { useMemo, type ReactElement } from 'react'
import { query, type GameState, type Hex, type PlayerId, type UnitId } from '../../engine/index'
import { hexesWithin } from '../../engine/hex'
import {
  unitName, useActiveUnitId, useControllers, useHoverHex, usePresentedState, useSelectedId, useShowThreat,
} from '../contract'
import { bundle } from '../store/setup'
import { hexTopY } from '../figures/unitFrame'
import { WorldLabel } from '../figures/worldLabels'
import { HexFill } from './HexFill'
import type { HexFillSpec } from './overlayModel'

export interface ThreatSource { unitId: UnitId; name: string; hex: Hex; expected: number; weapons: string[] }
export interface ThreatModel {
  focus: Hex
  /** The side whose 'Mech would stand at the hex; the threat comes from the other side. */
  viewer: PlayerId
  expected: number
  sources: ThreatSource[]
  /** Expected damage on the focus hex and its on-board neighbours. */
  cells: { hex: Hex; expected: number }[]
}

const other = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A')
const key = (h: Hex): string => `${h.q},${h.r}`
const live = (state: GameState, id: UnitId): boolean => {
  const u = state.units[id]
  return !!u && (u.status === 'active' || u.status === 'withdrawing') && !!u.pos && !u.doomed
}

/** Enemy weapons (display names) with a legal shot at a standing 'Mech on the hex, as query.threat counts them. */
function weaponsReaching(state: GameState, attackerId: UnitId, hex: Hex): string[] {
  const u = state.units[attackerId]!
  const stand = state.unitOrder.map((x) => state.units[x]!).find((t) => t.owner !== u.owner)
  if (!stand) return []
  const b = bundle()
  const names: string[] = []
  for (const m of Object.values(u.mounts)) {
    const w = (b.weapons as Record<string, { name?: string } | undefined>)[m.item]
    if (!w) continue
    const p = query.attackPreview(state, { attackerId, mountId: m.id, targetId: stand.id, targetAt: { hex, prone: false, tmm: 0, jumped: false, immobile: false } })
    if (p.legal && p.expectedDamage > 0) names.push(w.name ?? m.item)
  }
  return names
}

/** Pure model of the overlay (exported for tests): threat on the focus hex from the viewer's enemies, and on its neighbours. */
export function threatModel(state: GameState, focus: Hex, viewer: PlayerId, radius = 1): ThreatModel {
  const enemy = other(viewer)
  const onBoard = new Set(Object.values(state.board.hexes).map((h) => key(h.hex)))
  const tv = query.threat(state, focus)
  const sources: ThreatSource[] = []
  for (const s of tv.sources) {
    const u = state.units[s.unitId]
    if (!u || u.owner !== enemy || !u.pos || !live(state, s.unitId) || s.expectedDamage <= 0) continue
    sources.push({ unitId: s.unitId, name: unitName(state, s.unitId), hex: u.pos, expected: s.expectedDamage, weapons: weaponsReaching(state, s.unitId, focus) })
  }
  sources.sort((a, b) => b.expected - a.expected)
  const cells: ThreatModel['cells'] = []
  for (const h of hexesWithin(focus, radius)) {
    if (!onBoard.has(key(h))) continue
    const e = h.q === focus.q && h.r === focus.r ? tv.bySide[enemy] : query.threat(state, h).bySide[enemy]
    cells.push({ hex: h, expected: e })
  }
  return { focus, viewer, expected: tv.bySide[enemy], sources, cells }
}

/** Tint for an expected-damage value (none below half a point). */
export function threatTint(d: number): { colour: string; opacity: number } | null {
  if (d < 0.5) return null
  const colour = d < 4 ? '#e0c341' : d < 10 ? '#e08a1e' : '#d0402b'
  return { colour, opacity: Math.round((0.22 + Math.min(0.4, d / 40)) * 100) / 100 }
}

const LABEL: React.CSSProperties = {
  pointerEvents: 'none', color: '#e8e6e1', font: '600 11px system-ui', textShadow: '0 1px 3px #000', whiteSpace: 'nowrap',
  background: '#14161acc', borderRadius: 6, padding: '1px 5px',
}

function shortList(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  const parts = [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} x${c}` : n))
  return parts.length > 3 ? `${parts.slice(0, 3).join(', ')} +${parts.length - 3}` : parts.join(', ')
}

export function ThreatOverlay(): ReactElement | null {
  const show = useShowThreat()
  const state = usePresentedState()
  const hover = useHoverHex()
  const selectedId = useSelectedId()
  const activeId = useActiveUnitId()
  const controllers = useControllers()
  const model = useMemo<ThreatModel | null>(() => {
    if (!show || !state) return null
    const focusUnit = [selectedId, activeId].map((id) => (id ? state.units[id] : undefined)).find((u) => u?.pos)
    const focus = hover ?? focusUnit?.pos ?? null
    if (!focus) return null
    // whose 'Mech would stand there: the human's side; with no human (or two), the focused unit's side
    const humans = (['A', 'B'] as PlayerId[]).filter((p) => controllers[p] === 'human')
    const viewer: PlayerId = humans.length === 1 ? humans[0]! : focusUnit?.owner ?? 'A'
    try { return threatModel(state, focus, viewer) } catch { return null }
  }, [show, state, hover?.q, hover?.r, selectedId, activeId, controllers])
  const specs = useMemo<HexFillSpec[]>(() => {
    if (!model) return []
    const out: HexFillSpec[] = []
    for (const c of model.cells) { const t = threatTint(c.expected); if (t) out.push({ hex: c.hex, colour: t.colour, opacity: t.opacity, kind: 'threat' }) }
    out.push({ hex: model.focus, colour: '#e8e6e1', opacity: 0.95, outline: true, kind: 'threat-focus' })
    for (const s of model.sources) out.push({ hex: s.hex, colour: threatTint(s.expected)?.colour ?? '#e0c341', opacity: 0.95, outline: true, kind: 'threat-source' })
    return out
  }, [model])
  if (!model || !state) return null
  const at = (h: Hex, lift: number): [number, number, number] => { const w = query.hexToWorld(state, h); return [w.x, hexTopY(state, h) + lift, w.z] }
  return (
    <group name="wmf-threat">
      <HexFill specs={specs} lift={0.03} renderOrder={4} />
      <WorldLabel position={at(model.focus, 0.25)}>
        <span data-testid="threat-focus-label" style={{ ...LABEL, border: '1px solid #d0402b' }}>
          {model.sources.length ? `Threat ${model.expected.toFixed(1)} dmg from ${model.sources.length} 'Mech${model.sources.length > 1 ? 's' : ''}` : 'No enemy weapon reaches this hex'}
        </span>
      </WorldLabel>
      {model.sources.map((s) => (
        <WorldLabel key={s.unitId} position={at(s.hex, 1.1)}>
          <span data-testid="threat-source-label" style={{ ...LABEL, border: `1px solid ${threatTint(s.expected)?.colour ?? '#3a3f49'}` }}>
            {s.name}: {s.expected.toFixed(1)}{s.weapons.length ? ` (${shortList(s.weapons)})` : ''}
          </span>
        </WorldLabel>
      ))}
    </group>
  )
}

export default ThreatOverlay
