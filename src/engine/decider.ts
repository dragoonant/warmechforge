// FROZEN after M0: one interface for human, AI, random bot and replay (00 §12.5).
import type { Action } from './actions'
import type { PendingDecision, PlayerView } from './types'
import { deriveSeed, nextFloat } from './rng'

export interface Decider {
  decide(view: PlayerView, pending: PendingDecision, legal: Action[]): Promise<Action>
}
export type DeciderKind = 'human' | 'ai' | 'random' | 'replay'
export type AiTier = 'random' | 'easy' | 'normal' // 40-ai §12

/** Random bot: uniform over legalActions, seeded by (seed, decisionId) so runs reproduce. */
export function createRandomDecider(seed: string): Decider {
  return {
    async decide(_view, pending, legal) {
      if (legal.length === 0) throw new Error(`random decider: no legal actions for ${pending.id}`)
      const [f] = nextFloat(deriveSeed(seed, pending.id))
      return legal[Math.floor(f * legal.length)]!
    },
  }
}

/** Replay: answers from a recorded log in order; throws on a mismatched decision id. */
export function createReplayDecider(actions: readonly Action[]): Decider {
  let i = 0
  return {
    async decide(_view, pending) {
      const next = actions[i++]
      if (!next) throw new Error(`replay decider: log exhausted at ${pending.id}`)
      if (next.decisionId !== pending.id) throw new Error(`replay decider: expected ${pending.id}, log has ${next.decisionId}`)
      return next
    },
  }
}
