// Tuning constants for the utility AI, set from `npm run bench:ai` sweeps (seeds 1-16, normal vs random / easy).
// AI_TUNE (a JSON object in the environment; node only, absent in the browser) overrides them for bench experiments.
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
  /** Optional overrides used by experiments: threat λ and the soft heat cost scale. */
  lambda?: number
  heatW?: number
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
  rearW: 0.6,
  approach: 0.5,
  approachFar: 4,
  wT: 0.9,
  ...fromEnv(),
}
