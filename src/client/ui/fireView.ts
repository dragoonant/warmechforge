// Ranged attack view model (50 §7, §8). Weapon rows, the live heat line and the self-explaining confirm sentence. Every number is
// from query.attackPreview / query.firePreview; the sentence lists the engine's modifiers in the engine's order.
import type { ArcsView, AttackPreview, FirePreview, FireShot, GameState, Loc, LosVerdict, PhysicalPreview, RejectionCode, SheetView, Twist, UnitId } from '../../engine/index'
import { distance as hexDistance } from '../../engine/hex'
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

export function damageText(p: AttackPreview, rapid = 1): string {
  if (rapid > 1 && p.cluster) return `${p.damage} per shot, about ${Math.round(p.cluster.expectedHits * 10) / 10} of ${p.cluster.rackSize} hit`
  return p.cluster ? `${p.damage} per missile (${p.cluster.rackSize}-rack)` : `${p.damage} dmg`
}

export function weaponLine(state: GameState | null, name: string, loc: Loc, rear: boolean, p: AttackPreview, oddsMode: Settings['odds'], rapid = 1): string {
  void state
  const where = `${loc}${rear ? ', rear' : ''}`
  // A weapon that cannot fire has no meaningful TN or odds (the engine reports TN 0): show what it is and how far, and let the
  // reason column say why.
  if (!p.legal) return `${name} (${where}) · ${p.distance} hex${p.distance === 1 ? '' : 'es'} · +${p.heat} heat`
  return `${name} (${where}) · ${p.distance} hex${p.distance === 1 ? '' : 'es'} ${RANGE_LABELS[p.band]} · ${oddsMode === 'tn' ? `TN ${p.tn}` : `TN ${p.tn} · ${formatOdds(p.pHit, p.tn)}`} · +${p.heat} heat · ${damageText(p, rapid)}`
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
  /** PPC mounts whose capacitor charges this turn: they do not fire (EQUIP-016). */
  charging?: readonly string[]
}

export function buildWeaponRows(a: RowArgs): WeaponRowView[] {
  const planBy = new Map(a.plan.map((p) => [p.mountId, p]))
  const baseBy = new Map(a.base.map((p) => [p.mountId, p]))
  return a.sheet.weapons.map((w): WeaponRowView => {
    const shot = a.shots.find((s) => s.mountId === w.mountId)
    const checked = !!shot
    const preview = (checked ? planBy.get(w.mountId) : undefined) ?? baseBy.get(w.mountId) ?? null
    const gone = w.destroyed
    const charging = !!a.charging?.includes(w.mountId)
    const legal = !gone && !charging && !!preview?.legal
    const disabledWhy = charging ? 'charging its capacitor' : gone ? 'destroyed' : !a.primaryId ? 'pick a target first' : !preview ? 'pick a target first' : preview.legal ? null : whyText(preview)
    return {
      mountId: w.mountId, name: w.name, location: w.location, rear: w.rear, checked, legal, disabledWhy,
      targetId: shot?.targetId ?? a.primaryId, preview,
      line: preview ? weaponLine(a.state, w.name, w.location, w.rear, preview, a.oddsMode, shot?.rapidShots ?? 1) : `${w.name} (${w.location}${w.rear ? ', rear' : ''}) · +${w.heat} heat`,
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
export function heatLine(fire: FirePreview, lifeSupportDamaged = false): HeatLine {
  return {
    parts: heatParts(fire.heat), text: heatTotalText(heatParts(fire.heat)), effects: heatEffectChips(fire.heat.effects, lifeSupportDamaged),
    risk: heatRisk(fire.heat.effects), warning: heatWarning(fire.heat.effects),
  }
}

export interface FireSentence { text: string; targets: UnitId[] }
/**
 * "Fire ER PPC at Rakshasa? Target 8 (Gunnery 4, medium range +2, you walked +1) = 72%. +15 heat → 9 after sinks."
 * Several weapons: "Fire 4 weapons at Solitaire? About 9.4 damage expected. You end at 14 heat: +2 to-hit, shutdown avoid 4+."
 * No shots: "Hold fire with Eris? No weapon heat; you end at 2 after sinks."
 */
export function fireSentence(state: GameState | null, unitId: UnitId, fire: FirePreview, names: (mountId: string) => string, oddsMode: Settings['odds'], lifeSupportDamaged = false): FireSentence {
  const who = unitName(state, unitId)
  const shown = fire.weapons.filter((w) => w.legal)
  const h = fire.heat
  const effects = heatEffectChips(h.effects, lifeSupportDamaged)
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

// ---------- torso twist outcomes ----------
export interface TwistOutcome {
  twist: Twist
  /** Enemies standing in one of the firing arcs this twist gives, with how many working weapons cover each (and, when probed, how many can really fire). */
  targets: { id: UnitId; name: string; weapons: number; legal?: number; blocker?: string }[]
  /** Legal shots (ranged) or legal punches (physical) summed over every target; undefined when no probe was given. */
  legal?: number
  /** "Rakshasa MDG-1A in arc (3 weapons)", or "no enemy in any arc". */
  text: string
}
/** Per-twist previews from the engine, so a twist note counts shots that can really fire, not only weapons that point at the enemy. */
export interface TwistProbe {
  shot(twist: Twist, mountId: string, targetId: UnitId): AttackPreview | null
  punch(twist: Twist, limb: 'LA' | 'RA', targetId: UnitId): PhysicalPreview | null
}
const ARC_KEYS = ['front', 'left', 'right', 'rear'] as const
const blockerWord = (p: { reason?: string; why?: string }): string => (
  p.reason === 'E_NO_LOS' ? 'no line of sight' : p.reason === 'E_OUT_OF_RANGE' ? 'out of range' : p.reason === 'E_OUT_OF_ARC' ? 'not in arc' : (p.why ?? 'no legal shot').replace(/.$/, ''))
/**
 * What each offered twist brings into arc, from the engine's arc query. With a `probe` (attackPreview / physicalPreview at that twist)
 * the note counts legal shots (pHit above zero) and names the blocker instead. `physical` limits it to adjacent enemies.
 */
export function twistOutcomes(state: GameState | null, unitId: UnitId, twists: readonly Twist[], arcsFor: (t: Twist) => ArcsView | null, sheet: SheetView | null, physical = false, probe?: TwistProbe): TwistOutcome[] {
  const me = state?.units[unitId]
  return twists.map((twist): TwistOutcome => {
    const arcs = arcsFor(twist)
    const targets: TwistOutcome['targets'] = []
    if (state && me && arcs) {
      for (const u of Object.values(state.units)) {
        if (u.owner === me.owner || u.status !== 'active' || !u.pos) continue
        const pos = u.pos
        if (physical && state.units[unitId]?.pos && hexDistance(state.units[unitId]!.pos!, pos) > 1) continue
        const arc = ARC_KEYS.find((k) => arcs[k].some((h) => h.q === pos.q && h.r === pos.r))
        if (!arc) continue
        const live = (sheet?.weapons ?? []).filter((w) => !w.destroyed && (arcs.mountArcs[w.mountId] ?? []).includes(arc))
        if (!(live.length > 0 || physical)) continue
        const t: TwistOutcome['targets'][number] = { id: u.id, name: u.name, weapons: live.length }
        if (probe) {
          if (physical) {
            const ps = (['LA', 'RA'] as const).map((l) => probe.punch(twist, l, u.id)).filter((x): x is PhysicalPreview => !!x)
            t.legal = ps.filter((x) => x.legal && x.pHit > 0).length
            if (!t.legal) t.blocker = ps.find((x) => !x.legal)?.why?.replace(/.$/, '') ?? 'no punch is possible'
          } else {
            const ps = live.map((w) => probe.shot(twist, w.mountId, u.id)).filter((x): x is AttackPreview => !!x)
            t.legal = ps.filter((x) => x.legal && x.pHit > 0).length
            if (!t.legal) t.blocker = ps.length ? blockerWord(ps.find((x) => !x.legal) ?? ps[0]!) : 'no legal shot'
          }
        }
        targets.push(t)
      }
    }
    const legal = probe ? targets.reduce((n, t) => n + (t.legal ?? 0), 0) : undefined
    const one = (t: TwistOutcome['targets'][number]): string => {
      if (!probe) return physical ? `${t.name} in front arc` : `${t.name} in arc (${t.weapons} weapon${t.weapons === 1 ? '' : 's'})`
      if (physical) return t.legal ? `${t.name}: ${t.legal === 2 ? 'both punches' : 'one punch'} possible` : `${t.name}: no punch (${t.blocker})`
      return t.legal ? `${t.name}: ${t.legal} of ${t.weapons} weapon${t.weapons === 1 ? '' : 's'} can fire` : `${t.name} in arc but no shot (${t.blocker})`
    }
    const text = targets.length === 0 ? 'no enemy in any arc' : targets.map(one).join(', ')
    return { twist, targets, text, ...(legal !== undefined ? { legal } : {}) }
  })
}
