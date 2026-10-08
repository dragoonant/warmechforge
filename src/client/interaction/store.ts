// Board-local interaction state. Display and intent only: it never holds a rules number. The HUD may read and write it
// (for example hover a weapon row to draw its range rings).
import { create } from 'zustand'
import type { Facing, Hex, LocalId, UnitId } from '../../engine/index'

export interface InteractionState {
  /** Weapon row the pointer is over in the FirePanel (draws that weapon's range bands). */
  hoverWeapon: LocalId | null
  /** Facing arrow the pointer is over (previews the figure ghost). */
  hoverFacing: Facing | null
  /** Charge / DFA target picked with the chip (move draft `attack`). */
  attackTarget: UnitId | null
  /** Last hex the ruler / LOS tool anchored on when it began from a unit. */
  anchor: Hex | null
}

export const useInteractionStore = create<InteractionState>(() => ({ hoverWeapon: null, hoverFacing: null, attackTarget: null, anchor: null }))

export const interactionActions = {
  setHoverWeapon(id: LocalId | null): void { if (useInteractionStore.getState().hoverWeapon !== id) useInteractionStore.setState({ hoverWeapon: id }) },
  setHoverFacing(f: Facing | null): void { if (useInteractionStore.getState().hoverFacing !== f) useInteractionStore.setState({ hoverFacing: f }) },
  setAttackTarget(id: UnitId | null): void { useInteractionStore.setState({ attackTarget: id }) },
  reset(): void { useInteractionStore.setState({ hoverWeapon: null, hoverFacing: null, attackTarget: null, anchor: null }) },
}
