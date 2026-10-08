// Top bar view model (50 §12): turn, phase, the initiative strip (who won, who is picking, which 'Mechs have acted) and whose
// decision it is. Every value is read from the presented state; nothing is derived by rule.
import type { GameState, PlayerId, UnitId } from '../../engine/index'
import { DECISION_LABELS, PHASE_LABELS, forceColour, sideName, type Controller, type UiMode } from '../contract'

export interface StripUnit { id: UnitId; name: string; acted: boolean; active: boolean; gone: boolean }
export interface StripSide { player: PlayerId; name: string; colour: string; total: number | null; won: boolean; picking: boolean; units: StripUnit[] }
export interface InitiativeStrip { summary: string; sides: StripSide[]; picking: PlayerId | null; left: number | null }

const ALT_PHASES = new Set(['movement', 'rangedAttack', 'physicalAttack'])

export function turnText(state: GameState): string {
  return state.turn > 0 ? `Turn ${state.turn}` : 'Deployment'
}
export function phaseText(state: GameState): string { return PHASE_LABELS[state.phase] }

/** The initiative strip, or null before the first Initiative Phase. */
export function initiativeStrip(state: GameState): InitiativeStrip | null {
  const init = state.initiative
  if (!init) return null
  const sel = state.selection && ALT_PHASES.has(state.phase) ? state.selection : null
  const acted = new Set(sel?.acted ?? [])
  const sides = (['A', 'B'] as PlayerId[]).map((player): StripSide => ({
    player, name: sideName(state, player), colour: forceColour(state, player), total: init.totals[player] ?? null, won: init.winner === player,
    picking: !!sel && sel.turnOf === player,
    units: state.unitOrder.filter((id) => state.units[id]!.owner === player).map((id): StripUnit => {
      const u = state.units[id]!
      return { id, name: u.name, acted: acted.has(id), active: sel?.activeUnit === id, gone: u.status === 'destroyed' || u.status === 'withdrawn' || u.status === 'surrendered' }
    }),
  }))
  const w = sides.find((s) => s.won)!, l = sides.find((s) => !s.won)!
  const summary = `${w.name} won initiative ${w.total} to ${l.total} and acts last`
  return { summary, sides, picking: sel?.turnOf ?? null, left: sel ? sel.leftInGroup : null }
}

/** "Your decision: Eris Lance" / "Opponent (bot) is deciding" / "Battle over". */
export function decisionLine(state: GameState, waiting: { player: PlayerId; controller: Controller } | null, humans: number): string {
  if (state.phase === 'ended') return 'Battle over'
  if (!waiting) return ''
  const name = sideName(state, waiting.player)
  if (waiting.controller === 'bot') return `${name} (bot) is deciding`
  return humans > 1 ? `${name}: your decision` : `Your decision: ${name}`
}

/** The board mode a decision's panel works in, for the tool buttons' fallback. */
export function modeFor(kind: string | null | undefined): UiMode {
  switch (kind) {
    case 'move': case 'standUp': case 'deploy': return 'move'
    case 'torsoTwist': case 'declareFire': case 'chooseAmmo': return 'fire'
    case 'declarePhysical': return 'physical'
    default: return 'select'
  }
}

export const decisionWord = (kind: keyof typeof DECISION_LABELS): string => DECISION_LABELS[kind]
