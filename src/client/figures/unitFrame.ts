// Where a unit stands on screen: world position, height, facing, twist and flags, from the PRESENTED state, following the
// move tween while one plays (display interpolation only; no rules). Pure so VFX, overlays and tests share it.
import { LEVEL_HEIGHT, query, type GameState, type Hex, type UnitId, type UnitState } from '../../engine/index'
import { hexToLabel } from '../../engine/hex'
import { sampleTween, ease } from '../presentation/beats'
import type { UnitTween } from '../presentation/presentedStore'
import { HEIGHT_BY_CLASS, weightClassOf } from './figureConstants'
import type { FigureFrame } from './sockets'

const levelCache = new WeakMap<GameState, Map<string, number>>()
/** Elevation level of a hex (0 when the engine cannot say). Memoised per state object. */
export function levelAt(state: GameState, hex: Hex): number {
  let m = levelCache.get(state)
  if (!m) { m = new Map(); levelCache.set(state, m) }
  const k = `${hex.q},${hex.r}`
  const hit = m.get(k)
  if (hit !== undefined) return hit
  let lv = 0
  try { lv = query.terrainInfo(state, hex).level } catch { lv = 0 }
  m.set(k, lv)
  return lv
}

/** World y of the top of a hex. */
export const hexTopY = (state: GameState, hex: Hex): number => levelAt(state, hex) * LEVEL_HEIGHT

export interface UnitFrame extends FigureFrame {
  hex: Hex | null
  /** 0..1 jump arc height fraction (jets on while > 0). */
  air: number
  /** Walk progress in hexes travelled (for leg swing and bob), 0 when standing. */
  stride: number
  walking: boolean
  prone: boolean
  /** True while a tween drives this unit. */
  tweening: boolean
}

/** Position the unit is drawn at. `now` = directorNow() (ms). */
export function unitFrame(state: GameState, u: UnitState, tween: UnitTween | undefined, now: number): UnitFrame {
  const H = HEIGHT_BY_CLASS[weightClassOf(u.tonnage)]
  const hex = u.pos
  if (tween) {
    const f = tween.durationMs > 0 ? Math.min(1, Math.max(0, (now - tween.startedAt) / tween.durationMs)) : 1
    const p = sampleTween(tween.kind, tween.keys, tween.kind === 'walk' || tween.kind === 'enter' ? f : ease(f))
    const y0 = hexTopY(state, p.from), y1 = hexTopY(state, p.to)
    let y = y0 + (y1 - y0) * p.f
    if (tween.kind === 'jump') {
      const first = tween.keys[0]!, last = tween.keys[tween.keys.length - 1]!
      const hexes = Math.max(1, query.distance(first.hex, last.hex))
      y += p.air * Math.min(2.0, 0.6 + 0.15 * hexes)
    }
    const segs = Math.max(1, tween.keys.length - 1)
    return {
      hex, x: p.x, z: p.z, y, facing: p.facing, twist: p.twist, H, air: p.air, stride: tween.kind === 'walk' ? f * segs : 0,
      walking: tween.kind === 'walk' && f < 1, prone: p.prone, tweening: true,
    }
  }
  if (!hex) return { hex: null, x: 0, z: 0, y: 0, facing: u.facing, twist: u.attacks.twist, H, air: 0, stride: 0, walking: false, prone: u.prone, tweening: false }
  const w = query.hexToWorld(state, hex)
  return { hex, x: w.x, z: w.z, y: hexTopY(state, hex), facing: u.facing, twist: u.attacks.twist, H, air: 0, stride: 0, walking: false, prone: u.prone, tweening: false }
}

/** Frame for a unit id on the given state (null when it has no board position). */
export function frameOf(state: GameState, id: UnitId, tween?: UnitTween, now = 0): UnitFrame | null {
  const u = state.units[id]
  return u ? unitFrame(state, u, tween, now) : null
}

/** Units drawn on the table: placed, and not gone from the field. Destroyed units stay as wrecks. */
export const isOnTable = (u: Pick<UnitState, 'pos' | 'status'>): boolean => !!u.pos && u.status !== 'offBoard' && u.status !== 'withdrawn' && u.status !== 'surrendered'

export const labelOf = (state: GameState, hex: Hex): string => hexToLabel(state.board, hex) ?? `${hex.q},${hex.r}`
