// End screen view model (50 §15): cause, per-side damage, 'Mechs destroyed / crippled, heat peak. Tallies come from the store's
// event-number totals (useGameStats) and the final unit states.
import type { GameState, PlayerId } from '../../engine/index'
import { endCause, sideName, type SideStats } from '../contract'

export interface SideResult { player: PlayerId; name: string; winner: boolean; dealt: number; taken: number; destroyed: number; crippled: number; withdrawn: number; heatPeak: number }
export interface OverView { headline: string; cause: string; turn: number; sides: SideResult[] }

export function buildOver(state: GameState, result: NonNullable<GameState['result']>, stats: Record<PlayerId, SideStats>): OverView {
  const sides = (['A', 'B'] as PlayerId[]).map((player): SideResult => {
    const mine = Object.values(state.units).filter((u) => u.owner === player)
    return {
      player, name: sideName(state, player), winner: result.winner === player, dealt: stats[player].damageDealt, taken: stats[player].damageTaken,
      destroyed: mine.filter((u) => u.status === 'destroyed').length, crippled: mine.filter((u) => u.crippled && u.status !== 'destroyed').length,
      withdrawn: mine.filter((u) => u.status === 'withdrawn' || u.status === 'surrendered').length, heatPeak: stats[player].heatPeak,
    }
  })
  const cause = result.winner ? `Won by ${endCause(result.reason)}.` : `Ended in a draw: ${endCause(result.reason)}.`
  return { headline: result.winner ? `${sideName(state, result.winner)} wins` : 'A draw', cause, turn: result.turn, sides }
}
