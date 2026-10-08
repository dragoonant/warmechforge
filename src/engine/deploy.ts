// Deployment (11 section 4, 10 SCN-001/002): placed deployment (edgePlace / hexes) and the edge-entry context for the Movement Phase.
// Zone and queue come from scenario.ts (read only); this module validates and applies a DeployAction and lists the legal ones.
import type { DeployAction } from './actions'
import type { GameEvent } from './events'
import { edgeHexes, hexEq, neighbor, onBoard, opposite } from './hex'
import { entryFacings, isImmobile, unitAt } from './movement'
import { patchUnit } from './pilot'
import type { Stepped } from './pilot'
import { placementZone, toPlace } from './scenario'
import { COLUMN_STEP, FACINGS } from './types'
import type { DataBundle, DecisionContext, Facing, GameState, Hex, PlayerId, Rejection, UnitId } from './types'

/** The facing that points most nearly at the board centre; exact ties take the lower facing (00 section 9.5 deploy). */
export function facingTowardCentre(state: GameState, h: Hex): Facing {
  const x = h.q * COLUMN_STEP, y = h.r + h.q / 2
  const dx = state.board.centre.x - x, dy = state.board.centre.z - y
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 0
  const deg = (((Math.atan2(dx, -dy) * 180) / Math.PI) % 360 + 360) % 360
  const f = deg / 60
  const lo = Math.floor(f + 1e-9)
  const frac = f - lo
  const pick = Math.abs(frac - 0.5) < 1e-6 ? lo : frac > 0.5 ? lo + 1 : lo
  return (((pick % 6) + 6) % 6) as Facing
}

/** Units this side still has to place. */
export const unplaced = (state: GameState, player: PlayerId): UnitId[] => toPlace(state, player)

export function validateDeploy(state: GameState, action: DeployAction, data?: DataBundle): Rejection | null {
  const u = state.units[action.unitId]
  if (!u) return { code: 'E_UNKNOWN_UNIT', message: 'unknown unit' }
  if (u.owner !== action.player) return { code: 'E_NOT_YOUR_UNIT', message: 'not your unit' }
  if (!unplaced(state, action.player).includes(u.id)) return { code: 'E_NOT_ELIGIBLE', message: 'that unit is not waiting to be placed' }
  if (!(FACINGS as readonly number[]).includes(action.facing)) return { code: 'E_BAD_FACING', message: 'facing must be 0 to 5' }
  if (!onBoard(state.board, action.hex)) return { code: 'E_OFF_BOARD', message: 'that hex is off the board' }
  if (unitAt(state, action.hex)) return { code: 'E_OCCUPIED', message: 'that hex is taken' }
  if (!placementZone(state, action.player, data).some((h) => hexEq(h, action.hex))) return { code: 'E_PROHIBITED_HEX', message: 'that hex is outside your deployment zone' }
  return null
}

/** Places a unit (SCN-001): status active at the chosen hex and facing. */
export function applyDeploy(state: GameState, action: DeployAction, data?: DataBundle): Stepped & { rejection?: Rejection } {
  const rejection = validateDeploy(state, action, data)
  if (rejection) return { state, events: [], rejection }
  const s = patchUnit(state, action.unitId, { status: 'active', pos: action.hex, facing: action.facing })
  const events: GameEvent[] = [{ type: 'UnitDeployed', unitId: action.unitId, hex: action.hex, facing: action.facing }]
  return { state: s, events }
}

/** Per unplaced unit x zone hex, facing the board centre (00 section 9.5). */
export function legalDeployActions(state: GameState, decisionId: string, player: PlayerId, data?: DataBundle): DeployAction[] {
  const zone = placementZone(state, player, data)
  const out: DeployAction[] = []
  for (const unitId of unplaced(state, player)) {
    for (const hex of zone) out.push({ type: 'deploy', decisionId, player, unitId, hex, facing: facingTowardCentre(state, hex) })
  }
  return out
}

/** Edge-entry context for a `move` decision of an off-board unit (00 section 9.2): home edge, enterable hexes, start facings. */
export function entryContext(state: GameState, unitId: UnitId): NonNullable<DecisionContext['entry']> {
  const u = state.units[unitId]!
  const edge = state.sides[u.owner].homeEdge
  const hexes = edgeHexes(state.board, edge).filter((h) => {
    const occ = unitAt(state, h, unitId)
    return !(occ && occ.owner !== u.owner && !isImmobile(state, occ))
  })
  return { edge, hexes, facings: entryFacings(edge) }
}

/** The virtual off-board hex a unit starts from to enter `edgeHex` with `facing` (SCN-002). */
export const virtualEntryHex = (edgeHex: Hex, facing: Facing): Hex => neighbor(edgeHex, opposite(facing))
