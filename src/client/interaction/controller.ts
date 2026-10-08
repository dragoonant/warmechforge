// Pointer / keyboard controllers (50 sections 5 to 7). Functions over the stores; the R3F layer only forwards LEFT-button
// clicks here, so right / middle clicks and camera drags can never answer a decision. Answers are always engine-provided
// entries (reach entries, legal actions) dispatched through contract.game.*; nothing here builds a rules action.
import type { Action, DeployAction, Facing, Hex, MoveMode, UnitId } from '../../engine/index'
import { FACINGS } from '../../engine/index'
import { findReachEntry, game, groupReach, presentation, queryReach, settings, uiActions, panels, type ClientRejection } from '../contract'
import { useUiStore } from '../store/uiStore'
import { useSettingsStore } from '../store/settingsStore'
import { activeUnitOf, currentPrompt, presentedState, truthState } from './adapter'
import { attackTargets, facingChoices, sameHex, stepFacing } from './overlayModel'
import { interactionActions, useInteractionStore } from './store'

const MODE_ORDER: MoveMode[] = ['walk', 'run', 'jump']

/** Is the open decision the move / deploy kind (the board shows reach or the deployment zone)? */
export const isMovePrompt = (kind: string | undefined): boolean => kind === 'move' || kind === 'deploy' || kind === 'standUp'

/** Hexes the unit may be placed on (deploy decision), engine-provided. */
export function deployZone(): Hex[] {
  const p = currentPrompt()
  return p?.kind === 'deploy' ? p.context.zone ?? [] : []
}

/** The unit a deployment click places: the selected one if it is still to deploy, else the first eligible. */
export function deployUnitId(): UnitId | null {
  const p = currentPrompt()
  if (p?.kind !== 'deploy') return null
  const el = p.context.eligible ?? []
  const sel = useUiStore.getState().selectedId
  return sel && el.includes(sel) ? sel : el[0] ?? null
}

/** Reach entries for the unit whose move is open. */
function moveEntries(): ReturnType<typeof queryReach> {
  const p = currentPrompt()
  return p?.kind === 'move' && p.unitId ? queryReach(p.unitId) : []
}

// ---------- clicks ----------
function ruler(hex: Hex): void {
  const { measureFrom, measureTo } = useUiStore.getState()
  if (!measureFrom || measureTo) uiActions.setMeasure(hex, null)
  else uiActions.setMeasure(measureFrom, hex)
}

function losClick(hex: Hex): void {
  const s = useUiStore.getState()
  const st = presentedState()
  const sel = s.selectedId ? st?.units[s.selectedId]?.pos : null
  const from = s.measureFrom ?? sel ?? null
  if (!from) { uiActions.setMeasure(hex, null); return }
  uiActions.setMeasure(from, hex)
}

/** A click on a 'Mech. Selection, targeting or (with a decision open) the decision's own meaning. */
export function handleUnitClick(id: UnitId): ClientRejection | null {
  const st = presentedState()
  const u = st?.units[id]
  if (!u || !u.pos) return null
  const ui = useUiStore.getState()
  if (ui.mode === 'measure') { ruler(u.pos); return null }
  if (ui.mode === 'los') { losClick(u.pos); uiActions.select(id); return null }
  const p = currentPrompt()
  const active = activeUnitOf(truthState(), p)
  const enemy = !!active && active.owner !== u.owner
  // choose the next unit to act
  if (p?.kind === 'selectUnit' && (p.context.eligible ?? []).includes(id)) {
    uiActions.select(id)
    return game.selectUnit(id)
  }
  if (p?.kind === 'deploy' && (p.context.eligible ?? []).includes(id)) { uiActions.select(id); return null }
  if (ui.mode === 'fire' && enemy) {
    uiActions.setFireDraft({ targetId: id })
    uiActions.select(id)
    return null
  }
  if (ui.mode === 'physical' && enemy) {
    uiActions.setPhysicalDraft({ targetId: id })
    uiActions.select(id)
    return null
  }
  // the moving 'Mech's own figure covers its hex: a click on it means "turn in place here" (a hex click)
  if (ui.mode === 'move' && p?.kind === 'move' && id === p.unitId) return handleHexClick(u.pos)
  if (ui.mode === 'move' && p?.kind === 'move' && enemy) {
    // clicking a charge / DFA target in move mode picks that attack (its first end hex); the player then picks a facing
    const entries = moveEntries()
    for (const mode of [ui.move.mode, ...MODE_ORDER]) {
      const t = attackTargets(entries, mode).get(id)
      if (t && t.fromHexes[0]) {
        interactionActions.setAttackTarget(id)
        uiActions.setMoveDraft({ mode, hex: t.fromHexes[0], facing: null, attack: true })
        return null
      }
    }
  }
  uiActions.select(id)
  return null
}

/** A click on the table hex under the pointer. */
export function handleHexClick(hex: Hex): ClientRejection | null {
  const ui = useUiStore.getState()
  if (ui.mode === 'measure') { ruler(hex); return null }
  if (ui.mode === 'los') { losClick(hex); return null }
  const p = currentPrompt()
  if (p?.kind === 'deploy') {
    if (!deployZone().some((h) => sameHex(h, hex))) return null
    uiActions.setMoveDraft({ hex, facing: null, attack: false, mode: 'walk' })
    return null
  }
  if (p?.kind === 'move' && p.unitId) {
    const entries = queryReach(p.unitId)
    const draft = ui.move
    let mode = draft.mode
    let groups = groupReach(entries.filter((e) => e.mode === mode && !e.physical))
    if (!groups.has(`${hex.q},${hex.r}`)) {
      // not reachable in this mode: switch to the first mode that reaches it (walk, then run, then jump)
      const alt = MODE_ORDER.find((m) => groupReach(entries.filter((e) => e.mode === m && !e.physical)).has(`${hex.q},${hex.r}`))
      if (!alt) { uiActions.resetMoveDraft(); return null }
      mode = alt
      groups = groupReach(entries.filter((e) => e.mode === mode && !e.physical))
    }
    const g = groups.get(`${hex.q},${hex.r}`)!
    interactionActions.setAttackTarget(null)
    uiActions.setMoveDraft({ mode, hex, attack: false, facing: g.facings.length === 1 ? g.facings[0]! : null })
    return null
  }
  if (ui.mode === 'select' && !p) uiActions.select(null)
  return null
}

/** Facing choices for the hex the move draft has locked (empty when none). */
export function currentFacingChoices(): ReturnType<typeof facingChoices> {
  const p = currentPrompt()
  const d = useUiStore.getState().move
  if (!d.hex) return []
  if (p?.kind === 'deploy') return FACINGS.map((f) => ({ facing: f, enabled: true, mp: null }))
  if (p?.kind === 'move' && p.unitId) return facingChoices(queryReach(p.unitId), d.hex, d.mode, d.attack)
  return []
}

/** Pick the final facing on the facing picker. */
export function chooseFacing(f: Facing): void {
  const c = currentFacingChoices()
  if (!c[f]?.enabled) return
  uiActions.setMoveDraft({ facing: f })
}

/** Is the move / deployment draft complete (hex and facing locked, and an engine entry or legal action exists)? */
export function draftReady(): boolean {
  const p = currentPrompt()
  const d = useUiStore.getState().move
  if (!p || !d.hex || d.facing === null) return false
  if (p.kind === 'deploy') return !!findDeployAction(d.hex, d.facing)
  if (p.kind === 'move' && p.unitId) return !!findReachEntry(queryReach(p.unitId), d)
  return false
}

function findDeployAction(hex: Hex, facing: Facing): DeployAction | null {
  const id = deployUnitId()
  if (!id) return null
  const a = game.legal().find((x): x is DeployAction => x.type === 'deploy' && x.unitId === id && sameHex(x.hex, hex) && x.facing === facing)
  return a ?? null
}

/** Confirm the staged move / deployment (Enter, or the picker's confirm chip). */
export function confirmDraft(): ClientRejection | null {
  const p = currentPrompt()
  const d = useUiStore.getState().move
  if (!p || !d.hex || d.facing === null) return null
  let r: ClientRejection | null = null
  if (p.kind === 'deploy') {
    const a = findDeployAction(d.hex, d.facing)
    if (!a) return null
    r = game.dispatch(a as Action)
  } else if (p.kind === 'move') {
    r = game.commitMoveDraft()
  } else return null
  if (!r) { uiActions.resetMoveDraft(); interactionActions.setAttackTarget(null) }
  return r
}

/** Esc: clear the draft first, then the selection. */
export function cancelOrDeselect(): boolean {
  const ui = useUiStore.getState()
  if (ui.move.hex) { uiActions.resetMoveDraft(); interactionActions.setAttackTarget(null); return true }
  if (ui.fire.targetId || ui.physical.targetId) { uiActions.setFireDraft({ targetId: null }); uiActions.setPhysicalDraft({ targetId: null }); return true }
  if (ui.modeLocked) { uiActions.setMode(fallbackMode()); return true }
  if (ui.selectedId) { uiActions.select(null); return true }
  return false
}

/** The mode the open decision wants (what M / L fall back to). */
export function fallbackMode(): 'select' | 'move' | 'fire' | 'physical' {
  const k = currentPrompt()?.kind
  if (k === 'move' || k === 'deploy' || k === 'standUp') return 'move'
  if (k === 'torsoTwist' || k === 'declareFire' || k === 'chooseAmmo') return 'fire'
  if (k === 'declarePhysical') return 'physical'
  return 'select'
}

/** Tab / Shift+Tab: cycle own (or enemy) units, in force order. */
export function cycleUnit(enemy: boolean): void {
  const st = presentedState()
  if (!st) return
  const p = currentPrompt()
  const me = p?.player ?? st.pending?.player ?? 'A'
  const ids = st.unitOrder.filter((id) => { const u = st.units[id]; return !!u && !!u.pos && u.status !== 'destroyed' && (enemy ? u.owner !== me : u.owner === me) })
  if (!ids.length) return
  const sel = useUiStore.getState().selectedId
  const i = sel ? ids.indexOf(sel) : -1
  uiActions.select(ids[(i + 1) % ids.length]!)
}

/** Q / E: rotate the draft facing through the enabled arrows. */
export function rotateFacing(dir: 1 | -1): void {
  const c = currentFacingChoices()
  if (!c.length) return
  const next = stepFacing(c, useUiStore.getState().move.facing, dir)
  if (next !== null) uiActions.setMoveDraft({ facing: next })
}

/** , and . : preview a torso twist (only a twist the open decision offers). */
export function nudgeTwist(dir: -1 | 1): void {
  const p = currentPrompt()
  if (p?.kind !== 'torsoTwist') return
  const opts = p.context.twistOptions ?? [0]
  const cur = useUiStore.getState().fire.twist
  const next = Math.max(-1, Math.min(1, cur + dir)) as -1 | 0 | 1
  if (opts.includes(next)) uiActions.setFireDraft({ twist: next, flip: false })
}

/** Enter on a torso twist decision: commit the previewed twist (the FirePanel's confirm does the same). */
export function confirmTwist(): ClientRejection | null {
  const p = currentPrompt()
  if (p?.kind !== 'torsoTwist') return null
  const d = useUiStore.getState().fire
  return game.twist(d.flip ? 0 : d.twist, d.flip)
}

export const skipBeat = (): void => presentation.skip()
export const toggleGrid = (): void => settings.set({ grid: !useSettingsStore.getState().grid })
export const toggleRail = (rail: 'left' | 'right'): void => panels.toggle(rail)
export const resetInteraction = (): void => { interactionActions.reset() }
export { useInteractionStore }
