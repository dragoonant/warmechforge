// Generic prompt view model (50 §8) for the decisions that have no panel of their own: initiative acknowledgement, picking the
// next 'Mech, choosing ammunition, power choices and engine `choice` decisions. Actor first, then the numbers; every option is an
// engine-provided action (legal list, pending.options), never composed here.
import type { Action, GameState, PendingDecision, PlayerId, UnitId } from '../../engine/index'
import { PHASE_LABELS, engineDescribe, formatOdds, sideName, unitName } from '../contract'

export interface PromptOption {
  id: string
  label: string
  note?: string
  tone?: 'primary' | 'quiet'
  action: Action
  hoverUnitId?: UnitId
}
export interface PromptView {
  kind: PendingDecision['kind']
  testid: string
  title: string
  lines: string[]
  options: PromptOption[]
  canPass: boolean
  passLabel: string
  /** Option answered by Enter, when there is a clear default. */
  defaultId: string | null
}

const VERB: Record<string, string> = { movement: 'move', rangedAttack: 'fire', physicalAttack: 'attack physically', deployment: 'deploy' }

export const isLegalAction = (legal: readonly Action[], a: Action): boolean => legal.some((x) => JSON.stringify(x) === JSON.stringify(a))

/** "Eris Lance lost the initiative 6 to 9" for the side that has to decide. */
export function initiativeClause(state: GameState, player: PlayerId): string | null {
  const init = state.initiative
  if (!init) return null
  const mine = init.totals[player], theirs = init.totals[player === 'A' ? 'B' : 'A']
  return `${sideName(state, player)} ${init.winner === player ? 'won' : 'lost'} initiative ${mine} to ${theirs}`
}

function unitNote(state: GameState, id: UnitId): string | undefined {
  const u = state.units[id]
  if (!u) return undefined
  const bits: string[] = []
  if (u.prone) bits.push('prone')
  if (u.shutdown) bits.push('shut down')
  if (!u.pilot.conscious) bits.push('pilot unconscious')
  if (u.crippled) bits.push('crippled')
  if (u.heat > 0) bits.push(`heat ${u.heat}`)
  return bits.length ? bits.join(', ') : undefined
}

export function buildPromptView(state: GameState, pd: PendingDecision, legal: readonly Action[], opts: { ammoName?: (unitId: UnitId, binId: string) => string | null; weaponName?: (unitId: UnitId, mountId: string) => string | null } = {}): PromptView {
  const text = engineDescribe.decision(state, pd)
  const base = { kind: pd.kind, testid: `prompt-${pd.kind}`, canPass: pd.canPass, passLabel: 'Pass', defaultId: null as string | null }
  switch (pd.kind) {
    case 'initiativeAck': {
      const ack = legal.find((a) => a.type === 'ack')
      return { ...base, title: text.title, lines: text.lines, options: ack ? [{ id: 'ack', label: 'Continue', tone: 'primary', action: ack }] : [], defaultId: ack ? 'ack' : null }
    }
    case 'selectUnit': {
      const eligible = pd.context.eligible ?? []
      const count = pd.context.count ?? 1
      const verb = VERB[pd.phase] ?? 'act'
      const init = initiativeClause(state, pd.player)
      const options = eligible.flatMap((id): PromptOption[] => {
        const a = legal.find((x) => x.type === 'selectUnit' && x.unitId === id)
        const note = unitNote(state, id)
        return a ? [{ id, label: unitName(state, id), ...(note ? { note } : {}), action: a, hoverUnitId: id }] : []
      })
      return {
        ...base, testid: 'prompt-selectUnit', title: `${sideName(state, pd.player)}: pick ${count === 1 ? '1' : count} of ${eligible.length} 'Mech${eligible.length === 1 ? '' : 's'} to ${verb}${init ? ` (${init})` : ''}`,
        lines: [`${PHASE_LABELS[pd.phase]}. You can also click a 'Mech on the board or in the roster.`], options, defaultId: options.length === 1 ? options[0]!.id : null,
      }
    }
    case 'chooseAmmo': {
      const unit = pd.unitId
      const bins = pd.context.bins ?? []
      const options = bins.flatMap((b): PromptOption[] => {
        const a = legal.find((x) => x.type === 'chooseAmmo' && x.binId === b.binId)
        const name = (unit ? opts.ammoName?.(unit, b.binId) : null) ?? b.ammo
        return a ? [{ id: b.binId, label: name, note: `${b.shots} shot${b.shots === 1 ? '' : 's'} left`, action: a }] : []
      })
      const mount = legal.find((x): x is Extract<Action, { type: 'chooseAmmo' }> => x.type === 'chooseAmmo')?.mountId
      const weapon = (unit && mount ? opts.weaponName?.(unit, mount) : null) ?? 'this weapon'
      return { ...base, title: `${unitName(state, pd.unitId)}: which ammunition should ${weapon} fire?`, lines: ['It can use more than one kind of ammunition; pick the bin to load for this shot.'], options, defaultId: options[0]?.id ?? null }
    }
    case 'powerChoice': {
      const lines = (pd.context.power ?? []).map((e) => `${unitName(state, e.unitId)}: ${e.options.join(' or ')}${e.avoidTn ? ` (restart roll ${e.avoidTn}+)` : ''}`)
      const options = legal.filter((a) => a.type === 'powerChoice').map((a, i): PromptOption => ({ id: `power-${i}`, label: engineDescribe.action(state, a), action: a }))
      return { ...base, title: `${sideName(state, pd.player)}: power check`, lines, options, defaultId: options[0]?.id ?? null }
    }
    case 'choice': {
      const options = (pd.options ?? []).map((o): PromptOption => ({ id: o.id, label: o.label, ...(o.p !== undefined ? { note: formatOdds(o.p) } : {}), action: o.action }))
      return { ...base, title: text.prompt, lines: text.lines.filter((l) => !options.some((o) => o.label === l)), options, defaultId: options[0]?.id ?? null }
    }
    case 'gameOver':
      return { ...base, title: text.prompt, lines: [], options: [], canPass: false }
    default: {
      const options = legal.slice(0, 8).map((a, i): PromptOption => ({ id: `a${i}`, label: engineDescribe.action(state, a), action: a }))
      return { ...base, title: text.prompt, lines: text.lines, options, defaultId: null }
    }
  }
}

/** Prompt kinds that have their own panel and never use the generic dock. */
export const PANEL_KINDS: ReadonlySet<PendingDecision['kind']> = new Set(['move', 'standUp', 'deploy', 'torsoTwist', 'declareFire', 'declarePhysical'])
