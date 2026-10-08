// Heat scale view model (50 §11). Thresholds and effect values come from the engine's heat scale; this file only groups them
// (a threshold = a level whose effects differ from the level below) and words them.
import type { HeatScaleRow } from '../../engine/index'
import { HEAT_EFFECT_LABELS } from '../contract'

export type HeatTone = 'grey' | 'amber' | 'orange' | 'red'
/** 0-4 grey, 5-9 amber, 10-19 orange, 20+ heat red (50 §11). Colour banding only. */
export function heatTone(level: number): HeatTone {
  return level >= 20 ? 'red' : level >= 10 ? 'orange' : level >= 5 ? 'amber' : 'grey'
}

export function effectChip(e: HeatScaleRow['effects'][number]): string {
  switch (e.code) {
    case 'mp': return HEAT_EFFECT_LABELS.mp(e.value)
    case 'toHit': return HEAT_EFFECT_LABELS.toHit(e.value)
    case 'shutdown': return HEAT_EFFECT_LABELS.shutdown(e.value)
    case 'autoShutdown': return HEAT_EFFECT_LABELS.autoShutdown()
    case 'ammo': return HEAT_EFFECT_LABELS.ammo(e.value)
    case 'lifeSupport': return HEAT_EFFECT_LABELS.lifeSupport()
  }
}

export interface ThresholdView {
  level: number
  chips: string[]
  /** This is the threshold in force at the current heat. */
  active: boolean
  /** This is the threshold in force at the projected end-of-turn heat (and differs from the current one). */
  projected: boolean
}

const keyOf = (r: HeatScaleRow): string => r.effects.map((e) => `${e.code}${e.value}`).join('|')

/** Levels at which the effect set changes, with the one in force now and at the projected level marked. */
export function buildThresholds(scale: readonly HeatScaleRow[], current: number, projected: number | null, lifeSupportDamaged = false): ThresholdView[] {
  const out: ThresholdView[] = []
  let prev = ''
  for (const row of scale) {
    // the life-support pilot hit only matters to a 'Mech whose life support is damaged (HEAT-025)
    const r = lifeSupportDamaged ? row : { ...row, effects: row.effects.filter((e) => e.code !== 'lifeSupport') }
    const k = keyOf(r)
    if (k !== prev && r.effects.length > 0) out.push({ level: r.level, chips: r.effects.map(effectChip), active: false, projected: false })
    prev = k
  }
  const inForce = (heat: number): number => { let at = -1; for (let i = 0; i < out.length; i++) if (out[i]!.level <= heat) at = i; return at }
  const a = inForce(current), p = projected === null ? -1 : inForce(projected)
  if (a >= 0) out[a]!.active = true
  if (p >= 0 && p !== a) out[p]!.projected = true
  return out
}

/** Hover lines for a heat-scale row: from this heat up, until the next row, these things happen. */
export function thresholdTip(t: ThresholdView, next: ThresholdView | undefined): { title: string; lines: string[] } {
  const span = next ? `heat ${t.level} to ${next.level - 1}` : `heat ${t.level} and above`
  return {
    title: `At ${span}`,
    lines: [...t.chips, t.active ? 'This is where this machine is now.' : t.projected ? 'This is where it would end the turn if you do this.' : 'Heat is checked at the end of every turn, after the heat sinks work.'],
  }
}

export interface HeatSegment { level: number; tone: HeatTone; filled: boolean; marker: 'current' | 'projected' | null }
export function buildSegments(maxLevel: number, current: number, projected: number | null): HeatSegment[] {
  const out: HeatSegment[] = []
  const cap = (n: number): number => Math.min(maxLevel, Math.max(0, n))
  for (let level = 1; level <= maxLevel; level++) {
    out.push({
      level, tone: heatTone(level), filled: level <= cap(current),
      marker: level === cap(current) ? 'current' : projected !== null && level === cap(projected) ? 'projected' : null,
    })
  }
  return out
}
