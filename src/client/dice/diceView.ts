// Dice tray view model (50 §9). Every engine RollPurpose has a renderer (the Record type forces it and a test checks it);
// a purpose the table does not know still renders generically ("roll 7"). The target number is read from the presented STATE
// when the roll belongs to an attack the state holds (the declaration froze its TN), and falls back to the event's own
// target only when the state does not hold it. Verdict words use only numbers the events carry.
import type { DiceRolled, GameEvent, GameState, Mod, RollPurpose } from '../../engine/index'
import { LOC_SHORT, MOD_LABELS, formatMod, unitName, type ShownRoll } from '../contract'

export type Tone = 'good' | 'bad' | 'neutral'
export interface Verdict { word: string; tone: Tone }
export interface FeedEntryLike { seq: number; event: GameEvent }

export interface RollCtx {
  ev: DiceRolled
  /** Target number: from the state when it holds the attack, else the event's own. */
  target: number | null
  state: GameState | null
  /** Events shown after this roll, oldest first (the resolution that followed it). */
  after: GameEvent[]
}

const total = (c: RollCtx): Verdict => ({ word: `${c.ev.total}`, tone: 'neutral' })
const passed = (c: RollCtx): boolean | null => (c.target === null ? (c.ev.success ?? null) : c.ev.total >= c.target)
const words = (yes: string, no: string) => (c: RollCtx): Verdict => {
  const r = passed(c)
  return r === null ? total(c) : r ? { word: yes, tone: 'good' } : { word: no, tone: 'bad' }
}
function first<T extends GameEvent['type']>(c: RollCtx, type: T, pred: (e: Extract<GameEvent, { type: T }>) => boolean = () => true): Extract<GameEvent, { type: T }> | undefined {
  return c.after.find((e): e is Extract<GameEvent, { type: T }> => e.type === type && pred(e as Extract<GameEvent, { type: T }>))
}

const locationVerdict = (c: RollCtx): Verdict => {
  const h = first(c, 'HitLocated', (e) => e.unitId === c.ev.unitId && e.roll === c.ev.total)
  if (!h) return total(c)
  return { word: `${LOC_SHORT[h.location]}${h.side === 'rear' ? ' (rear)' : ''}${h.tac ? ' · possible crit' : ''}`, tone: 'neutral' }
}

/** Slot index (0-based) a critSlot roll points at: two dice name the half and the slot; one die names only the slot within a half. */
export function critSlotPointed(ev: DiceRolled): number | null {
  if (ev.dice.length >= 2) return (ev.dice[0]! <= 3 ? 0 : 6) + ev.dice[1]! - 1
  return null
}
function critSlotWhere(ev: DiceRolled, index: number): string {
  return ev.dice.length >= 2 ? `${index < 6 ? 'upper' : 'lower'} half, slot ${index + 1}` : `slot ${index + 1}`
}

/** One renderer per roll purpose. Adding a purpose to the engine fails typecheck here until it is handled. */
export const PURPOSE_RENDERERS: Record<RollPurpose, (c: RollCtx) => Verdict> = {
  initiative: (c) => {
    const init = c.state?.initiative ?? first(c, 'InitiativeResolved') ?? null
    if (!init) return total(c)
    if (c.ev.reason === init.winner && c.ev.total === init.totals[init.winner]) return { word: `${c.ev.total} wins`, tone: 'good' }
    if (c.ev.reason === init.loser && c.ev.total === init.totals[init.loser]) return { word: `${c.ev.total} loses`, tone: 'bad' }
    return { word: `${c.ev.total} tie, re-roll`, tone: 'neutral' }
  },
  toHit: words('HIT', 'MISS'),
  physicalToHit: words('HIT', 'MISS'),
  aimedShot: (c) => (c.ev.total >= (c.target ?? 4) ? { word: 'on target', tone: 'good' } : { word: 'off: roll location', tone: 'bad' }),
  cluster: (c) => {
    const k = first(c, 'ClusterResolved', (e) => e.roll === c.ev.total || e.modified === c.ev.total)
    return k ? { word: `${k.hits} of ${k.rackSize} hit`, tone: k.hits > 0 ? 'good' : 'bad' } : total(c)
  },
  hitLocation: locationVerdict,
  punchLocation: locationVerdict,
  kickLocation: locationVerdict,
  fallSide: (c) => {
    const f = first(c, 'UnitFell', (e) => e.unitId === c.ev.unitId)
    return f ? { word: f.column === 'rear' ? 'lands on its back' : 'lands face down', tone: 'neutral' } : total(c)
  },
  fallLocation: locationVerdict,
  critCheck: (c) => {
    const k = first(c, 'CritCheckRolled', (e) => e.unitId === c.ev.unitId)
    if (!k) return total(c)
    if (k.blownOff) return { word: 'limb blown off', tone: 'bad' }
    return { word: k.crits === 0 ? 'no crit' : k.crits === 1 ? '1 crit' : `${k.crits} crits`, tone: k.crits === 0 ? 'good' : 'bad' }
  },
  critSlot: (c) => {
    const same = (e: GameEvent): boolean => e.type === 'DiceRolled' && e.purpose === 'critSlot' && e.unitId === c.ev.unitId && e.reason === c.ev.reason
    // the roll that was accepted is the last slot roll before the slot hit; an earlier one pointed at a slot already hit
    let hit: Extract<GameEvent, { type: 'CritSlotHit' }> | undefined
    for (const e of c.after) {
      if (same(e)) break
      if (e.type === 'CritSlotHit' && e.unitId === c.ev.unitId && (!c.ev.reason || e.location === c.ev.reason)) { hit = e; break }
    }
    const pointed = critSlotPointed(c.ev)
    if (hit) return { word: `${critSlotWhere(c.ev, hit.index)}: ${hit.itemName ?? hit.token}`, tone: 'bad' }
    if (c.after.some(same)) return { word: pointed !== null ? `${critSlotWhere(c.ev, pointed)} already hit, roll again` : 'slot already hit, roll again', tone: 'neutral' }
    return pointed !== null ? { word: critSlotWhere(c.ev, pointed), tone: 'neutral' } : total(c)
  },
  psr: words('PASS', 'FAIL: falls'),
  seatbelt: words('pilot steady', 'pilot hurt'),
  consciousness: words('awake', 'unconscious'),
  recovery: words('recovers', 'still out'),
  shutdownAvoid: words('avoided', 'shuts down'),
  startup: words('restarts', 'stays down'),
  ammoExplosionAvoid: words('avoided', 'explodes'),
  fallFromAbove: total,
  escalatingFailure: words('holds', 'fails'),
  jam: words('clear', 'jammed'),
  sensorCheck: words('ok', 'sensors fail'),
  tieBreak: total,
}

export const TARGET_WORD: Partial<Record<RollPurpose, string>> = { toHit: 'TN', physicalToHit: 'TN' }

/** Target number: the live attack in the presented STATE when it holds this roll's attack, else the event's own. */
export function rollTarget(state: GameState | null, ev: DiceRolled): number | null {
  if (state && ev.attackId && (ev.purpose === 'toHit' || ev.purpose === 'physicalToHit')) {
    if (state.current?.attackId === ev.attackId) return state.current.tn
    const d = state.declarations.find((x) => x.attackId === ev.attackId)
    if (d) return d.tn
  }
  return ev.target ?? null
}

export interface DieFace { value: number; kept: boolean }
export interface RollView {
  rollId: string
  seq: number
  purpose: RollPurpose
  label: string
  /** "Eris → Rakshasa" when the roll names an actor and a target. */
  actors: string
  dice: DieFace[]
  mods: string[]
  total: number
  target: number | null
  targetWord: string
  verdict: Verdict
  /** A slot roll's 2d6 sum means nothing, so the tray and log leave it out. */
  hideTotal?: boolean
}

/** Which dice survived (multiset match, so equal faces are handled). */
export function keptFlags(dice: readonly number[], kept: readonly number[]): DieFace[] {
  const pool = [...kept]
  return dice.map((v) => {
    const i = pool.indexOf(v)
    if (i >= 0) { pool.splice(i, 1); return { value: v, kept: true } }
    return { value: v, kept: false }
  })
}

export const modText = (m: Mod): string => `${MOD_LABELS[m.code] ?? m.code} ${formatMod(m.value)}`

export function viewRoll(shown: Pick<ShownRoll, 'seq' | 'event' | 'label'>, state: GameState | null, feed: readonly FeedEntryLike[] = []): RollView {
  const ev = shown.event
  const after: GameEvent[] = []
  for (const f of feed) if (f.seq > shown.seq && after.length < 40) after.push(f.event)
  let target = rollTarget(state, ev)
  if (target === null) {
    // a check whose roll carries no target still gets it from its resolution event
    const r = after.find((e) => e.type === 'PsrResolved' && e.unitId === ev.unitId && e.roll === ev.total)
    if (r && r.type === 'PsrResolved') target = r.tn
  }
  const render = PURPOSE_RENDERERS[ev.purpose] ?? total
  const verdict = render({ ev, target, state, after })
  const actors = ev.unitId && ev.targetId ? `${unitName(state, ev.unitId)} → ${unitName(state, ev.targetId)}` : ev.unitId ? unitName(state, ev.unitId) : ''
  return {
    rollId: ev.rollId, seq: shown.seq, purpose: ev.purpose, label: shown.label, actors, dice: keptFlags(ev.dice, ev.kept),
    mods: (ev.mods ?? []).map(modText), total: ev.total, target, targetWord: TARGET_WORD[ev.purpose] ?? 'needs', verdict, ...(ev.purpose === 'critSlot' ? { hideTotal: true } : {}),
  }
}
