// Pure UI state (50 §1): selection, hover, the active tool mode, ruler/LOS endpoints and the move/fire/physical plan
// drafts. Never holds a rules number: drafts are the player's picks; every number for them comes from engine queries.
import { create } from 'zustand'
import type { DecisionKind, Facing, FireShot, Hex, MoveMode, PhaseId, Twist, UnitId } from '../../engine/index'

/**
 * What a board click means right now.
 * - select:   click a 'Mech to select it (selectUnit decisions: click an eligible one)
 * - move:     reach overlay; click a hex, then a facing (move, standUp, deploy)
 * - fire:     arcs + click an enemy to target it (torsoTwist, declareFire, chooseAmmo)
 * - physical: click an adjacent enemy to target it (declarePhysical)
 * - measure:  ruler (M); never answers a decision
 * - los:      LOS view (L) from the selected unit / first click to the hovered hex; never answers a decision
 */
export type UiMode = 'select' | 'move' | 'fire' | 'physical' | 'measure' | 'los'

/** Movement plan (50 §6). `hex` locked by a click; `facing` picked on the FacingPicker; `attack` = the charge/DFA chip. */
export interface MoveDraft { mode: MoveMode; hex: Hex | null; facing: Facing | null; attack: boolean }
/** Ranged plan (50 §7). shots[0]'s target is the primary target; `twist`/`flip` preview the torsoTwist decision. */
export interface FireDraft { twist: Twist; flip: boolean; targetId: UnitId | null; shots: FireShot[] }
/** Physical plan (50 §7.6): the chosen target; the options come from query.physicalOptions. */
export interface PhysicalDraft { targetId: UnitId | null }

export interface UiState {
  selectedId: UnitId | null
  hoverUnitId: UnitId | null
  hoverHex: Hex | null
  mode: UiMode
  /** True when the player picked measure/los themselves; decision changes then leave the mode alone. */
  modeLocked: boolean
  /** Ruler / LOS endpoints (hexes). LOS from a unit uses its hex. */
  measureFrom: Hex | null
  measureTo: Hex | null
  showThreat: boolean // T [M4+]
  showRanges: boolean // R
  move: MoveDraft
  fire: FireDraft
  physical: PhysicalDraft
  /** Free-form id of an open popover (settings, help, sheet), owned by the HUD agent. */
  panel: string | null
}

export const EMPTY_MOVE: MoveDraft = { mode: 'walk', hex: null, facing: null, attack: false }
export const EMPTY_FIRE: FireDraft = { twist: 0, flip: false, targetId: null, shots: [] }
export const EMPTY_PHYSICAL: PhysicalDraft = { targetId: null }

export const INITIAL_UI: UiState = {
  selectedId: null, hoverUnitId: null, hoverHex: null, mode: 'select', modeLocked: false, measureFrom: null, measureTo: null,
  showThreat: false, showRanges: false, move: EMPTY_MOVE, fire: EMPTY_FIRE, physical: EMPTY_PHYSICAL, panel: null,
}

export const useUiStore = create<UiState>(() => ({ ...INITIAL_UI }))

/** The mode a decision naturally puts the board in. */
export function modeForDecision(kind: DecisionKind | null | undefined, _phase?: PhaseId): UiMode {
  switch (kind) {
    case 'move': case 'standUp': case 'deploy': return 'move'
    case 'torsoTwist': case 'declareFire': case 'chooseAmmo': return 'fire'
    case 'declarePhysical': return 'physical'
    default: return 'select'
  }
}

const sameHex = (a: Hex | null, b: Hex | null): boolean => (a === b) || (!!a && !!b && a.q === b.q && a.r === b.r)

export const ui = {
  select(id: UnitId | null): void { if (useUiStore.getState().selectedId !== id) useUiStore.setState({ selectedId: id }) },
  hoverUnit(id: UnitId | null): void { if (useUiStore.getState().hoverUnitId !== id) useUiStore.setState({ hoverUnitId: id }) },
  hoverHex(h: Hex | null): void { if (!sameHex(useUiStore.getState().hoverHex, h)) useUiStore.setState({ hoverHex: h }) },
  /** Player-chosen mode. measure/los lock the mode until the player leaves it; the others unlock. */
  setMode(mode: UiMode): void {
    const locked = mode === 'measure' || mode === 'los'
    useUiStore.setState({ mode, modeLocked: locked, measureFrom: null, measureTo: null })
  },
  /** M / L keys: pressing twice returns to `fallback` (the decision's own mode). */
  toggleTool(mode: 'measure' | 'los', fallback: UiMode = 'select'): void {
    const s = useUiStore.getState()
    if (s.mode === mode) useUiStore.setState({ mode: fallback, modeLocked: false, measureFrom: null, measureTo: null })
    else ui.setMode(mode)
  },
  /** Called when a new human prompt opens: follow the decision unless a tool is locked; drafts reset. */
  followDecision(kind: DecisionKind | null, unitId?: UnitId | null): void {
    const s = useUiStore.getState()
    const patch: Partial<UiState> = {}
    if (!s.modeLocked) patch.mode = modeForDecision(kind)
    if (unitId && s.selectedId !== unitId) patch.selectedId = unitId
    // a new decision for a new unit starts from clean drafts; the twist draft survives torsoTwist -> declareFire
    if (kind === 'move' || kind === 'standUp' || kind === 'deploy') patch.move = { ...EMPTY_MOVE, mode: s.move.mode === 'standStill' ? 'walk' : s.move.mode }
    if (kind === 'torsoTwist') patch.fire = EMPTY_FIRE
    if (kind === 'declareFire') patch.fire = { ...EMPTY_FIRE, twist: s.fire.twist, flip: s.fire.flip, targetId: s.fire.targetId }
    if (kind === 'declarePhysical') patch.physical = EMPTY_PHYSICAL
    useUiStore.setState(patch)
  },
  setMeasure(from: Hex | null, to: Hex | null = null): void { useUiStore.setState({ measureFrom: from, measureTo: to }) },
  toggleThreat(): void { useUiStore.setState((s) => ({ showThreat: !s.showThreat })) },
  toggleRanges(): void { useUiStore.setState((s) => ({ showRanges: !s.showRanges })) },
  setMoveDraft(patch: Partial<MoveDraft>): void { useUiStore.setState((s) => ({ move: { ...s.move, ...patch } })) },
  resetMoveDraft(): void { useUiStore.setState((s) => ({ move: { ...EMPTY_MOVE, mode: s.move.mode } })) },
  setFireDraft(patch: Partial<FireDraft>): void { useUiStore.setState((s) => ({ fire: { ...s.fire, ...patch } })) },
  resetFireDraft(): void { useUiStore.setState({ fire: EMPTY_FIRE }) },
  setPhysicalDraft(patch: Partial<PhysicalDraft>): void { useUiStore.setState((s) => ({ physical: { ...s.physical, ...patch } })) },
  openPanel(panel: string | null): void { useUiStore.setState({ panel }) },
  reset(): void { useUiStore.setState({ ...INITIAL_UI }) },
}
