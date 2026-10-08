// End screen view model (50 §15): cause, per-side damage, 'Mechs destroyed / crippled, heat peak, and a mini record sheet per 'Mech
// (damage taken per location, kills, heat peak). Tallies come from the store's event-number totals (useGameStats / useUnitTallies);
// the location maxima and lost locations come from the engine's sheet query.
import { crippledReason } from './format'
import type { GameState, Loc, PlayerId, SheetView } from '../../engine/index'
import { endCause, sideName, STATUS_LABELS, type SideStats, type UnitTally } from '../contract'

export interface MiniCell { loc: Loc; damage: number; max: number; frac: number; destroyed: boolean }
export interface UnitResult {
  id: string; name: string; owner: PlayerId; status: string; fate: 'destroyed' | 'crippled' | 'withdrawn' | 'standing'
  taken: number; dealt: number; kills: number; heatPeak: number; cells: MiniCell[]
}
export interface SideResult { player: PlayerId; name: string; winner: boolean; dealt: number; taken: number; destroyed: number; crippled: number; withdrawn: number; heatPeak: number; units: UnitResult[] }
export interface OverView { headline: string; cause: string; turn: number; sides: SideResult[] }

export const MINI_LOCS: Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']

/** Damage taken per location over what that location could take (armor + rear armor + structure at the start; the sheet shows what is left, so we add the damage back). */
export function miniCells(tally: UnitTally | undefined, sheet: SheetView | null): MiniCell[] {
  return MINI_LOCS.map((loc): MiniCell => {
    const damage = tally?.byLoc[loc] ?? 0
    const l = sheet?.locations[loc]
    const max = l ? l.maxArmor + (l.maxRear ?? 0) + l.maxStructure : 0
    return { loc, damage, max, frac: max > 0 ? Math.min(1, damage / max) : 0, destroyed: l?.destroyed ?? false }
  })
}

export function buildOver(
  state: GameState, result: NonNullable<GameState['result']>, stats: Record<PlayerId, SideStats>,
  tallies: Record<string, UnitTally> = {}, sheetOf: (id: string) => SheetView | null = () => null,
): OverView {
  const sides = (['A', 'B'] as PlayerId[]).map((player): SideResult => {
    const mine = Object.values(state.units).filter((u) => u.owner === player)
    const units = mine.map((u): UnitResult => {
      const t = tallies[u.id]
      const cells = miniCells(t, sheetOf(u.id))
      const fate: UnitResult['fate'] = u.status === 'destroyed' ? 'destroyed' : u.status === 'withdrawn' || u.status === 'surrendered' ? 'withdrawn' : u.crippled ? 'crippled' : 'standing'
      return {
        id: u.id, name: u.name, owner: player, status: u.status === 'active' && u.crippled ? `crippled: ${crippledReason(u)}` : STATUS_LABELS[u.status], fate,
        taken: t?.taken ?? 0, dealt: t?.dealt ?? 0, kills: t?.kills ?? 0, heatPeak: t?.heatPeak ?? 0, cells,
      }
    })
    return {
      player, name: sideName(state, player), winner: result.winner === player, dealt: stats[player].damageDealt, taken: stats[player].damageTaken,
      destroyed: mine.filter((u) => u.status === 'destroyed').length, crippled: mine.filter((u) => u.crippled && u.status !== 'destroyed').length,
      withdrawn: mine.filter((u) => u.status === 'withdrawn' || u.status === 'surrendered').length, heatPeak: stats[player].heatPeak, units,
    }
  })
  const cause = result.winner ? `Won by ${endCause(result.reason)}.` : result.reason === 'draw' ? 'Ended in a draw.' : `Ended in a draw: ${endCause(result.reason)}.`
  return { headline: result.winner ? `${sideName(state, result.winner)} wins` : 'A draw', cause, turn: result.turn, sides }
}
