// Ranged attack view model (50 §7, §8). Weapon rows, the live heat line and the self-explaining confirm sentence. Every number is
// from query.attackPreview / query.firePreview; the sentence lists the engine's modifiers in the engine's order.
import type { AttackPreview, FirePreview, FireShot, GameState, Loc, LosVerdict, RejectionCode, SheetView, UnitId } from '../../engine/index'
import { LOS_REASON_LABELS, RANGE_LABELS, formatOdds, unitName } from '../contract'
import type { Settings } from '../contract'
import { heatEffectChips, heatParts, heatTotalText, heatWarning, modPhrases, oddsWord, targetHexes, type HeatParts, type HeatRisk, heatRisk } from './format'

/** Our words for the engine's refusal codes, used only when a preview carries no `why`. */
export const REJECTION_WORDS: Partial<Record<RejectionCode, string>> = {
  E_OUT_OF_ARC: 'out of arc', E_OUT_OF_RANGE: 'out of range', E_NO_LOS: 'no line of sight', E_WEAPON_DESTROYED: 'destroyed',
  E_WEAPON_USED: 'already used', E_NO_AMMO: 'no ammo', E_WATER_LINE: 'across the water line', E_TN_TOO_HIGH: 'target number too high',
  E_FRIENDLY_TARGET: 'friendly unit', E_UNKNOWN_WEAPON: 'unknown weapon', E_WRONG_AMMO: 'wrong ammunition', E_PRIMARY_TARGET: 'primary target rule',
  E_AIMED_SHOT: 'aimed shot not allowed', E_NO_RANGED: 'cannot fire', E_PROP_ARM: 'arm needed for propping', E_RAPID_MODE: 'mode not available',
  E_SHUTDOWN: 'shut down', E_UNCONSCIOUS: 'pilot unconscious', E_NOT_ADJACENT: 'not adjacent', E_LEVEL_DIFF: 'height difference', E_LIMB_UNAVAILABLE: 'limb unavailable',
  E_ATTACK_LIMIT: 'attack limit reached', E_NO_PHYSICAL: 'cannot attack', E_BAD_TARGET: 'not a valid target',
}
export const whyText = (p: { why?: string; reason?: RejectionCode } | null | undefined): string =>
  p?.why ?? (p?.reason ? REJECTION_WORDS[p.reason] : undefined) ?? 'not available'

export interface WeaponRowView {
  mountId: string
  name: string
  location: Loc
  rear: boolean
  checked: boolean
  legal: boolean
  /** Why it cannot be picked; null when it can. */
  disabledWhy: string | null
  targetId: UnitId | null
  preview: AttackPreview | null
  /** "ER PPC (RA) · 8 hexes medium · TN 9 · 28% · +15 heat · 10 dmg" */
  line: string
  /** TN and every modifier, in the engine's order, summing to the TN. */
  breakdown: string[]
  heat: number
}

export function damageText(p: AttackPreview): string {
  return p.cluster ? `${p.damage} per missile (${p.cluster.rackSize}-rack)` : `${p.damage} dmg`
}

export function weaponLine(state: GameState | null, name: string, loc: Loc, rear: boolean, p: AttackPreview, oddsMode: Settings['odds']): string {
  void state
  const where = `${loc}${rear ? ', rear' : ''}`
  // A weapon that cannot fire has no meaningful TN or odds (the engine reports TN 0): show what it is and how far, and let the
  // reason column say why.
  if (!p.legal) return `${name} (${where}) · ${p.distance} hex${p.distance === 1 ? '' : 'es'} · +${p.heat} heat · ${damageText(p)}`
  return `${name} (${where}) · ${p.distance} hex${p.distance === 1 ? '' : 'es'} ${RANGE_LABELS[p.band]} · ${oddsMode === 'tn' ? `TN ${p.tn}` : `TN ${p.tn} · ${formatOdds(p.pHit, p.tn)}`} · +${p.heat} heat · ${damageText(p)}`
}

export function breakdownOf(state: GameState | null, p: AttackPreview): string[] {
  const parts = modPhrases(p.mods, { band: p.band, targetHexes: targetHexes(state, p.targetId) })
  return [`TN ${p.tn} = ${parts.join(', ') || 'no modifiers'}`, ...(p.partialCover ? ['target has partial cover'] : []), `Hit odds ${formatOdds(p.pHit, p.tn)}`]
}

export interface RowArgs {
  state: GameState | null
  sheet: SheetView
  shots: readonly FireShot[]
  /** Every weapon previewed against the primary target (sheet order), for unchecked rows. */
  base: readonly AttackPreview[]
  /** Previews of the checked shots from the whole-plan query (they carry secondary-target mods). */
  plan: readonly AttackPreview[]
  oddsMode: Settings['odds']
  primaryId: UnitId | null
}

export function buildWeaponRows(a: RowArgs): WeaponRowView[] {
  const planBy = new Map(a.plan.map((p) => [p.mountId, p]))
  const baseBy = new Map(a.base.map((p) => [p.mountId, p]))
  return a.sheet.weapons.map((w): WeaponRowView => {
    const shot = a.shots.find((s) => s.mountId === w.mountId)
    const checked = !!shot
    const preview = (checked ? planBy.get(w.mountId) : undefined) ?? baseBy.get(w.mountId) ?? null
    const gone = w.destroyed
    const legal = !gone && !!preview?.legal
    const disabledWhy = gone ? 'destroyed' : !a.primaryId ? 'pick a target first' : !preview ? 'pick a target first' : preview.legal ? null : whyText(preview)
    return {
      mountId: w.mountId, name: w.name, location: w.location, rear: w.rear, checked, legal, disabledWhy,
      targetId: shot?.targetId ?? a.primaryId, preview,
      line: preview ? weaponLine(a.state, w.name, w.location, w.rear, preview, a.oddsMode) : `${w.name} (${w.location}${w.rear ? ', rear' : ''}) · +${w.heat} heat`,
      breakdown: preview && preview.legal ? breakdownOf(a.state, preview) : [],
      heat: preview?.heat ?? w.heat,
    }
  })
}

// ---------- shot list editing (pure) ----------
/** Shots at the primary target first (the first shot's target is primary), otherwise keep order. */
export function orderShots(shots: readonly FireShot[], primary: UnitId | null): FireShot[] {
  if (!primary) return [...shots]
  return [...shots.filter((s) => s.targetId === primary), ...shots.filter((s) => s.targetId !== primary)]
}
export function toggleShot(shots: readonly FireShot[], mountId: string, targetId: UnitId, primary: UnitId | null): FireShot[] {
  if (shots.some((s) => s.mountId === mountId)) return shots.filter((s) => s.mountId !== mountId)
  return orderShots([...shots, { mountId, targetId }], primary)
}
export function setShotTarget(shots: readonly FireShot[], mountId: string, targetId: UnitId, primary: UnitId | null): FireShot[] {
  return orderShots(shots.map((s) => (s.mountId === mountId ? { ...s, targetId } : s)), primary)
}
/** Check every legal weapon against the target. */
export function checkAllLegal(rows: readonly WeaponRowView[], targetId: UnitId): FireShot[] {
  return rows.filter((r) => r.legal).map((r) => ({ mountId: r.mountId, targetId }))
}

// ---------- heat line and prompt sentence ----------
export interface HeatLine { parts: HeatParts; text: string; effects: string[]; risk: HeatRisk; warning: string | null }
export function heatLine(fire: FirePreview): HeatLine {
  return {
    parts: heatParts(fire.heat), text: heatTotalText(heatParts(fire.heat)), effects: heatEffectChips(fire.heat.effects),
    risk: heatRisk(fire.heat.effects), warning: heatWarning(fire.heat.effects),
  }
}

export interface FireSentence { text: string; targets: UnitId[] }
/**
 * "Fire ER PPC at Rakshasa? Target 8 (Gunnery 4, medium range +2, you walked +1) = 72%. +15 heat → 9 after sinks."
 * Several weapons: "Fire 4 weapons at Solitaire? About 9.4 damage expected. You end at 14 heat: +2 to-hit, shutdown avoid 4+."
 * No shots: "Hold fire with Eris? No weapon heat; you end at 2 after sinks."
 */
export function fireSentence(state: GameState | null, unitId: UnitId, fire: FirePreview, names: (mountId: string) => string, oddsMode: Settings['odds']): FireSentence {
  const who = unitName(state, unitId)
  const shown = fire.weapons.filter((w) => w.legal)
  const h = fire.heat
  const effects = heatEffectChips(h.effects)
  const targets = [...new Set(fire.weapons.map((w) => w.targetId))]
  if (shown.length === 0) return { text: `Hold fire with ${who}? No weapon heat; you end at ${h.end} after sinks${effects.length ? ` (${effects.join(', ')})` : ''}.`, targets: [] }
  const at = targets.map((t) => unitName(state, t)).join(' and ')
  if (shown.length === 1) {
    const p = shown[0]!
    const mods = modPhrases(p.mods, { band: p.band, targetHexes: targetHexes(state, p.targetId) })
    const odds = oddsMode === 'tn' ? '' : ` = ${formatOdds(p.pHit, p.tn)}`
    return { text: `Fire ${names(p.mountId)} at ${at}? Target ${p.tn}${mods.length ? ` (${mods.join(', ')})` : ''}${odds}. +${h.weapons} heat → ${h.end} after sinks${effects.length ? `: ${effects.join(', ')}` : ''}.`, targets }
  }
  const expected = Math.round(shown.reduce((n, p) => n + p.expectedDamage, 0) * 10) / 10
  return { text: `Fire ${shown.length} weapons at ${at}? About ${expected} damage expected. You end at ${h.end} heat${effects.length ? `: ${effects.join(', ')}` : ''}.`, targets }
}

/** Line-of-sight reasons as chips (labels by code; a value is appended where the engine gives one). */
export function losChips(los: LosVerdict | null): string[] {
  if (!los) return []
  return los.reasons.filter((r) => r.code !== 'clear' && r.code !== 'adjacent').map((r) => `${LOS_REASON_LABELS[r.code]}${r.value !== undefined && (r.code === 'woods') ? ` +${r.value}` : ''}`)
}

export const oddsOf = oddsWord
