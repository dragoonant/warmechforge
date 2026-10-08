// FROZEN client contract (M3). Board, HUD, figures and start-screen code import ONLY from here (plus engine TYPES).
// Additive changes only; log them at the bottom of this file.
//
// Rules for callers:
//  - Render from the PRESENTED state (usePresented*, use* query hooks): it trails the animations, so a panel never shows
//    a number before its beat plays. Prompts open only when the presentation is idle (then presented == true state).
//  - Never compute a rules number. TN, odds, mods, MP, reach, arcs, LOS, heat, PSR targets and damage come from the
//    engine via the hooks/query helpers below, pending.context / pending.options, or event payloads.
//  - Answer decisions only through `game.*` (built from engine-provided entries, options and ids).
//  - Hooks return stable references (memoised per presented state object), so they are safe as React selectors.
//  - UI copy is ours; the fan notice is FAN_NOTICE; never the BattleTech logo.
import { useShallow } from 'zustand/react/shallow'
import {
  describe as engineDescribe, query,
  type Action, type ArcsView, type AttackPreview, type AttackPreviewRequest, type ArmLoc, type DeclareFireAction, type Facing,
  type FireShot, type FirePlan, type FirePreview, type GameState, type HeatPlan, type HeatProjection, type HeatScaleRow, type Hex,
  type HexLabel, type LosOptions, type LosVerdict, type MoveMode, type PendingDecision, type PhaseId, type PhysicalChoice,
  type PhysicalPreview, type PhysicalPreviewRequest, type PlayerId, type PsrReason, type ReachEntry, type SheetView,
  type TerrainInfo, type ThreatView, type Twist, type UnitId, type UnitState, type WorldXZ,
} from '../engine/index'
import { hexToLabel, labelToHex } from '../engine/hex'
import { useAnnounceStore, type Banner, type NarrationLine } from './presentation/announceStore'
import { ease, sampleTween, type BeatFx, type BeatKind, type TweenPose } from './presentation/beats'
import { directorNow, setPaused, skipAll, skipBeat } from './presentation/director'
import {
  usePresentedStore,
  type ActiveBeat, type DamagePop, type FeedEntry, type ShownRoll, type UnitTween,
} from './presentation/presentedStore'
import {
  CRIT_EFFECT_LABELS, DECISION_LABELS, DEFAULT_FORCE_COLOURS, DESTROY_CAUSE_LABELS, DIRECTION_LABELS, FACING_LABELS, FACING_WORDS,
  HEAT_EFFECT_LABELS, LOC_LABELS, LOC_SHORT, LOS_REASON_LABELS, MOD_LABELS, MOVE_MODE_LABELS, PHASE_LABELS, PSR_REASON_LABELS,
  RANGE_LABELS, ROLL_PURPOSE_LABELS, STATUS_LABELS, TERRAIN_LABELS,
  endCause, forceColour, formatMod, formatOdds, hexName, narrate, rollLabel, rollVerdict, sideName, unitName,
} from './presentation/labels'
import { startBotDriver } from './bot/botDriver'
import {
  actionFor, clearAutosave, clearRejection, continueGame, dispatch, exportSave, hasAutosave, importSave, installAutosave,
  isHumanDecision, legalFor, loadGame, newGame, playAgain, readAutosave, saveGame, setController, useGameStore,
  type ActionPayload, type AutosaveSlot, type ClientRejection, type GameStoreState, type SideStats,
} from './store/gameStore'
import { panelActions, useRailCollapsed, type Rail } from './store/panelStore'
import { SPEED_PRESETS, useSettingsStore, type Settings } from './store/settingsStore'
import { defaultControllers, listForces, listMaps, listMissions, type Controller } from './store/setup'
import { installTestHooks, registerHexToScreen, setupFromUrl, speedFromUrl } from './store/testHooks'
import { ui, useUiStore, type FireDraft, type MoveDraft, type PhysicalDraft, type UiMode } from './store/uiStore'

// ---------- types callers need ----------
export type {
  ActiveBeat, ActionPayload, AutosaveSlot, Banner, BeatFx, BeatKind, ClientRejection, Controller, DamagePop, FeedEntry, FireDraft,
  MoveDraft, NarrationLine, PhysicalDraft, Rail, Settings, ShownRoll, SideStats, TweenPose, UiMode, UnitTween,
}
export type { BotTier, ForceInfo, MapInfo, MissionInfo, NewGameOptions } from './store/setup'
export type { ClientSave, SaveSummary } from './store/gameStore'
export type { GameTestApi, HexToScreen } from './store/testHooks'
export type { GraphicsTier, HexLabelMode, OddsFormat } from './store/settingsStore'
export { SPEED_PRESETS }

/** Shown on the start screen footer and in Settings (IP rule). */
export const FAN_NOTICE = 'Unofficial fan project, not affiliated with or endorsed by Catalyst Game Labs, Topps or Microsoft.'
/** Theme tokens (50 §12): dark charcoal and gold. */
export const THEME = {
  bg: '#14161a', fg: '#e8e6e1', card: '#1e2127', accent: '#c9a227', heat: '#d0402b', hazard: '#e08a1e',
  reachWalk: '#3fae5a', reachRun: '#d99a1e', reachJump: '#3d7fd9',
} as const

const EMPTY_ARR: never[] = []

// =====================================================================================================
// Presented state (render from these)
// =====================================================================================================
/** Engine state as of the animation cursor; null before a game. */
export const usePresentedState = (): GameState | null => usePresentedStore((s) => s.state)
/** One unit as presented (its pos is the END of a playing tween: use useUnitTween + tweenPose while one plays). */
export const usePresentedUnit = (id: UnitId | null | undefined): UnitState | undefined => usePresentedStore((s) => (id ? s.state?.units[id] : undefined))
/** All units as presented (stable object until something changes). */
export const usePresentedUnits = (): Record<UnitId, UnitState> | null => usePresentedStore((s) => s.state?.units ?? null)
/** Unit ids in force order (A then B), shallow-stable. */
export const useUnitIds = (): UnitId[] => usePresentedStore(useShallow((s) => s.state?.unitOrder ?? EMPTY_ARR))
/** Presented turn number (0 before the first Initiative Phase). */
export const usePresentedTurn = (): number => usePresentedStore((s) => s.state?.turn ?? 0)
/** Presented phase. */
export const usePresentedPhase = (): PhaseId | null => usePresentedStore((s) => s.state?.phase ?? null)
/** Initiative result as presented (winner acts last), or null. */
export const useInitiative = (): GameState['initiative'] => usePresentedStore((s) => s.state?.initiative ?? null)
/** The unit whose move / declaration is open (presented), or null. */
export const useActiveUnitId = (): UnitId | null => usePresentedStore((s) => s.state?.selection?.activeUnit ?? null)
/** Side label ('Eris Lance') from the presented state. */
export const useSideName = (p: PlayerId): string => usePresentedStore((s) => sideName(s.state, p))
/** Side colour from its force data (colours follow the force). */
export const useForceColour = (p: PlayerId): string => usePresentedStore((s) => forceColour(s.state, p))

/** Active tween for a unit, if any. */
export const useUnitTween = (id: UnitId): UnitTween | undefined => usePresentedStore((s) => s.tweens[id])
/** All active tweens. */
export const useTweens = (): Record<UnitId, UnitTween> => usePresentedStore((s) => s.tweens)
/** Pose of a tweening unit at time `now` (directorNow()), eased. Display interpolation only. */
export function tweenPose(t: UnitTween, now = directorNow()): TweenPose {
  const f = t.durationMs > 0 ? Math.min(1, Math.max(0, (now - t.startedAt) / t.durationMs)) : 1
  return sampleTween(t.kind, t.keys, t.kind === 'walk' || t.kind === 'enter' ? f : ease(f))
}
/** Clock the director times beats against (tweens, pops, banner fades). */
export { directorNow }
/** True while any beat plays (canvas keeps invalidating). */
export const useAnimating = (): boolean => usePresentedStore((s) => s.beat !== null || Object.keys(s.tweens).length > 0)
/** True when nothing is queued or playing. */
export const usePresentationIdle = (): boolean => usePresentedStore((s) => s.idle)
/** Presentation paused (menu open). */
export const usePresentationPaused = (): boolean => usePresentedStore((s) => s.paused)
/** The beat playing now (kind, timing, units, fx for VFX), or null. */
export const useCurrentBeat = (): ActiveBeat | null => usePresentedStore((s) => s.beat)
/** Last roll shown in the tray (still rolling while useCurrentBeat() covers its seq). */
export const useShownRoll = (): ShownRoll | null => usePresentedStore((s) => s.roll)
/** Every roll of the last rolling beat (initiative shows both sides' dice). */
export const useShownRolls = (): ShownRoll[] => usePresentedStore((s) => s.rolls)
/** Every roll shown this game, oldest first. */
export const useDiceLog = (): ShownRoll[] => usePresentedStore((s) => s.diceLog)
/** Floating damage / miss / heat pops; drop each after startedAt + durationMs. */
export const useDamagePops = (): DamagePop[] => usePresentedStore((s) => s.pops)
/** Every event shown so far (ring of 2000), oldest first, with the engine's sentence. */
export const useEventFeed = (): FeedEntry[] => usePresentedStore((s) => s.feed)
/** Seq of the last event shown. */
export const usePresentedCursor = (): number => usePresentedStore((s) => s.cursor)
/** Bumps on every presented change: frameloop="demand" canvases invalidate on it. */
export const usePresentedRev = (): number => usePresentedStore((s) => s.rev)
/** Big centred banner (turn, phase, crit, explosion, destroyed, game over), or null. */
export const useBanner = (): Banner | null => useAnnounceStore((s) => s.banner)
/** Narration log, one line per notable event (ring of 300). Show it only when settings.narration is on. */
export const useNarration = (): NarrationLine[] => useAnnounceStore((s) => s.lines)
/** Game result once the presented state reaches the end, else null. */
export const useGameResult = (): GameState['result'] => usePresentedStore((s) => (s.state?.phase === 'ended' ? s.state.result : null))
/** Per-side tallies for the end screen (damage dealt/taken = armor + internal removed, heat peak). */
export const useGameStats = (): Record<PlayerId, SideStats> => useGameStore((g) => g.stats)

// =====================================================================================================
// Decisions (gated on presentation idle: a prompt never refers to an un-shown event)
// =====================================================================================================
const promptOf = (g: GameStoreState, idle: boolean): PendingDecision | null => (idle && !g.fatal && isHumanDecision(g) ? g.pending : null)
/** The open decision when it is a human's to answer AND the presentation is idle; else null. */
export function usePrompt(): PendingDecision | null {
  const idle = usePresentedStore((s) => s.idle)
  return useGameStore((g) => promptOf(g, idle))
}
/** Legal answers for the prompt (engine-validated; empty when there is no prompt). */
export function usePromptLegal(): Action[] {
  const p = usePrompt()
  const state = useGameStore((g) => g.state)
  return p && state ? legalFor(state) : EMPTY_ARR
}
/** Engine words for the prompt: title, prompt line, detail lines (numbers from the engine). Null with no prompt. */
export function usePromptText(): { title: string; prompt: string; lines: string[] } | null {
  const p = usePrompt()
  const s = useGameStore((g) => g.state)
  return p && s ? memo(s, `describe|${p.id}`, () => engineDescribe.decision(s, p)) : null
}
/** Whose decision is open and who controls that side ("the bot is thinking"); null with no game / game over. */
export function useWaitingFor(): { player: PlayerId; controller: Controller } | null {
  return useGameStore(useShallow((g) => (g.pending && g.pending.kind !== 'gameOver' ? { player: g.pending.player, controller: g.controllers[g.pending.player] } : null)))
}
/** Last rejection (our words in .text, the engine's in .detail); cleared by the next accepted step. */
export const useRejection = (): ClientRejection | null => useGameStore((g) => g.lastRejection)
/** Engine crashed (bug): show a recovery screen. */
export const useFatal = (): string | null => useGameStore((g) => g.fatal)
/** Who controls each side. */
export const useControllers = (): Record<PlayerId, Controller> => useGameStore((g) => g.controllers)
/** True once a game exists. */
export const useHasGame = (): boolean => useGameStore((g) => g.state !== null)
/** True when side `p` is human-controlled (own units: Tab cycles them, rings, etc.). */
export const useIsHuman = (p: PlayerId): boolean => useGameStore((g) => g.controllers[p] === 'human')

// =====================================================================================================
// UI state
// =====================================================================================================
/** Selected unit id. */
export const useSelectedId = (): UnitId | null => useUiStore((s) => s.selectedId)
/** Selected unit as presented. */
export function useSelectedUnit(): UnitState | undefined {
  const id = useUiStore((s) => s.selectedId)
  return usePresentedStore((s) => (id ? s.state?.units[id] : undefined))
}
/** Hovered unit id. */
export const useHoverUnitId = (): UnitId | null => useUiStore((s) => s.hoverUnitId)
/** Hovered hex. */
export const useHoverHex = (): Hex | null => useUiStore((s) => s.hoverHex)
/** Current board mode (select / move / fire / physical / measure / los). */
export const useUiMode = (): UiMode => useUiStore((s) => s.mode)
/** Ruler / LOS endpoints. */
export const useMeasure = (): { from: Hex | null; to: Hex | null } => useUiStore(useShallow((s) => ({ from: s.measureFrom, to: s.measureTo })))
/** Threat overlay toggle (T) [M4+]. */
export const useShowThreat = (): boolean => useUiStore((s) => s.showThreat)
/** Range rings for all checked weapons (R). */
export const useShowRanges = (): boolean => useUiStore((s) => s.showRanges)
/** Movement plan draft. */
export const useMoveDraft = (): MoveDraft => useUiStore((s) => s.move)
/** Ranged plan draft (twist preview + shots). */
export const useFireDraft = (): FireDraft => useUiStore((s) => s.fire)
/** Physical plan draft (target). */
export const usePhysicalDraft = (): PhysicalDraft => useUiStore((s) => s.physical)
/** Open popover id. */
export const usePanel = (): string | null => useUiStore((s) => s.panel)
/** Player settings. */
export const useSettings = (): Settings => useSettingsStore(useShallow((s) => ({ speed: s.speed, graphics: s.graphics, narration: s.narration, tips: s.tips, hexLabels: s.hexLabels, grid: s.grid, odds: s.odds })))
/** Rail collapsed ([ and ]). */
export { useRailCollapsed }

// =====================================================================================================
// Engine queries. Hooks read the PRESENTED state and memoise per state object; query* helpers read the TRUE state
// (for controllers about to dispatch). Both equal each other whenever a prompt is open.
// =====================================================================================================
const memoCache = new WeakMap<GameState, Map<string, unknown>>()
function memo<T>(state: GameState, key: string, f: () => T): T {
  let m = memoCache.get(state)
  if (!m) { m = new Map(); memoCache.set(state, m) }
  if (m.has(key)) return m.get(key) as T
  if (m.size > 600) m.clear()
  let v: T
  try { v = f() } catch { v = null as T }
  m.set(key, v)
  return v
}
const truth = (): GameState | null => useGameStore.getState().state
const shown = (s: { state: GameState | null }): GameState | null => s.state
const k = (v: unknown): string => JSON.stringify(v ?? null)

/** A hex the reach set touches, grouped from engine entries (no rules: grouping and the cheapest by the engine's mpUsed). */
export interface ReachHex { hex: Hex; label: HexLabel | null; entries: ReachEntry[]; cheapest: ReachEntry; facings: Facing[]; attacks: ReachEntry[] }
export type ReachMap = Map<string, ReachHex> // key: `${q},${r}`
export const hexKey = (h: Hex): string => `${h.q},${h.r}`
export function groupReach(entries: readonly ReachEntry[]): ReachMap {
  const out: ReachMap = new Map()
  for (const e of entries) {
    const key = hexKey(e.hex)
    let g = out.get(key)
    if (!g) { g = { hex: e.hex, label: e.label, entries: [], cheapest: e, facings: [], attacks: [] }; out.set(key, g) }
    g.entries.push(e)
    if (e.physical) g.attacks.push(e)
    else {
      if (!g.facings.includes(e.facing)) g.facings.push(e.facing)
      if (g.cheapest.physical || e.mpUsed < g.cheapest.mpUsed) g.cheapest = e
    }
  }
  return out
}

/** Every reach entry of a unit (query.reachable), [] when it cannot move. */
export function useReach(unitId: UnitId | null | undefined): ReachEntry[] {
  return usePresentedStore((s) => { const st = shown(s); return st && unitId ? memo(st, `reach|${unitId}`, () => query.reachable(st, unitId)) ?? EMPTY_ARR : EMPTY_ARR })
}
/** Reach entries for one movement mode. */
export function useReachForMode(unitId: UnitId | null | undefined, mode: MoveMode): ReachEntry[] {
  return usePresentedStore((s) => {
    const st = shown(s)
    if (!st || !unitId) return EMPTY_ARR
    return memo(st, `reachMode|${unitId}|${mode}`, () => (memo(st, `reach|${unitId}`, () => query.reachable(st, unitId)) ?? []).filter((e) => e.mode === mode)) ?? EMPTY_ARR
  })
}
/** Reach entries grouped per hex for one mode (overlay colours, facing picker, charge/DFA chips). */
export function useReachHexes(unitId: UnitId | null | undefined, mode: MoveMode): ReachMap {
  return usePresentedStore((s) => {
    const st = shown(s)
    if (!st || !unitId) return EMPTY_MAP
    return memo(st, `reachHex|${unitId}|${mode}`, () => groupReach((memo(st, `reach|${unitId}`, () => query.reachable(st, unitId)) ?? []).filter((e) => e.mode === mode))) ?? EMPTY_MAP
  })
}
const EMPTY_MAP: ReachMap = new Map()
/** Movement modes present in a unit's reach set, in walk/run/jump/standStill order. */
export function useMoveModes(unitId: UnitId | null | undefined): MoveMode[] {
  return usePresentedStore((s) => {
    const st = shown(s)
    if (!st || !unitId) return EMPTY_ARR
    return memo(st, `modes|${unitId}`, () => {
      const set = new Set((memo(st, `reach|${unitId}`, () => query.reachable(st, unitId)) ?? []).map((e) => e.mode))
      return (['standStill', 'walk', 'run', 'jump'] as MoveMode[]).filter((m) => set.has(m))
    }) ?? EMPTY_ARR
  })
}
/** The reach entry the move draft points at (mode + hex + facing + charge/DFA chip), or null. */
export function useMoveDraftEntry(unitId: UnitId | null | undefined): ReachEntry | null {
  const d = useUiStore((s) => s.move)
  return usePresentedStore((s) => {
    const st = shown(s)
    if (!st || !unitId || !d.hex) return null
    return memo(st, `draft|${unitId}|${k(d)}`, () => findReachEntry(memo(st, `reach|${unitId}`, () => query.reachable(st, unitId)) ?? [], d))
  })
}
/** Pick the entry for a draft from a reach list (exact mode, hex, facing; attack chip picks the physical entry). */
export function findReachEntry(entries: readonly ReachEntry[], d: MoveDraft): ReachEntry | null {
  if (!d.hex) return null
  const at = entries.filter((e) => e.mode === d.mode && e.hex.q === d.hex!.q && e.hex.r === d.hex!.r && !!e.physical === d.attack)
  if (!at.length) return null
  return (d.facing !== null ? at.find((e) => e.facing === d.facing) : at.reduce((a, b) => (b.mpUsed < a.mpUsed ? b : a))) ?? null
}

/** Firing arcs for a unit at a (preview) twist. */
export function useArcs(unitId: UnitId | null | undefined, twist?: Twist): ArcsView | null {
  return usePresentedStore((s) => { const st = shown(s); return st && unitId ? memo(st, `arcs|${unitId}|${twist ?? 'cur'}`, () => query.arcs(st, unitId, twist)) : null })
}
/** LOS verdict (visible, attackAllowed, hexes, reasons with codes for LOS_REASON_LABELS). */
export function useLos(from: UnitId | Hex | null | undefined, to: UnitId | Hex | null | undefined, opts?: LosOptions): LosVerdict | null {
  return usePresentedStore((s) => { const st = shown(s); return st && from && to ? memo(st, `los|${k(from)}|${k(to)}|${k(opts)}`, () => query.los(st, from, to, opts)) : null })
}
/** One weapon vs one target: legal/why, TN, mods, pHit, band, heat, damage. */
export function useAttackPreview(req: AttackPreviewRequest | null): AttackPreview | null {
  return usePresentedStore((s) => { const st = shown(s); return st && req ? memo(st, `atk|${k(req)}`, () => query.attackPreview(st, req)) : null })
}
/** Every weapon of a unit (sheet order) previewed against one target (rows of the FirePanel, illegal ones with why). */
export function useWeaponPreviews(unitId: UnitId | null | undefined, targetId: UnitId | null | undefined, extra?: Partial<AttackPreviewRequest>): AttackPreview[] {
  return usePresentedStore((s) => {
    const st = shown(s)
    if (!st || !unitId || !targetId) return EMPTY_ARR
    return memo(st, `wpns|${unitId}|${targetId}|${k(extra)}`, () => {
      const sheet = memo(st, `sheet|${unitId}`, () => query.sheet(st, unitId))
      return (sheet?.weapons ?? []).map((w) => query.attackPreview(st, { ...extra, attackerId: unitId, mountId: w.mountId, targetId }))
    }) ?? EMPTY_ARR
  })
}
/** Whole ranged plan: per-shot previews, primary target, heat projection (now + move + weapons − sinks = end, effects). */
export function useFirePreview(unitId: UnitId | null | undefined, plan: FirePlan | null): FirePreview | null {
  return usePresentedStore((s) => { const st = shown(s); return st && unitId && plan ? memo(st, `fire|${unitId}|${k(plan)}`, () => query.firePreview(st, unitId, plan)) : null })
}
/** Fire preview for the current fire draft (twist, flip, shots). */
export function useFireDraftPreview(unitId: UnitId | null | undefined): FirePreview | null {
  const d = useUiStore((s) => s.fire)
  return useFirePreview(unitId, unitId ? draftPlan(d) : null)
}
const planCache = new WeakMap<FireDraft, FirePlan>()
function draftPlan(d: FireDraft): FirePlan {
  let p = planCache.get(d)
  if (!p) { p = { twist: d.twist, flip: d.flip, shots: d.shots.filter((x) => !!x.targetId).map((x) => ({ mountId: x.mountId, targetId: x.targetId!, ...(x.binId ? { binId: x.binId } : {}), ...(x.aimedAt ? { aimedAt: x.aimedAt } : {}), ...(x.rapidShots ? { rapidShots: x.rapidShots } : {}) })) }; planCache.set(d, p) }
  return p
}
/** Every physical option (punch per arm, both, kick per leg, push) vs a target, legal or not, each with a ready `choice`. */
export function usePhysicalOptions(attackerId: UnitId | null | undefined, targetId: UnitId | null | undefined): PhysicalPreview[] {
  return usePresentedStore((s) => { const st = shown(s); return st && attackerId && targetId ? memo(st, `phys|${attackerId}|${targetId}`, () => query.physicalOptions(st, attackerId, targetId)) ?? EMPTY_ARR : EMPTY_ARR })
}
/** One physical attack preview (charge/DFA from a reach entry: pass attackerAt.hex = entry.physical.fromHex). */
export function usePhysicalPreview(req: PhysicalPreviewRequest | null): PhysicalPreview | null {
  return usePresentedStore((s) => { const st = shown(s); return st && req ? memo(st, `physOne|${k(req)}`, () => query.physicalPreview(st, req)) : null })
}
/** Heat projection for a plan (move mode, jump hexes, firing mounts). */
export function useHeatProjection(unitId: UnitId | null | undefined, plan: HeatPlan | null): HeatProjection | null {
  return usePresentedStore((s) => { const st = shown(s); return st && unitId && plan ? memo(st, `heat|${unitId}|${k(plan)}`, () => query.heatProjection(st, unitId, plan)) : null })
}
/** The heat scale rows (thresholds and effects). Static. */
let heatScaleRows: HeatScaleRow[] | null = null
export function useHeatScale(): HeatScaleRow[] { heatScaleRows ??= query.heatScale(); return heatScaleRows }
/** Record sheet numbers for a unit, from the PRESENTED state (bars drain with the beats). */
export function useSheet(unitId: UnitId | null | undefined): SheetView | null {
  return usePresentedStore((s) => { const st = shown(s); return st && unitId ? memo(st, `sheet|${unitId}`, () => query.sheet(st, unitId)) : null })
}
/** Hover card numbers for a hex (label, level, terrain, move costs, LOS effect). */
export function useTerrainInfo(hex: Hex | null | undefined): TerrainInfo | null {
  return usePresentedStore((s) => { const st = shown(s); return st && hex ? memo(st, `terrain|${hexKey(hex)}`, () => query.terrainInfo(st, hex)) : null })
}
/** PSR target for a unit and reason (TN, mods, p, auto). */
export function usePsrPreview(unitId: UnitId | null | undefined, reason: PsrReason): ReturnType<typeof query.psrPreview> | null {
  return usePresentedStore((s) => { const st = shown(s); return st && unitId ? memo(st, `psr|${unitId}|${reason}`, () => query.psrPreview(st, unitId, reason)) : null })
}
/** Threat at a hex (expected damage per side) [M4+ overlay]. */
export function useThreat(hex: Hex | null | undefined): ThreatView | null {
  return usePresentedStore((s) => { const st = shown(s); return st && hex ? memo(st, `threat|${hexKey(hex)}`, () => query.threat(st, hex)) : null })
}

// ---------- non-hook queries on the TRUE state (controllers, keyboard handlers) ----------
export const queryReach = (unitId: UnitId): ReachEntry[] => { const s = truth(); return s ? memo(s, `reach|${unitId}`, () => query.reachable(s, unitId)) ?? [] : [] }
export const queryLos = (from: UnitId | Hex, to: UnitId | Hex, opts?: LosOptions): LosVerdict | null => { const s = truth(); return s ? memo(s, `los|${k(from)}|${k(to)}|${k(opts)}`, () => query.los(s, from, to, opts)) : null }
export const queryArcs = (unitId: UnitId, twist?: Twist): ArcsView | null => { const s = truth(); return s ? memo(s, `arcs|${unitId}|${twist ?? 'cur'}`, () => query.arcs(s, unitId, twist)) : null }
export const queryAttackPreview = (req: AttackPreviewRequest): AttackPreview | null => { const s = truth(); return s ? memo(s, `atk|${k(req)}`, () => query.attackPreview(s, req)) : null }
export const queryFirePreview = (unitId: UnitId, plan: FirePlan): FirePreview | null => { const s = truth(); return s ? memo(s, `fire|${unitId}|${k(plan)}`, () => query.firePreview(s, unitId, plan)) : null }
export const queryPhysicalOptions = (attackerId: UnitId, targetId: UnitId): PhysicalPreview[] => { const s = truth(); return s ? memo(s, `phys|${attackerId}|${targetId}`, () => query.physicalOptions(s, attackerId, targetId)) ?? [] : [] }
export const queryHeatProjection = (unitId: UnitId, plan: HeatPlan): HeatProjection | null => { const s = truth(); return s ? memo(s, `heat|${unitId}|${k(plan)}`, () => query.heatProjection(s, unitId, plan)) : null }
export const querySheet = (unitId: UnitId): SheetView | null => { const s = truth(); return s ? memo(s, `sheet|${unitId}`, () => query.sheet(s, unitId)) : null }
export const queryTerrainInfo = (hex: Hex): TerrainInfo | null => { const s = truth(); return s ? memo(s, `terrain|${hexKey(hex)}`, () => query.terrainInfo(s, hex)) : null }
/** Hex distance (ruler). */
export const queryDistance = (a: Hex, b: Hex): number => query.distance(a, b)
/** Hit-location odds for a direction/table (hover help). */
export const queryHitTable = query.hitTable
/** Heat effects at a heat level (thresholds from the engine). */
export const queryHeatEffects = query.heatEffects
/** Engine words for decisions, events, actions, units, locations. */
export { engineDescribe }

// ---------- hex helpers (wrap engine hex math; the board's hexWorld builds on these) ----------
/** 'XXYY' label of a hex on the presented board (null off the board). */
export function hexLabelOf(hex: Hex): HexLabel | null { const s = usePresentedStore.getState().state ?? truth(); return s ? hexToLabel(s.board, hex) : null }
/** Hex from an 'XXYY' label (null if malformed). */
export const hexFromLabel = (label: HexLabel): Hex | null => labelToHex(label)
/** Hex centre in world units, board centred at the origin (engine query.hexToWorld). */
export function hexToWorld(hex: Hex): WorldXZ { const s = usePresentedStore.getState().state ?? truth(); return s ? query.hexToWorld(s, hex) : { x: 0, z: 0 } }
export const sameHex = (a: Hex | null | undefined, b: Hex | null | undefined): boolean => !!a && !!b && a.q === b.q && a.r === b.r

// =====================================================================================================
// Actions
// =====================================================================================================
/** First legal action matching `pred` (engine-provided answers only). */
function findLegal<T extends Action>(pred: (a: Action) => a is T): T | null {
  const s = truth()
  return s ? legalFor(s).find(pred) ?? null : null
}
const notFound = (what: string): ClientRejection => ({ code: 'E_CLIENT', text: 'That is not possible right now.', detail: `no legal ${what}`, action: null, at: Date.now(), id: -1 })

export const game = {
  /** Start a game (mission, forces, map, controllers, bot, seed). Returns a rejection or null. */
  newGame,
  /** Same setup with a new seed (end screen). */
  playAgain,
  /** Dispatch a full Action as the human (refused when the decision is the bot's). */
  dispatch: (a: Action): ClientRejection | null => dispatch(a, 'human'),
  /** Dispatch a payload for the open decision; decisionId and player are filled in. */
  answer(payload: ActionPayload): ClientRejection | null { const a = actionFor(payload); return a ? dispatch(a, 'human') : notFound('decision') },
  /** Pick one of pending.options by id (choice, chooseAmmo, powerChoice ...). */
  answerOption(optionId: string): ClientRejection | null {
    const opt = useGameStore.getState().pending?.options?.find((o) => o.id === optionId)
    return opt ? dispatch(opt.action, 'human') : notFound(`option ${optionId}`)
  },
  /** Pass the open decision (when pending.canPass). */
  pass: (): ClientRejection | null => game.answer({ type: 'pass' }),
  /** Acknowledge (initiativeAck / gameOver). */
  ack: (): ClientRejection | null => game.answer({ type: 'ack' }),
  /** selectUnit: pick the next 'Mech to act (must be in pending.context.eligible). */
  selectUnit(unitId: UnitId): ClientRejection | null {
    const a = findLegal((x): x is Extract<Action, { type: 'selectUnit' }> => x.type === 'selectUnit' && x.unitId === unitId)
    return a ? dispatch(a, 'human') : notFound(`selectUnit ${unitId}`)
  },
  /** move: commit a reach entry (dispatches the entry's ready action, charge/DFA included). */
  commitMove: (entry: ReachEntry): ClientRejection | null => dispatch(entry.action, 'human'),
  /** move: commit the entry the move draft points at. */
  commitMoveDraft(): ClientRejection | null {
    const s = truth(), p = s?.pending
    if (!s || !p?.unitId) return notFound('move')
    const e = findReachEntry(queryReach(p.unitId), useUiStore.getState().move)
    return e ? dispatch(e.action, 'human') : notFound('move entry')
  },
  /** standUp: attempt (with the turn's mode when the engine asks for one) or stay prone; picks the matching legal answer. */
  standUp(attempt: boolean, mode?: 'walk' | 'run', facing?: Facing): ClientRejection | null {
    const a = findLegal((x): x is Extract<Action, { type: 'standUp' }> => x.type === 'standUp' && x.attempt === attempt && (mode === undefined || x.mode === undefined || x.mode === mode) && (facing === undefined || x.facing === undefined || x.facing === facing))
    return a ? dispatch(facing !== undefined && attempt ? { ...a, facing } : a, 'human') : notFound('standUp')
  },
  /** torsoTwist: twist -1/0/+1 or arm flip (must be in pending.context.twistOptions / canFlip). */
  twist(twist: Twist, flip = false): ClientRejection | null {
    const a = findLegal((x): x is Extract<Action, { type: 'torsoTwist' }> => x.type === 'torsoTwist' && x.twist === twist && x.flip === flip)
    return a ? dispatch(a, 'human') : notFound('torsoTwist')
  },
  /** declareFire: the composite declaration from engine mount/unit/bin ids (shots[0]'s target is primary). */
  fire(shots: FireShot[], propArm?: ArmLoc): ClientRejection | null {
    const p = truth()?.pending
    if (!p || p.kind !== 'declareFire' || !p.unitId) return notFound('declareFire')
    const a: DeclareFireAction = { type: 'declareFire', decisionId: p.id, player: p.player, unitId: p.unitId, shots, ...(propArm ? { propArm } : {}) }
    return dispatch(a, 'human')
  },
  /** declareFire with the current fire draft. */
  fireDraft: (): ClientRejection | null => game.fire(useUiStore.getState().fire.shots),
  /** declareFire with no shots (always legal). */
  holdFire: (): ClientRejection | null => game.fire([]),
  /** declarePhysical: a preview's ready `choice` (or { kind: 'none' }). */
  physical(choice: PhysicalChoice): ClientRejection | null {
    const p = truth()?.pending
    if (!p || p.kind !== 'declarePhysical' || !p.unitId) return notFound('declarePhysical')
    return dispatch({ type: 'declarePhysical', decisionId: p.id, player: p.player, unitId: p.unitId, attack: choice }, 'human')
  },
  /** Legal answers for the true open decision (engine-validated, cached). */
  legal: (): Action[] => legalFor(truth()),
  clearRejection,
  setController,
  /** Start-screen Continue: true only when the autosave matches this build's data. */
  hasAutosave,
  readAutosave,
  /** Load the autosave; a failure deletes the slot and returns a rejection (toast its .text). */
  continueGame,
  clearAutosave,
  /** Current game as a JSON-able save (download). */
  exportSave,
  /** Load a save object (ClientSave or bare engine SaveFile). */
  importSave,
  saveGame,
  loadGame,
}

export const presentation = {
  /** Skip the beat playing now (any click / Space). */
  skip: skipBeat,
  /** Show everything queued immediately (Esc while animating). */
  skipAll,
  setPaused,
  /** Animation speed: 0.5 / 1 / 2 / 4, 0 = instant (see SPEED_PRESETS). */
  setSpeed: (speed: number) => useSettingsStore.getState().set({ speed }),
}

export const uiActions = {
  select: ui.select,
  hoverUnit: ui.hoverUnit,
  hoverHex: ui.hoverHex,
  setMode: ui.setMode,
  /** M / L keys: toggle the ruler / LOS view. */
  toggleTool: ui.toggleTool,
  setMeasure: ui.setMeasure,
  toggleThreat: ui.toggleThreat,
  toggleRanges: ui.toggleRanges,
  setMoveDraft: ui.setMoveDraft,
  resetMoveDraft: ui.resetMoveDraft,
  setFireDraft: ui.setFireDraft,
  resetFireDraft: ui.resetFireDraft,
  setPhysicalDraft: ui.setPhysicalDraft,
  openPanel: ui.openPanel,
}

export const settings = {
  set: (patch: Partial<Settings>) => useSettingsStore.getState().set(patch),
}
/** Rails: toggle('left' | 'right'), set(rail, collapsed). */
export const panels = panelActions

// ---------- start screen catalogue (data names; no rules) ----------
export { defaultControllers, listForces, listMaps, listMissions }

// ---------- labels and formatting (our words; names from state/data; numbers from the engine) ----------
export {
  CRIT_EFFECT_LABELS, DECISION_LABELS, DEFAULT_FORCE_COLOURS, DESTROY_CAUSE_LABELS, DIRECTION_LABELS, FACING_LABELS, FACING_WORDS,
  HEAT_EFFECT_LABELS, LOC_LABELS, LOC_SHORT, LOS_REASON_LABELS, MOD_LABELS, MOVE_MODE_LABELS, PHASE_LABELS, PSR_REASON_LABELS,
  RANGE_LABELS, ROLL_PURPOSE_LABELS, STATUS_LABELS, TERRAIN_LABELS,
  endCause, forceColour, formatMod, formatOdds, hexName, narrate, rollLabel, rollVerdict, sideName, unitName,
}

// =====================================================================================================
// Boot
// =====================================================================================================
let booted: (() => void) | null = null
export interface BootOptions { testHooks?: boolean; clickToSkip?: boolean; autosave?: boolean; bot?: boolean }

/**
 * Call once from App (idempotent): loads settings (and `?speed=`), starts the bot driver, autosave each turn, makes the
 * board follow human decisions (mode + selection + fresh drafts), installs click-to-skip and, with ?test=1,
 * window.__game. Returns a teardown. Then call startFromUrl() to skip the start screen when the URL names a scenario.
 */
export function bootClient(opts: BootOptions = {}): () => void {
  if (booted) return booted
  useSettingsStore.getState().reload()
  const sp = speedFromUrl()
  if (sp !== null) useSettingsStore.getState().set({ speed: sp })
  const offs: (() => void)[] = []
  if (opts.bot !== false) { const d = startBotDriver(); offs.push(() => d.stop()) }
  if (opts.autosave !== false) offs.push(installAutosave())
  offs.push(installFollowDecision())
  if (opts.clickToSkip !== false && typeof window !== 'undefined') {
    const onDown = () => { if (!usePresentedStore.getState().idle) skipBeat() }
    window.addEventListener('pointerdown', onDown, { capture: true })
    offs.push(() => window.removeEventListener('pointerdown', onDown, { capture: true }))
  }
  installTestHooks(opts.testHooks === true)
  booted = () => { for (const f of offs) f(); booted = null }
  return booted
}

/** `?scenario=&forces=&control=&seed=&map=&bot=&turnLimit=`: start that game now. True when a game was started. */
export function startFromUrl(search?: string): boolean {
  const o = setupFromUrl(search)
  return !!o && newGame(o) === null
}
export { installTestHooks, registerHexToScreen, setupFromUrl }

/** When a human prompt becomes visible, put the board in that decision's mode, select its unit, reset drafts. */
function installFollowDecision(): () => void {
  let lastId: string | null = null
  const check = () => {
    const g = useGameStore.getState()
    const p = promptOf(g, usePresentedStore.getState().idle)
    const id = p ? `${g.version}:${p.id}` : null
    if (!p || id === lastId) return
    lastId = id
    ui.followDecision(p.kind, p.unitId)
  }
  const a = useGameStore.subscribe(check)
  const b = usePresentedStore.subscribe(check)
  return () => { a(); b() }
}

// Additive changes after the M3 freeze: (none yet)

