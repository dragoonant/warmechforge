// Small pure formatters shared by the HUD. Numbers always come from the engine (mods, TN, odds, heat parts); this file only
// words them, in the engine's order, so the printed parts always add up to the engine's total.
import type { HeatEffects, HeatProjection, Mod, MoveMode, RangeBand, GameState, UnitId, UnitState } from '../../engine/index'
import { HEAT_EFFECT_LABELS, MOD_LABELS, RANGE_LABELS, formatMod, formatOdds, unitName, type Settings } from '../contract'

export interface ModCtx {
  /** Range band of the attack (the range mod's detail wins when it is one). */
  band?: RangeBand
  /** Hexes the target moved this turn (from its move record), for "target moved 5 hexes". */
  targetHexes?: number | null
}

const MOVE_WORDS: Record<MoveMode, string> = { standStill: 'you stood still', walk: 'you walked', run: 'you ran', jump: 'you jumped' }
const SKILL_MODS = new Set(['gunnery', 'piloting'])
const LOC_DETAIL = new Set(['upperLeg', 'lowerLeg', 'foot', 'shoulder', 'upperArm', 'lowerArm', 'hand', 'legDestroyed'])
const BANDS =new Set(['short', 'medium', 'long', 'out'])

/** One modifier in our words: "Gunnery 4", "medium range +2", "you walked +1". Zero-valued non-skill mods return null. */
export function modPhrase(m: Mod, ctx: ModCtx = {}): string | null {
  if (SKILL_MODS.has(m.code)) return `${MOD_LABELS[m.code]} ${m.value}`
  if (m.value === 0) return null
  const v = formatMod(m.value)
  switch (m.code) {
    case 'range': {
      const band = (m.detail && BANDS.has(m.detail) ? m.detail : ctx.band) as RangeBand | undefined
      return `${band ? RANGE_LABELS[band] : 'range'} range ${v}`
    }
    case 'physicalBase': return `${m.detail ?? 'base'} ${v}`
    case 'attackerMove': return `${MOVE_WORDS[(m.detail as MoveMode) ?? 'walk'] ?? MOD_LABELS.attackerMove} ${v}`
    case 'tmm': return `${ctx.targetHexes ? `target moved ${ctx.targetHexes} hex${ctx.targetHexes === 1 ? '' : 'es'}` : MOD_LABELS.tmm} ${v}`
    default: return `${MOD_LABELS[m.code] ?? m.code}${m.detail && LOC_DETAIL.has(m.code) ? ` (${m.detail})` : ''} ${v}`
  }
}

/** All mods as phrases, engine order, zeros left out. */
export function modPhrases(mods: readonly Mod[], ctx: ModCtx = {}): string[] {
  const out: string[] = []
  for (const m of mods) { const p = modPhrase(m, ctx); if (p) out.push(p) }
  return out
}

/** "TN 8 (Gunnery 4, medium range +2, you walked +1)". */
export function tnClause(tn: number, mods: readonly Mod[], ctx: ModCtx = {}): string {
  const parts = modPhrases(mods, ctx)
  return parts.length ? `TN ${tn} (${parts.join(', ')})` : `TN ${tn}`
}

/** Odds per the player's setting: "72%" or "TN 8". */
export function oddsWord(p: number, tn: number, mode: Settings['odds'] = 'percent'): string {
  return mode === 'tn' ? `TN ${tn}` : formatOdds(p, tn)
}

/** Hexes the target moved, for the "target moved N hexes" phrase. */
export function targetHexes(state: GameState | null, targetId: UnitId | null | undefined): number | null {
  const u = targetId ? state?.units[targetId] : undefined
  return u && u.move.mode !== null ? u.move.hexesMoved : null
}

// ---------- heat ----------
/** Effect chips for a heat level from the engine's HeatEffects (our words). */
export function heatEffectChips(e: HeatEffects): string[] {
  const out: string[] = []
  if (e.mpLoss) out.push(HEAT_EFFECT_LABELS.mp(e.mpLoss))
  if (e.toHitMod) out.push(HEAT_EFFECT_LABELS.toHit(e.toHitMod))
  if (e.autoShutdown) out.push(HEAT_EFFECT_LABELS.autoShutdown())
  else if (e.shutdownTn !== null) out.push(`shutdown avoid ${e.shutdownTn}+`)
  if (e.ammoTn !== null) out.push(`ammo avoid ${e.ammoTn}+`)
  if (e.lifeSupportPilotHits) out.push('pilot takes 1 hit if life support is damaged')
  return out
}

export type HeatRisk = 'none' | 'warn' | 'danger'
/** danger = shutdown or an ammo explosion can happen; warn = only penalties. */
export function heatRisk(e: HeatEffects): HeatRisk {
  if (e.autoShutdown || e.shutdownTn !== null || e.ammoTn !== null) return 'danger'
  if (e.mpLoss || e.toHitMod) return 'warn'
  return 'none'
}
/** Plain warning text for the confirm area, or null. */
export function heatWarning(e: HeatEffects, who = 'You'): string | null {
  if (e.autoShutdown) return `${who} would shut down automatically at ${e.heat} heat.`
  const bits: string[] = []
  if (e.shutdownTn !== null) bits.push(`a shutdown roll (avoid on ${e.shutdownTn}+)`)
  if (e.ammoTn !== null) bits.push(`an ammunition explosion check (avoid on ${e.ammoTn}+)`)
  return bits.length ? `${who} would risk ${bits.join(' and ')} at ${e.heat} heat.` : null
}

export interface HeatParts { now: number; moved: number; weapons: number; other: number; sinks: number; end: number; /** What the other heat is, in our words (engine hits, equipment...). */ otherLabel?: string }
const HEAT_SOURCE_WORDS: Record<string, string> = { engine: 'engine damage', equipment: 'equipment', environment: 'terrain', other: 'other' }
/** The engine's projection split into the printed parts: now + moved + weapons (+ other) - sinks = end. */
export function heatParts(h: HeatProjection & { move?: number; weapons?: number }): HeatParts {
  // A fire preview names its move and weapon parts; a move projection only carries the ledger entries, summed here by source.
  const bySource = (src: string): number => (h.entries ?? []).filter((e) => e.source === src).reduce((n, e) => n + e.amount, 0)
  const moved = h.move ?? bySource('movement')
  const weapons = h.weapons ?? bySource('weapon')
  const otherSources = [...new Set((h.entries ?? []).filter((e) => e.source !== 'movement' && e.source !== 'weapon' && e.amount !== 0).map((e) => HEAT_SOURCE_WORDS[e.source] ?? 'other'))]
  return { now: h.now, moved, weapons, other: Math.max(0, h.generated - moved - weapons), sinks: h.dissipation, end: h.end, otherLabel: otherSources.join(' and ') || 'other' }
}
/** "Heat now 4 + moved 1 + weapons 23 - sinks 10 = 18". */
export function heatTotalText(p: HeatParts): string {
  const raw = p.now + p.moved + p.weapons + p.other - p.sinks
  return `Heat now ${p.now} + moved ${p.moved} + weapons ${p.weapons}${p.other ? ` + ${p.otherLabel ?? 'other'} ${p.other}` : ''} − sinks ${p.sinks} = ${p.end}${raw < 0 && p.end === 0 ? ' (heat never goes below 0)' : ''}`
}

/** "Name (2 of 3)" style helper for lists. */
export const nameOf = (state: GameState | null, id: UnitId | null | undefined): string => unitName(state, id)

export const signed = formatMod

/** Why a 'Mech counts as crippled (11 §2.2): the first condition that holds, in our words. */
export function crippledReason(u: UnitState): string {
  const hits = (token: string): number => Object.values(u.slots).reduce((n, l) => n + l.filter((s) => s.hit && s.token === token).length, 0)
  const legs = (['LL', 'RL'] as const).filter((l) => u.locs[l].destroyed).length
  if (legs > 0) return legs === 2 ? 'both legs destroyed' : 'a leg destroyed'
  if (u.locs.CT.destroyed) return 'centre torso destroyed'
  const gyro = hits('gyro')
  if (gyro >= 2) return 'gyro destroyed'
  const engine = hits('engine')
  if (engine >= 2) return `${engine} engine hits`
  return 'no weapon can fire'
}
