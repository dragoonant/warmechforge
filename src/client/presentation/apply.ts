// Advance a DISPLAY snapshot by one event, using only the results the event carries (positions, armor after, heat
// after, pilot hits total). No rules arithmetic: anything an event does not spell out waits for the batch-end snap to
// the true engine state (director.ts), so the presented state can lag but never disagree.
import type { GameEvent, GameState, Loc, UnitState } from '../../engine/index'

function withUnit(s: GameState, id: string, f: (u: UnitState) => UnitState): GameState {
  const u = s.units[id]
  if (!u) return s
  return { ...s, units: { ...s.units, [id]: f(u) } }
}
function withLoc(u: UnitState, loc: Loc, f: (l: UnitState['locs'][Loc]) => UnitState['locs'][Loc]): UnitState {
  return { ...u, locs: { ...u.locs, [loc]: f(u.locs[loc]) } }
}

export function applyEvent(s: GameState, ev: GameEvent): GameState {
  switch (ev.type) {
    case 'TurnStarted': return { ...s, turn: ev.turn }
    case 'PhaseStarted': return { ...s, phase: ev.phase }
    case 'InitiativeResolved': return { ...s, initiative: { winner: ev.winner, loser: ev.loser, totals: { ...ev.totals }, rerolls: ev.rerolls } }
    case 'UnitSelected': return s.selection ? { ...s, selection: { ...s.selection, activeUnit: ev.unitId } } : s
    case 'UnitDeployed':
      return withUnit(s, ev.unitId, (u) => ({ ...u, pos: ev.hex, facing: ev.facing, status: u.status === 'offBoard' ? 'active' : u.status }))
    case 'UnitEntered':
      return withUnit(s, ev.unitId, (u) => ({ ...u, pos: ev.hex, facing: ev.facing, status: u.status === 'offBoard' ? 'active' : u.status }))
    case 'UnitStepped':
      return withUnit(s, ev.unitId, (u) => ({ ...u, pos: ev.to, facing: ev.facing, prone: ev.op === 'dropProne' ? true : u.prone }))
    case 'UnitJumped':
      return withUnit(s, ev.unitId, (u) => ({ ...u, pos: ev.to, facing: ev.facing }))
    case 'StandAttempted':
      return withUnit(s, ev.unitId, (u) => ({ ...u, prone: ev.success ? false : u.prone, facing: ev.facing }))
    case 'MoveEnded':
      return withUnit(s, ev.unitId, (u) => ({ ...u, move: { ...u.move, mode: ev.mode, hexesMoved: ev.hexesMoved, jumped: ev.jumped, mpSpent: ev.mpSpent, tmm: ev.tmm, attackerMod: ev.attackerMod, done: true } }))
    case 'PhysicalDeclaredInMove':
      return withUnit(s, ev.unitId, (u) => ({ ...u, attacks: { ...u.attacks, [ev.kind]: { targetId: ev.targetId, fromHex: ev.fromHex } } }))
    case 'TorsoTwisted':
      return withUnit(s, ev.unitId, (u) => ({ ...u, attacks: { ...u.attacks, twist: ev.twist, flipped: ev.flipped } }))
    case 'TwistReset':
      return withUnit(s, ev.unitId, (u) => ({ ...u, attacks: { ...u.attacks, twist: 0, flipped: false } }))
    case 'AmmoSpent':
      return withUnit(s, ev.unitId, (u) => (u.bins[ev.binId] ? { ...u, bins: { ...u.bins, [ev.binId]: { ...u.bins[ev.binId]!, shots: ev.left } } } : u))
    case 'HeatApplied':
      return withUnit(s, ev.unitId, (u) => ({ ...u, heat: ev.after }))
    case 'DamageApplied':
      return withUnit(s, ev.unitId, (u) => withLoc(u, ev.location, (l) => ({
        ...l, structure: ev.structureAfter, ...(ev.side === 'rear' ? { rear: ev.armorAfter } : { armor: ev.armorAfter }),
      })))
    case 'LocationDestroyed':
      return withUnit(s, ev.unitId, (u) => withLoc(u, ev.location, (l) => ({ ...l, destroyed: true, destroyedCause: ev.cause })))
    case 'CritSlotHit':
      return withUnit(s, ev.unitId, (u) => {
        const slots = u.slots[ev.location]
        if (!slots?.[ev.index]) return u
        const next = slots.map((x, i) => (i === ev.index ? { ...x, hit: true } : x))
        return { ...u, slots: { ...u.slots, [ev.location]: next } }
      })
    case 'ComponentDestroyed':
      return ev.mountId ? withUnit(s, ev.unitId, (u) => (u.mounts[ev.mountId!] ? { ...u, mounts: { ...u.mounts, [ev.mountId!]: { ...u.mounts[ev.mountId!]!, destroyed: true } } } : u)) : s
    case 'AmmoExploded':
      return withUnit(s, ev.unitId, (u) => (u.bins[ev.binId] ? { ...u, bins: { ...u.bins, [ev.binId]: { ...u.bins[ev.binId]!, shots: 0, exploded: true } } } : u))
    case 'PilotHit':
      return withUnit(s, ev.unitId, (u) => ({ ...u, pilot: { ...u.pilot, hits: ev.total } }))
    case 'PilotKilled':
      return withUnit(s, ev.unitId, (u) => ({ ...u, pilot: { ...u.pilot, dead: true, conscious: false } }))
    case 'ConsciousnessChecked':
      return withUnit(s, ev.unitId, (u) => ({ ...u, pilot: { ...u.pilot, conscious: ev.conscious } }))
    case 'PilotRecovered':
      return ev.recovered ? withUnit(s, ev.unitId, (u) => ({ ...u, pilot: { ...u.pilot, conscious: true } })) : s
    case 'UnitFell':
      return withUnit(s, ev.unitId, (u) => ({ ...u, prone: true, pos: ev.hex, facing: ev.facing }))
    case 'UnitDisplaced':
      return withUnit(s, ev.unitId, (u) => ({ ...u, pos: ev.to }))
    case 'UnitShutdown':
      return withUnit(s, ev.unitId, (u) => ({ ...u, shutdown: { cause: ev.cause, turn: s.turn }, heat: ev.heat }))
    case 'UnitRestarted':
      return withUnit(s, ev.unitId, (u) => ({ ...u, shutdown: null, heat: ev.heat }))
    case 'UnitDestroyed':
      return withUnit(s, ev.unitId, (u) => (ev.effective ? { ...u, status: 'destroyed', destroyedCause: ev.cause } : { ...u, doomed: ev.cause }))
    case 'StatusChanged':
      return withUnit(s, ev.unitId, (u) => ({ ...u, status: ev.status, crippled: ev.crippled }))
    case 'UnitRemoved': case 'UnitExited':
      return withUnit(s, ev.unitId, (u) => ({ ...u, status: ev.status }))
    case 'GameEnded':
      return { ...s, result: ev.result, phase: 'ended' }
    default:
      return s
  }
}
