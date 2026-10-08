// Local adapter for the few non-hook reads the pointer handlers need and the frozen contract does not export: the true
// state and the open prompt as a snapshot. Rules answers still go through contract.game.*; nothing here calls engine.step.
import type { GameState, PendingDecision, UnitId, UnitState } from '../../engine/index'
import { isHumanDecision, useGameStore } from '../store/gameStore'
import { usePresentedStore } from '../presentation/presentedStore'

export const truthState = (): GameState | null => useGameStore.getState().state

/** The open decision when a human owns it and the presentation is idle (same gate as contract.usePrompt). */
export function currentPrompt(): PendingDecision | null {
  const g = useGameStore.getState()
  if (g.fatal || !usePresentedStore.getState().idle) return null
  return isHumanDecision(g) ? g.pending : null
}

export const presentedState = (): GameState | null => usePresentedStore.getState().state

/** The unit whose decision is open (prompt unit, else the presented active unit). */
export function activeUnitOf(state: GameState | null, p: PendingDecision | null): UnitState | undefined {
  const id: UnitId | null | undefined = p?.unitId ?? state?.selection?.activeUnit
  return id && state ? state.units[id] : undefined
}
