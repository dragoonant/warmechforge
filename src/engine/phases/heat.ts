// Heat Phase driver (10 HEAT-030, INIT-013/014) plus the shared end-of-phase steps (00 5.4 a-e).
// The per-unit rules live in ../heat.ts (heatPhaseUnit); this module wires its collaborators and orders the phase.
import type { GameEvent } from '../events'
import { bundleFor } from '../bundles'
import { explodeBin } from '../damage'
import { heatDeps, heatPhaseUnit } from '../heat'
import { pickHeatExplosionBin } from '../ammo'
import { consciousnessChecks, initiativeOrder } from '../pilot'
import type { Stepped } from '../pilot'
import { resolvePsrs } from '../psr'
import type { DataBundle, GameResult, GameState } from '../types'
import { applyDoomed, checkVictory, endGame, refreshStatus } from '../victory'

// Wire the heat module's late-bound collaborators (AMMO-030: highest damage per shot first; RULING in issues).
heatDeps.pickBin = (state, unitId) => pickHeatExplosionBin(bundleFor(state), state.units[unitId]!)
heatDeps.explodeAmmo = (state, unitId, binId) => explodeBin(state, unitId, binId, 'heat')

/** HEAT-030 steps 1-5 for every unit on the map, loser's units first. */
export function heatApply(state: GameState): Stepped {
  let s = state
  const events: GameEvent[] = []
  for (const id of initiativeOrder(s)) {
    const st = s.units[id]!.status
    if (st !== 'active' && st !== 'withdrawing') continue
    const r = heatPhaseUnit(s, id)
    s = r.state
    events.push(...r.events)
  }
  return { state: s, events }
}

export interface PhaseEnd extends Stepped { result: GameResult | null }

/**
 * INIT-013 for Ranged, Physical and Heat: (a) remove doomed units, (b) consciousness checks, (c) PSR queue,
 * (d) checks for pilots hurt by falls, (e) crippled/withdrawal refresh and the victory check. If a result is found the
 * game is ended in the returned state (phase 'ended').
 */
export function endOfPhaseSteps(state: GameState, data?: DataBundle): PhaseEnd {
  const d = data ?? bundleFor(state)
  let s = state
  const events: GameEvent[] = []
  const push = (r: Stepped): void => { s = r.state; events.push(...r.events) }
  push(applyDoomed(s))
  push(consciousnessChecks(s))
  push(resolvePsrs(s, { when: ['endOfPhase', 'endOfMove', 'now'] }))
  push(consciousnessChecks(s))
  push(applyDoomed(s)) // a fall can kill (pilot dead from seatbelt hits)
  push(refreshStatus(s, d))
  const result = checkVictory(s, {}, d)
  if (result) push(endGame(s, result))
  return { state: s, events, result }
}

/** The whole Heat Phase: HEAT-030 per unit, then the end-of-phase steps. */
export function runHeatPhase(state: GameState, data?: DataBundle): PhaseEnd {
  const a = heatApply({ ...state, step: 'heat.apply' })
  const b = endOfPhaseSteps({ ...a.state, step: 'heat.endOfPhase' }, data)
  return { state: b.state, events: [...a.events, ...b.events], result: b.result }
}
