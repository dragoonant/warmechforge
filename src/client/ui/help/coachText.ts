// The coach line (contextual "what do I do now" sentence). Pure: the open decision in, one sentence out, our words.
// Numbers come from the decision itself (never computed here).
import type { PendingDecision } from '../../../engine/index'

export const COACH_KEY = 'wmf.coach'

export type CoachDecision = Pick<PendingDecision, 'kind' | 'phase' | 'context'>

/** Memory key of a decision: one per kind, split by phase for the pick-a-unit step and by code for choices. */
export function coachKey(p: CoachDecision | null | undefined): string | null {
  if (!p) return null
  if (p.kind === 'selectUnit') return `selectUnit:${p.phase}`
  if (p.kind === 'choice') return `choice:${p.context.code ?? 'other'}`
  return p.kind
}

const CHOICE_TIPS: Record<string, string> = {
  dividedLos: 'The line of sight runs along a hex edge, so it can be traced two ways. Pick the one you want to count.',
  attackDirection: 'The shot comes in exactly along a corner between two sides. Choose which side of the target it counts as hitting.',
  dominoDodge: 'A neighbour is being shoved into your hex. You may step aside, or take the shove.',
  dfaMissMove: 'The jump attack missed. Choose where the target ends up.',
  displaceSide: "Choose which way the displaced 'Mech is moved.",
  spa: 'Your pilot has a special ability that can be used now. Use it or pass.',
}

/** The tip for an open decision, or null when there is nothing worth saying. */
export function coachTip(p: CoachDecision | null | undefined): string | null {
  if (!p) return null
  const c = p.context
  switch (p.kind) {
    case 'deploy':
      return "Place your 'Mech: click a highlighted hex in your deployment zone, then pick which way it faces."
    case 'initiativeAck':
      return 'Initiative is rolled. The side that rolled lower acts first in each step, and the winner acts last, which is the better seat. Continue when ready.'
    case 'selectUnit': {
      const left = c.count && c.count > 1 ? ` You pick ${c.count} this round.` : ''
      if (p.phase === 'movement') return `Pick which of your 'Mechs moves next: click it on the map or in the list.${left}`
      if (p.phase === 'rangedAttack') return `Pick which of your 'Mechs declares its shots next.${left}`
      if (p.phase === 'physicalAttack') return `Pick which of your 'Mechs declares its physical attack next.${left}`
      return `Pick which of your 'Mechs acts next.${left}`
    }
    case 'move':
      if (c.entry) return "This 'Mech enters from your edge of the map. Pick an entry hex and a facing, then confirm."
      if (c.mpLeft !== undefined) return `You have ${c.mpLeft} movement points left. Pick a highlighted hex and a facing, then confirm.`
      return 'Pick Walk, Run or Jump, click a highlighted hex, choose a facing, then confirm. Running covers more ground but makes you hotter and your own aim worse. Standing still is allowed.'
    case 'standUp':
      return c.psr
        ? `This 'Mech is down. Standing needs a piloting roll of ${c.psr.tn} or more on two dice (the odds are on the prompt). Fail and it falls again; you can also stay down.`
        : "This 'Mech is down. Standing costs 2 movement points and a piloting roll, and you can also stay down."
    case 'torsoTwist':
      return 'Optional: twist the torso one hexside to bring a target into your front arc. The legs do not turn. Or keep it centred.'
    case 'declareFire':
      return 'Click an enemy, tick the weapons to fire, read the target numbers and the heat total, then Fire. Hold fire if you do not want the heat.'
    case 'chooseAmmo':
      return 'Choose which ammo bin this shot draws from.'
    case 'declarePhysical':
      return 'Punch, kick or push a neighbouring enemy, or choose None. Compare the odds and the risk line first: a missed kick can topple you.'
    case 'powerChoice':
      return "Heat or damage has this 'Mech in trouble. Choose whether to stay powered, shut down to cool, or restart."
    case 'choice':
      return (c.code && CHOICE_TIPS[c.code]) || 'The game needs a choice from you. Read the options on the prompt.'
    case 'gameOver':
      return 'The battle is over. Look over the results, then play again or go back to the start screen.'
    default:
      return null
  }
}

export interface CoachMemory { off: boolean; seen: string[] }

/** Parse the stored memory defensively. */
export function parseCoach(raw: string | null): CoachMemory {
  if (!raw) return { off: false, seen: [] }
  try {
    const v = JSON.parse(raw) as Partial<CoachMemory> | null
    return { off: v?.off === true, seen: Array.isArray(v?.seen) ? v.seen.filter((s): s is string => typeof s === 'string') : [] }
  } catch { return { off: false, seen: [] } }
}

/** Show this decision's tip? */
export function shouldCoach(mem: CoachMemory, p: CoachDecision | null | undefined): boolean {
  const key = coachKey(p)
  return !!key && !mem.off && coachTip(p) !== null && !mem.seen.includes(key)
}

/** Memory after dismissing one key. */
export function dismissKey(mem: CoachMemory, key: string): CoachMemory {
  return mem.seen.includes(key) ? mem : { ...mem, seen: [...mem.seen, key] }
}
