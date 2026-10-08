// Event feed view model (50 §13): one row per meaningful happening, with an expandable breakdown (to-hit math, location roll,
// armor / internal before -> after, transfers, crits, heat). Every number comes from the events; nothing is recomputed.
import type { DiceRolled, Facing, GameEvent, GameState, Hex, LocalId, Loc, UnitId } from '../../engine/index'
import {
  CRIT_EFFECT_LABELS, DESTROY_CAUSE_LABELS, LOC_LABELS, LOC_SHORT, PSR_REASON_LABELS, narrate, unitName,
} from '../contract'
import type { FeedEntryLike } from '../dice/diceView'
import { crippledReason, modPhrases, targetHexes } from './format'

export type FeedTone = 'hit' | 'miss' | 'damage' | 'crit' | 'death' | 'flow' | 'heat' | 'info'
export interface FeedRow { seq: number; tone: FeedTone; text: string; detail: string[]; turn?: number }

export interface FeedOptions {
  /** Weapon name for a mount (display only); defaults to the mount id. */
  weaponName?: (unitId: UnitId, mountId: LocalId) => string | null
}

interface Open { kind: 'attack' | 'crit' | 'psr'; row: FeedRow; head: string; parts: string[]; unitId: UnitId; attackId?: string; crits?: number; slots?: number; noEffect?: boolean }

const locName = (l: Loc, rear = false): string => `${LOC_SHORT[l]}${rear ? '-R' : ''}`
const dice = (e: DiceRolled): string => (e.dice.length > 1 ? `${e.total} (${e.dice.join('+')}${e.mods?.length ? ' plus modifiers' : ''})` : String(e.total))

/** Build the feed rows for the events shown so far (newest last). */
export function buildFeed(state: GameState | null, feed: readonly (FeedEntryLike & { turn?: number })[], opts: FeedOptions = {}): FeedRow[] {
  const rows: FeedRow[] = []
  const n = (id: UnitId | null | undefined): string => unitName(state, id)
  const rolls = new Map<string, DiceRolled>() // attackId -> its to-hit roll
  let open: Open | null = null
  // the attack row stays the home of its damage groups until AttackEnded, even after a crit check took over `open`
  let atk: Open | null = null
  const droppedProne = new Set<UnitId>()
  // where each unit stood, from the events themselves: a past row must never be rebuilt from the unit's current position
  const places = new Map<UnitId, { hex: Hex; facing: Facing }>()
  const failedStand = new Set<UnitId>()
  const destroyed = new Set<UnitId>()
  const crippledSeen = new Set<UnitId>()
  const placeOf = (id: UnitId): { hex: Hex; facing: Facing } | undefined => places.get(id)
  const push = (row: FeedRow): FeedRow => { rows.push(row); return row }
  const refresh = (o: Open): void => { o.row.text = o.parts.length ? `${o.head} · ${o.parts.join(' · ')}` : o.head }
  const close = (): void => { open = null; atk = null }

  for (const { seq, event: ev, turn } of feed) {
    const t = turn !== undefined ? { turn } : {}
    switch (ev.type) {
      case 'UnitStepped': case 'UnitJumped': if (ev.type === 'UnitStepped' && ev.op === 'dropProne') droppedProne.add(ev.unitId); places.set(ev.unitId, { hex: ev.to, facing: ev.facing }); failedStand.delete(ev.unitId); break
      default: break
    }
    switch (ev.type) {
      case 'DiceRolled': {
        if (ev.attackId && (ev.purpose === 'toHit' || ev.purpose === 'physicalToHit')) rolls.set(ev.attackId, ev)
        if (ev.purpose === 'shutdownAvoid' || ev.purpose === 'startup' || ev.purpose === 'ammoExplosionAvoid') {
          const word = ev.purpose === 'shutdownAvoid' ? 'shutdown check' : ev.purpose === 'startup' ? 'restart roll' : 'ammunition explosion check'
          const ok = ev.success ?? (ev.target !== undefined ? ev.total >= ev.target : null)
          const verdict = ev.purpose === 'shutdownAvoid' ? (ok ? 'avoided' : 'shuts down') : ev.purpose === 'startup' ? (ok ? 'restarts' : 'stays down') : (ok ? 'avoided' : 'explodes')
          close()
          push({ seq, tone: ok === false && ev.purpose !== 'startup' ? 'crit' : 'info', text: `${n(ev.unitId)} ${word}: ${ev.target !== undefined ? `TN ${ev.target} ` : ''}rolled ${ev.total} ${verdict}`, detail: [`Dice ${dice(ev)}`], ...t })
        }
        break
      }
      case 'AttackRolled': {
        const roll = rolls.get(ev.attackId)
        const weapon = ev.mountId ? opts.weaponName?.(ev.attackerId, ev.mountId) ?? ev.mountId : ev.kind
        const noTn = !!ev.auto || ev.tn <= 0
        const head = `${n(ev.attackerId)} → ${ev.targetId ? n(ev.targetId) : 'empty hex'}: ${weapon} ${ev.auto ? `automatic ${ev.auto}` : `${noTn ? '' : `TN ${ev.tn} `}rolled ${ev.roll}`} ${ev.hit ? 'HIT' : 'MISS'}`
        const detail: string[] = []
        if (roll?.mods?.length) detail.push(`To hit: TN ${ev.tn} = ${modPhrases(roll.mods, { targetHexes: targetHexes(state, ev.targetId) }).join(', ')}`)
        else detail.push(`To hit: TN ${ev.tn}`)
        if (ev.roll !== null) detail.push(`Rolled ${roll ? dice(roll) : ev.roll} against ${ev.tn}: ${ev.hit ? 'hit' : 'miss'}`)
        const row = push({ seq, tone: ev.hit ? 'hit' : 'miss', text: head, detail, ...t })
        open = { kind: 'attack', row, head, parts: [], unitId: ev.attackerId, attackId: ev.attackId }
        atk = open
        break
      }
      case 'AimedShotResolved':
        if (open?.kind === 'attack') open.row.detail.push(ev.onTarget ? `Aimed shot found the ${LOC_LABELS[ev.aimedAt]}` : 'Aimed shot drifted: normal location roll')
        break
      case 'ClusterResolved': {
        if (open?.kind === 'attack') {
          open.row.detail.push(`Cluster roll ${ev.roll}${ev.modified !== ev.roll ? ` (${ev.modified} with modifiers)` : ''}: ${ev.hits} of ${ev.rackSize} hit, damage groups ${ev.groups.join('+') || 'none'}`)
          open.parts.push(`${ev.hits} of ${ev.rackSize} hit`)
          refresh(open)
        } else push({ seq, tone: 'info', text: `Cluster: ${ev.hits} of ${ev.rackSize} hit`, detail: [`Roll ${ev.roll}, groups ${ev.groups.join('+')}`], ...t })
        break
      }
      case 'HitLocated': {
        const line = `Location roll ${ev.roll} (${ev.table} table, ${ev.direction === 'front' ? 'from the front' : ev.direction === 'rear' ? 'from behind' : `from the ${ev.direction}`}): ${locName(ev.location, ev.side === 'rear')} for ${ev.damage}${ev.tac ? ' · possible critical' : ''}`
        if (open) open.row.detail.push(line)
        break
      }
      case 'HitAbsorbedByCover':
        if (open) { open.row.detail.push(`Partial cover absorbed ${ev.damage} damage to the ${LOC_LABELS[ev.location]}`); open.parts.push('cover absorbed it'); refresh(open) }
        break
      case 'DamageApplied': {
        const bits: string[] = []
        const where = locName(ev.location, ev.side === 'rear')
        if (ev.armorBefore !== ev.armorAfter) bits.push(`${where} ${ev.armorBefore}→${ev.armorAfter} armor`)
        if (ev.structureBefore !== ev.structureAfter) bits.push(`${where} internal ${ev.structureBefore}→${ev.structureAfter}`)
        const line = `${n(ev.unitId)}: ${ev.damage} damage to ${where}: armor ${ev.armorBefore}→${ev.armorAfter}, internal ${ev.structureBefore}→${ev.structureAfter}${ev.lost ? `, ${ev.lost} lost` : ''}${ev.reduced ? ` (ferro-lamellor stopped ${ev.reduced})` : ''}`
        const xfer = ev.transferredTo ? `${ev.structureAfter === 0 ? `${locName(ev.location)} destroyed, ` : ''}${ev.transferred} transfers to ${locName(ev.transferredTo)}` : null
        if (destroyed.has(ev.unitId)) {
          // damage to a 'Mech that is already out is one short note, not a chain of transfers
          const o = (open?.kind === 'attack' ? open : atk) as Open | null
          if (o && o.kind === 'attack') { o.row.detail.push(line); if (!o.noEffect) { o.noEffect = true; o.parts.push('(no effect: already destroyed)'); refresh(o) } } else push({ seq, tone: 'damage', text: `${n(ev.unitId)} takes ${ev.damage} more (no effect: already destroyed)`, detail: [line], ...t })
          break
        }
        let target = open && ((open.kind === 'attack' && (ev.source === 'weapon' || ev.source === 'physical')) || (open.kind === 'crit' && (ev.source === 'ammoExplosion' || ev.source === 'componentExplosion')) || (open.kind === 'psr' && (ev.source === 'fall' || ev.source === 'fallFromAbove'))) ? open : null
        // a crit check took over `open`: later damage groups of the same cluster still belong to the attack row
        if (!target && atk && (ev.source === 'weapon' || ev.source === 'physical')) target = atk
        if (ev.reduced) bits.push(`ferro-lamellor stopped ${ev.reduced}`)
        if (target) {
          target.row.detail.push(line)
          if (xfer) target.row.detail.push(xfer)
          target.parts.push(...bits, ...(xfer ? [xfer] : []))
          if (target.kind === 'attack') target.row.tone = 'damage'
          refresh(target)
        } else {
          push({ seq, tone: 'damage', text: `${n(ev.unitId)} takes ${ev.damage}: ${[...bits, ...(xfer ? [xfer] : [])].join(' · ') || 'armor held, nothing lost'}`, detail: [line, ...(xfer ? [xfer] : [])], ...t })
        }
        break
      }
      case 'LocationDestroyed': {
        const line = `${n(ev.unitId)} loses its ${LOC_LABELS[ev.location]}${ev.cause === 'blownOff' ? ' (blown off)' : ev.cause === 'sideTorso' ? ' (side torso gone)' : ''}`
        if (open) { open.row.detail.push(line); open.parts.push(`${locName(ev.location)} destroyed`); open.row.tone = 'death'; refresh(open) } else push({ seq, tone: 'death', text: line, detail: [], ...t })
        break
      }
      case 'CritCheckRolled': {
        const head = `Crit check ${locName(ev.appliesTo ?? ev.location)}: rolled ${ev.roll} → ${ev.blownOff ? 'limb blown off' : ev.crits === 0 ? 'no crit' : ev.crits === 1 ? '1 crit' : `${ev.crits} crits`}`
        const row = push({ seq, tone: ev.crits > 0 || ev.blownOff ? 'crit' : 'info', text: head, detail: [`Cause: ${ev.why === 'structure' ? 'internal structure damaged' : ev.why === 'tac' ? 'through-armor critical' : ev.why === 'explosive' ? 'explosive component' : 'MASC'}`], ...t })
        open = { kind: 'crit', row, head, parts: [], unitId: ev.unitId, crits: ev.blownOff ? 0 : ev.crits, slots: 0 }
        break
      }
      case 'CritLost':
        if (open?.kind === 'crit') { open.row.detail.push(`${ev.count} critical hit${ev.count > 1 ? 's' : ''} found nothing to break`) }
        break
      case 'CritSlotHit': {
        const line = `Slot ${ev.index + 1} in the ${LOC_LABELS[ev.location]}: ${ev.itemName ?? ev.token} (${CRIT_EFFECT_LABELS[ev.effect]})`
        const o = open as Open | null
        if (o?.kind === 'crit' && o.crits !== undefined && (o.slots ?? 0) >= o.crits) {
          // more slots than the check allowed: they were lost with a destroyed side torso, not rolled
          const lost = o.row.detail.findIndex((d) => d.startsWith('Slots lost with'))
          const msg = `${ev.itemName ?? ev.token}: ${CRIT_EFFECT_LABELS[ev.effect]}`
          if (lost >= 0) { o.row.detail[lost] += `; ${msg}` } else {
            const row2 = push({ seq, tone: 'crit', text: `${locName(ev.location)} destroyed: ${ev.effect === 'engine' ? 'the engine loses its side-torso slots' : 'its slots are lost'} (${CRIT_EFFECT_LABELS[ev.effect]})`, detail: [`Slots lost with the ${LOC_LABELS[ev.location]}: ${msg}`], ...t })
            open = { kind: 'crit', row: row2, head: row2.text, parts: [], unitId: ev.unitId, crits: 0, slots: 0 }
          }
          break
        }
        if (o) o.slots = (o.slots ?? 0) + 1
        if (open?.kind === 'crit') { open.row.detail.push(line); open.parts.push(`slot ${ev.index + 1}: ${ev.itemName ?? ev.token}`); if (ev.effect !== 'none' && ev.effect !== 'emptyBin') open.parts.push(CRIT_EFFECT_LABELS[ev.effect]); refresh(open) }
        else push({ seq, tone: 'crit', text: `Critical on ${n(ev.unitId)}: ${ev.itemName ?? ev.token} (${CRIT_EFFECT_LABELS[ev.effect]})`, detail: [line], ...t })
        break
      }
      case 'AmmoExploded': {
        const line = `${n(ev.unitId)}'s ammunition explodes in the ${LOC_LABELS[ev.location]}: ${ev.damage} damage${ev.capped ? ' (capped)' : ''}`
        if (open?.kind === 'crit') { open.row.detail.push(line); open.parts.push(`ammo explodes for ${ev.damage}`); open.row.tone = 'death'; refresh(open) }
        else push({ seq, tone: 'death', text: `${n(ev.unitId)} ammunition explodes (${ev.cause === 'heat' ? 'heat' : 'critical hit'}): ${ev.damage} damage`, detail: [line], ...t })
        break
      }
      case 'ComponentExploded':
        if (open?.kind === 'crit') { open.row.detail.push(`${n(ev.unitId)}: a component explodes for ${ev.damage}`); open.parts.push(`explodes for ${ev.damage}`); refresh(open) }
        else push({ seq, tone: 'death', text: `${n(ev.unitId)}: a component explodes for ${ev.damage}`, detail: [], ...t })
        break
      case 'PilotHit': {
        const line = `${n(ev.unitId)}'s pilot is hurt: ${ev.total} hit${ev.total === 1 ? '' : 's'} (${ev.cause})`
        if (open) { open.row.detail.push(line); open.parts.push(`pilot hit (${ev.total})`); refresh(open) } else push({ seq, tone: 'damage', text: line, detail: [], ...t })
        break
      }
      case 'AttackEnded':
        if (atk && atk.attackId === ev.attackId) { atk.row.detail.push(`Damage dealt: ${ev.damageDealt}`) }
        close()
        break
      case 'PsrResolved': {
        const mods = modPhrases(ev.mods)
        const head = `${n(ev.unitId)} PSR (${PSR_REASON_LABELS[ev.reason]}): ${ev.auto ? 'automatic fall' : `TN ${ev.tn} rolled ${ev.roll}`} ${ev.success ? 'PASS' : 'FAIL'}`
        const row = push({ seq, tone: ev.success ? 'info' : 'crit', text: head, detail: [mods.length ? `TN ${ev.tn} = ${mods.join(', ')}` : `TN ${ev.tn}`], ...t })
        open = ev.success ? null : { kind: 'psr', row, head, parts: [], unitId: ev.unitId }
        break
      }
      case 'UnitFell': {
        const line = `${n(ev.unitId)} falls${ev.levels ? ` ${ev.levels} level${ev.levels > 1 ? 's' : ''}` : ''}${ev.inWater ? ' into water' : ''}: ${ev.damage} damage`
        if (open?.kind === 'psr') { open.row.detail.push(line); open.parts.push(`falls, ${ev.damage} damage`); open.row.tone = 'crit'; refresh(open) } else push({ seq, tone: 'crit', text: line, detail: [], ...t })
        break
      }
      case 'ConsciousnessChecked': {
        close()
        push({ seq, tone: ev.conscious ? 'info' : 'crit', text: `${n(ev.unitId)} pilot consciousness (${ev.hits} hit${ev.hits === 1 ? '' : 's'}): TN ${ev.tn} rolled ${ev.roll} ${ev.conscious ? 'stays awake' : 'blacks out'}`, detail: [], ...t })
        break
      }
      case 'PilotRecovered': push({ seq, tone: 'info', text: `${n(ev.unitId)} pilot recovery: TN ${ev.tn} rolled ${ev.roll} ${ev.recovered ? 'wakes up' : 'still out'}`, detail: [], ...t }); break
      case 'HeatApplied': {
        close()
        const delta = ev.after - ev.before
        push({
          seq, tone: 'heat', text: `Heat: ${n(ev.unitId)} ${ev.before} → ${ev.after} (${delta >= 0 ? '+' : '−'}${Math.abs(delta)})`,
          detail: [`${ev.before} + ${ev.generated} generated − ${ev.dissipated} dissipated = ${ev.after}`, ...ev.entries.map((e) => `+${e.amount} ${e.source}${e.ref ? ` (${e.ref})` : ''}`)], ...t,
        })
        break
      }
      case 'UnitDestroyed': {
        const line = `${n(ev.unitId)} is destroyed: ${DESTROY_CAUSE_LABELS[ev.cause]}${ev.effective ? '' : ' (falls at the end of the phase)'}`
        destroyed.add(ev.unitId)
        if (open) { open.row.detail.push(line); if (!open.parts.includes('DESTROYED')) open.parts.push('DESTROYED'); open.row.tone = 'death'; refresh(open) } else push({ seq, tone: 'death', text: line, detail: [], ...t })
        break
      }
      case 'MoveEnded': {
        close()
        const at = placeOf(ev.unitId)
        const stayedDown = failedStand.has(ev.unitId) && ev.hexesMoved === 0
        failedStand.delete(ev.unitId)
        const dropped = droppedProne.has(ev.unitId)
        droppedProne.delete(ev.unitId)
        const text = narrate(state, ev, { ...(at ? { hex: at.hex, facing: at.facing } : {}), stayedDown, droppedProne: dropped })
        push({ seq, tone: 'flow', text: text ?? `${n(ev.unitId)} moved`, detail: [`${ev.hexesMoved} hexes moved, ${ev.mpSpent} MP spent`, `Attackers aiming at it get ${ev.tmm >= 0 ? '+' : '−'}${Math.abs(ev.tmm)}; its own shots get ${ev.attackerMod >= 0 ? '+' : '−'}${Math.abs(ev.attackerMod)}`], ...t })
        break
      }
      case 'StatusChanged': {
        const u = state?.units[ev.unitId]
        if (ev.crippled && !crippledSeen.has(ev.unitId)) {
          crippledSeen.add(ev.unitId)
          close()
          push({ seq, tone: 'death', text: `${n(ev.unitId)} is crippled${u ? `: ${crippledReason(u)}` : ''} and counts as out of the fight`, detail: [], ...t })
        }
        break
      }
      case 'TurnStarted': case 'PhaseStarted': case 'InitiativeResolved': case 'UnitDeployed': case 'UnitEntered': case 'StandAttempted':
      case 'TorsoTwisted': case 'FireDeclared': case 'PhysicalDeclared': case 'PhysicalDeclaredInMove': case 'UnitDisplaced': case 'UnitShutdown':
      case 'UnitRestarted': case 'UnitExited': case 'PilotKilled': case 'GameEnded': {
        close()
        if (ev.type === 'UnitDeployed' || ev.type === 'UnitEntered') places.set(ev.unitId, { hex: ev.hex, facing: ev.facing })
        else if (ev.type === 'UnitDisplaced') { const old = places.get(ev.unitId); if (old) places.set(ev.unitId, { ...old, hex: ev.to }) }
        else if (ev.type === 'StandAttempted') { const old = places.get(ev.unitId); if (old) places.set(ev.unitId, { ...old, facing: ev.facing }); if (ev.success) failedStand.delete(ev.unitId); else failedStand.add(ev.unitId) }
        const text = narrate(state, ev)
        if (text) push({ seq, tone: ev.type === 'PilotKilled' || ev.type === 'GameEnded' ? 'death' : ev.type === 'UnitShutdown' ? 'heat' : 'flow', text, detail: [], ...t })
        break
      }
      default:
        break
    }
  }
  return rows
}

/** Keep the newest rows within a ceiling, for rendering. */
export const lastRows = (rows: FeedRow[], max = 160): FeedRow[] => (rows.length > max ? rows.slice(rows.length - max) : rows)

export type { GameEvent }
