// Tuning constants for the utility AI, set from `npm run bench:ai` sweeps (seeds 1-16, normal vs random / easy).
// TUNE is the base set (easy uses it as is); TUNE_NORMAL layers the normal tier's overrides on top. AI_TUNE (a JSON object in
// the environment; node only, absent in the browser) overrides the normal tier only, so bench sweeps never move the easy bot.
export interface Tune {
  /** Flat part of FALL_COST (40-ai §3.7 says 10): pilot-hit risk and the tempo lost standing up. 30 won ~4% more games. */
  fallTempo: number
  /** Weight on the piloting-roll risk of a movement path. */
  psrW: number
  /** Position bonus for ending in light / heavy woods (beyond the to-hit effect the previews already price). */
  woodsL: number
  woodsH: number
  /** Position bonus per point of our TMM (future turns; this turn's TMM is in the threat previews). */
  tmmW: number
  /** Penalty per point of firepower of an enemy that sees our rear arc from where it stands. */
  rearW: number
  /** Approach weight per hex off the preferred range, and its multiplier when nothing is in reach. */
  approach: number
  approachFar: number
  /** Normal tier's weight on damage taken (the tier table's wT). */
  wT: number
  /** Position bonus per level of height advantage over the nearest enemy (normal; hills on Sodden Hills / Arid Canyons). */
  heightW: number
  /** Bonus per point of a friend's firepower within 3 hexes, capped (normal: lance cohesion, mutual support). */
  supportW: number
  /** Withdrawing units: weight per hex of distance to the home edge. */
  withdrawW: number
  /** Optional overrides used by experiments: threat λ and the soft heat cost scale. */
  lambda?: number
  heatW?: number
  /** Normal tier's default end-of-turn heat cap (the tier table's heatCap). */
  heatCap?: number
}

function fromEnv(): Partial<Tune> {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.AI_TUNE
  if (!raw) return {}
  try { return JSON.parse(raw) as Partial<Tune> } catch { return {} }
}

export const TUNE: Tune = {
  fallTempo: 30,
  psrW: 1.5,
  woodsL: 1.0,
  woodsH: 1.8,
  tmmW: 0.5,
  rearW: 1.0,
  approach: 0.5,
  approachFar: 4,
  wT: 0.9,
  heightW: 0,
  supportW: 0,
  withdrawW: 3,
}

/**
 * Normal tier: weighs damage taken more (wT 1.3) and accepts end heat up to 13 (+2 to-hit, -2 MP, still no shutdown roll);
 * the soft heat cost still prices every threshold. Bench (intro, 80 games over seeds 1 and 7): 54 -> 67 wins against easy.
 */
export const TUNE_NORMAL: Tune = {
  ...TUNE,
  wT: 1.3,
  heatCap: 13,
  ...fromEnv(),
}
