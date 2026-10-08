// Tier parameters (40-ai §12, §11). 'random' is the sensible random bot in random.ts; 'easy' and 'normal' are the utility AI.
// Heat caps follow the M4 brief: normal keeps end-of-turn heat at 9 or less unless a kill shot is likely or the unit is about
// to die, and never accepts a shutdown avoid roll of 8+ without a kill shot; easy uses a flat cap of 13 and no threat model.

export type UtilityTier = 'easy' | 'normal'

export interface TierParams {
  id: UtilityTier
  /** Weight of damage we expect to deal (wD) and take (wT) in the movement score. wT 0 = no threat model. */
  wD: number
  wT: number
  /** Approach and objective weights. */
  wA: number
  wO: number
  /** Threat aggregation: λ × max + (1 − λ) × mean over an enemy's sampled positions. */
  lambda: number
  /** Sample where unmoved enemies may end their move (normal) or use their current hex only (easy). */
  sampleEnemies: boolean
  /** Relative noise on scores (easy plays loose; normal only breaks ties). */
  noise: number
  /** Heat knapsack with primary-target search (normal) or greedy damage-per-heat (easy). */
  knapsack: boolean
  /** End-of-turn heat cap and its exceptions (H_end after the Heat Phase). */
  heatCap: number
  /** Cap when a kill shot is likely (shutdown avoid TN must stay ≤ killShotAvoidTn). */
  killShotAvoidTn: number | null
  /** Cap when the unit is about to die (shutdown avoid TN must stay below this). */
  lastStandAvoidTn: number | null
  /** pKill that counts as a likely kill shot. */
  killShotP: number
  /** P(we are destroyed this turn) that counts as "about to die". */
  dyingP: number
  /** Physical: allow charge and DFA declarations; minimum pHit for a DFA. */
  chargeDfa: boolean
  dfaMinPHit: number
  /** Candidates that get the full threat model after the fast pre-score. */
  fullScoreTop: number
}

export const TIERS: Record<UtilityTier, TierParams> = {
  easy: {
    id: 'easy', wD: 1.0, wT: 0, wA: 1.0, wO: 1.0, lambda: 0, sampleEnemies: false, noise: 0.2, knapsack: false,
    heatCap: 13, killShotAvoidTn: null, lastStandAvoidTn: null, killShotP: 0.7, dyingP: 1.1, chargeDfa: false, dfaMinPHit: 1.1,
    fullScoreTop: 0,
  },
  normal: {
    id: 'normal', wD: 1.0, wT: 0.9, wA: 1.0, wO: 1.0, lambda: 0.5, sampleEnemies: true, noise: 0.03, knapsack: true,
    heatCap: 9, killShotAvoidTn: 8, lastStandAvoidTn: 8, killShotP: 0.5, dyingP: 0.6, chargeDfa: true, dfaMinPHit: 0.6,
    fullScoreTop: 28,
  },
}

/**
 * Hard stop per decision in ms (40-ai §14: the decider checks it between stages and keeps the best answer so far). The work
 * per decision is bounded by counts (fullScoreTop, sample sizes), so the stop never triggers in normal play and decisions
 * stay deterministic for a given view and seed.
 */
export const DECISION_BUDGET_MS = 2000
