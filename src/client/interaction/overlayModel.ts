// View models for the board overlays (50 sections 6 and 7). Pure functions: engine query results in, drawing instructions
// out. Colours and grouping only; every number (MP, reach, arcs, LOS verdict, odds) is the engine's.
import type { ArcsView, Facing, Hex, LosReason, LosVerdict, MoveMode, PsrReason, ReachEntry, UnitId } from '../../engine/index'
import { LOS_REASON_LABELS, PSR_REASON_LABELS, THEME_COLOURS } from './labels'

export const hexKey = (h: Hex): string => `${h.q},${h.r}`
export const sameHex = (a: Hex | null | undefined, b: Hex | null | undefined): boolean => !!a && !!b && a.q === b.q && a.r === b.r

// ---------- reach (move mode) ----------
export interface HexFillSpec { hex: Hex; colour: string; opacity: number; /** Draw an outline instead of a fill. */ outline?: boolean; kind: string }

/**
 * Reach highlights for a move mode (50 section 6.2). A hex is reachable when any facing is. Walk: walk-reachable green, run-only
 * hexes get an amber outline hint. Run: walk-reachable green, run-only amber fill. Jump: jump-reachable blue. Charge / DFA entries
 * are not fills (their target hex gets a red ring, see `attackTargets`).
 */
export function reachFillSpecs(entries: readonly ReachEntry[], mode: MoveMode): HexFillSpec[] {
  const walk = new Map<string, Hex>(), run = new Map<string, Hex>(), jump = new Map<string, Hex>()
  for (const e of entries) {
    if (e.physical) continue
    const k = hexKey(e.hex)
    if (e.mode === 'walk') walk.set(k, e.hex)
    else if (e.mode === 'run') run.set(k, e.hex)
    else if (e.mode === 'jump') jump.set(k, e.hex)
  }
  const out: HexFillSpec[] = []
  if (mode === 'jump') {
    for (const h of jump.values()) out.push({ hex: h, colour: THEME_COLOURS.reachJump, opacity: 0.35, kind: 'jump' })
    return out
  }
  if (mode === 'standStill') return out
  for (const [k, h] of walk) out.push({ hex: h, colour: THEME_COLOURS.reachWalk, opacity: 0.35, kind: 'walk' })
  for (const [k, h] of run) {
    if (walk.has(k)) continue
    if (mode === 'run') out.push({ hex: h, colour: THEME_COLOURS.reachRun, opacity: 0.35, kind: 'run' })
    else out.push({ hex: h, colour: THEME_COLOURS.reachRun, opacity: 0.9, outline: true, kind: 'run-hint' })
  }
  return out
}

/** Enemy units a charge (walk / run) or DFA (jump) entry of this mode aims at, with the hexes you would end in. */
export function attackTargets(entries: readonly ReachEntry[], mode: MoveMode): Map<UnitId, { kind: 'charge' | 'dfa'; fromHexes: Hex[] }> {
  const out = new Map<UnitId, { kind: 'charge' | 'dfa'; fromHexes: Hex[] }>()
  for (const e of entries) {
    if (!e.physical || e.mode !== mode) continue
    let t = out.get(e.physical.targetId)
    if (!t) { t = { kind: e.physical.kind, fromHexes: [] }; out.set(e.physical.targetId, t) }
    if (!t.fromHexes.some((h) => sameHex(h, e.hex))) t.fromHexes.push(e.hex)
  }
  return out
}

// ---------- path preview ----------
export interface PathStepView {
  hex: Hex
  /** MP spent up to and including this step (the engine's cumulative cost). */
  cumulative: number
  facing: Facing
  op: string
  backward: boolean
  turn: boolean
  /** Cost chips where a step costs more than the base: '+1 terrain', '+2 level'. */
  chips: string[]
  psr: { reason: PsrReason; label: string } | null
}
export interface PathView { steps: PathStepView[]; total: number; jump: boolean; hexes: Hex[] }

/** The engine's path for a reach entry as drawing steps (dot per hex step, tick per hexside turn, cost chips, PSR flags). */
export function pathView(entry: ReachEntry): PathView {
  let cum = 0
  const steps: PathStepView[] = []
  for (const s of entry.path) {
    cum += s.cost.total
    const turn = s.op === 'turnLeft' || s.op === 'turnRight'
    const chips: string[] = []
    if (s.cost.terrain > 0) chips.push(`+${s.cost.terrain} terrain`)
    if (s.cost.level > 0) chips.push(`+${s.cost.level} level`)
    steps.push({
      hex: s.hex, cumulative: cum, facing: s.facing, op: s.op, backward: s.op === 'backward', turn, chips,
      psr: s.psr ? { reason: s.psr, label: PSR_REASON_LABELS[s.psr] } : null,
    })
  }
  return { steps, total: entry.mpUsed, jump: entry.mode === 'jump', hexes: dedupeHexes(steps.filter((s) => !s.turn).map((s) => s.hex)) }
}
function dedupeHexes(hs: Hex[]): Hex[] {
  const out: Hex[] = []
  for (const h of hs) if (!out.length || !sameHex(out[out.length - 1], h)) out.push(h)
  return out
}

// ---------- facing picker ----------
export interface FacingChoice { facing: Facing; enabled: boolean; mp: number | null }
const ALL: readonly Facing[] = [0, 1, 2, 3, 4, 5]

/** Six facing arrows at a locked hex: enabled only where `(hex, facing, mode)` is in the reach set; each shows its MP total. */
export function facingChoices(entries: readonly ReachEntry[], hex: Hex, mode: MoveMode, attack: boolean): FacingChoice[] {
  return ALL.map((f) => {
    const e = entries.find((x) => x.mode === mode && x.facing === f && sameHex(x.hex, hex) && !!x.physical === attack)
    return { facing: f, enabled: !!e, mp: e ? e.mpUsed : null }
  })
}
/** Next / previous enabled facing from `from` (Q / E keys). */
export function stepFacing(choices: readonly FacingChoice[], from: Facing | null, dir: 1 | -1): Facing | null {
  const on = choices.filter((c) => c.enabled)
  if (!on.length) return null
  if (from === null) return (dir === 1 ? on[0]! : on[on.length - 1]!).facing
  for (let i = 1; i <= 6; i++) {
    const f = ((((from + dir * i) % 6) + 6) % 6) as Facing
    if (choices[f]!.enabled) return f
  }
  return from
}

// ---------- arcs ----------
export interface ArcFills { fills: HexFillSpec[]; frontOutline: Hex[] }
/** Arc tints (50 section 7.1): sides blue-grey 0.15, rear red 0.15, front outline only. */
export function arcFills(arcs: ArcsView | null): ArcFills {
  if (!arcs) return { fills: [], frontOutline: [] }
  const fills: HexFillSpec[] = []
  for (const h of arcs.left) fills.push({ hex: h, colour: THEME_COLOURS.arcSide, opacity: 0.3, kind: 'left' })
  for (const h of arcs.right) fills.push({ hex: h, colour: THEME_COLOURS.arcSide, opacity: 0.3, kind: 'right' })
  for (const h of arcs.rear) fills.push({ hex: h, colour: THEME_COLOURS.arcRear, opacity: 0.3, kind: 'rear' })
  for (const h of arcs.front) fills.push({ hex: h, colour: '#c9d6e6', opacity: 0.2, kind: 'frontFill' })
  return { fills, frontOutline: arcs.front }
}

// ---------- LOS ----------
export type LosColour = 'clear' | 'modified' | 'blocked'
export interface LosChip { hex: Hex | null; text: string }
export interface LosView { colour: LosColour; hexes: Hex[]; alt: Hex[] | null; chips: LosChip[]; blockers: Hex[] }

/** LOS line colour (green clear, amber clear with modifiers, red no attack) and reason chips (text from our label table). */
export function losView(v: LosVerdict | null): LosView | null {
  if (!v) return null
  const interesting = v.reasons.filter((r) => r.code !== 'clear' && r.code !== 'adjacent')
  const colour: LosColour = !v.visible || !v.attackAllowed ? 'blocked' : interesting.length || v.partialCover ? 'modified' : 'clear'
  const chips = (colour === 'clear' ? [] : v.reasons.filter((r) => r.code !== 'clear')).map((r) => ({ hex: r.hex ?? null, text: reasonText(r) }))
  return { colour, hexes: v.hexes, alt: v.alt, chips, blockers: v.blockers.map((b) => b.hex) }
}
/** Our words for one LOS reason, with the engine's value where it has one ('woods +1'). */
export function reasonText(r: LosReason): string {
  const base = LOS_REASON_LABELS[r.code]
  return r.value !== undefined && r.value !== 0 && (r.code === 'woods' || r.code === 'woodsBlock') ? `${base} (${r.value > 0 ? '+' : ''}${r.value})` : base
}
export const LOS_COLOUR_HEX: Record<LosColour, string> = { clear: THEME_COLOURS.reachWalk, modified: THEME_COLOURS.hazard, blocked: THEME_COLOURS.heat }

// ---------- range bands ----------
export interface RangesData { min?: number; short: number; medium: number; long: number }
export type RingBand = 'min' | 'short' | 'medium' | 'long'
/**
 * Classify a hex distance against a weapon's data ranges (hexes). Distance 0 is never a band. This only buckets a distance by
 * the data's range numbers for drawing rings and the ruler; to-hit numbers for a real target come from the engine's preview.
 */
export function bandOfDistance(r: RangesData, d: number): RingBand | null {
  if (d <= 0) return null
  if (r.min && d <= r.min) return 'min'
  if (d <= r.short) return 'short'
  if (d <= r.medium) return 'medium'
  if (d <= r.long) return 'long'
  return null
}
export const BAND_COLOURS: Record<RingBand, string> = { min: '#8a8d93', short: THEME_COLOURS.reachWalk, medium: THEME_COLOURS.reachRun, long: THEME_COLOURS.heat }
export const BAND_WORDS: Record<RingBand, string> = { min: 'inside minimum', short: 'short', medium: 'medium', long: 'long' }
