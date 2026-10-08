// describe.* (00 §11.3): our own words for decisions, events, actions and units. Names are real; prose is ours.
import type { Action } from './actions'
import type { GameEvent } from './events'
import type { DecisionText } from './index'
import { bundleFor } from './bundles'
import { hexToLabel } from './hex'
import type { GameState, Hex, Loc, PendingDecision, PhaseId, UnitId } from './types'

const LOC: Record<Loc, string> = {
  HD: 'head', CT: 'centre torso', LT: 'left torso', RT: 'right torso', LA: 'left arm', RA: 'right arm', LL: 'left leg', RL: 'right leg',
}
const PHASE: Record<PhaseId, string> = {
  deployment: 'Deployment', initiative: 'Initiative Phase', movement: 'Movement Phase', rangedAttack: 'Ranged Attack Phase',
  physicalAttack: 'Physical Attack Phase', heat: 'Heat Phase', end: 'End Phase', ended: 'Battle over',
}
const FACING = ['north', 'north-east', 'south-east', 'south', 'south-west', 'north-west']

const name = (s: GameState, id: UnitId | null | undefined): string => (id ? s.units[id]?.name ?? id : 'nobody')
const hex = (s: GameState, h: Hex | null | undefined): string => (h ? hexToLabel(s.board, h) ?? `(${h.q},${h.r})` : 'off the board')
const side = (s: GameState, p: 'A' | 'B'): string => s.sides[p]?.label ?? `side ${p}`

/** Display name of a data record (weapon, ammo, equipment) from the state's bundle; null when unknown or no bundle. */
function recordName(s: GameState, id: string): string | null {
  try {
    const r = bundleFor(s).byId[id] as { name?: unknown } | undefined
    return typeof r?.name === 'string' && r.name ? r.name : null
  } catch { return null } // no bundle registered (bare test states): fall back to the id
}
/** 'is.ammo.mml-5-lrm' -> 'MML 5 LRM ammo'; with shots: 'MML 5 LRM ammo (24 shots)'. Never a raw id when the record exists. */
export function ammoLabel(s: GameState, ammoId: string, shots?: number): string {
  const n = recordName(s, ammoId)
  const base = n ? (/\bammo$/i.test(n) ? n.replace(/\bammo$/i, 'ammo') : `${n} ammo`) : ammoId
  return shots === undefined ? base : `${base} (${shots} shot${shots === 1 ? '' : 's'})`
}
/** A unit's weapon by mount id ('Medium Laser'), else the mount id. */
function mountName(s: GameState, unitId: UnitId | null | undefined, mountId: string): string {
  const m = unitId ? s.units[unitId]?.mounts[mountId] : undefined
  return (m && recordName(s, m.item)) ?? mountId
}

export function describeUnit(s: GameState, unitId: UnitId): string {
  const u = s.units[unitId]
  if (!u) return `unknown unit ${unitId}`
  const bits = [`${u.name} (${u.tonnage} t, ${side(s, u.owner)})`]
  if (u.pos) bits.push(`at ${hex(s, u.pos)} facing ${FACING[u.facing]}`)
  else bits.push(u.status === 'offBoard' ? 'waiting off the board' : 'off the board')
  if (u.prone) bits.push('prone')
  if (u.shutdown) bits.push('shut down')
  if (!u.pilot.conscious && !u.pilot.dead) bits.push('pilot unconscious')
  if (u.status !== 'active' && u.status !== 'offBoard') bits.push(u.status)
  if (u.crippled) bits.push('crippled')
  bits.push(`heat ${u.heat}`)
  return bits.join(', ')
}

export function describeDecision(s: GameState, p: PendingDecision): DecisionText {
  const who = side(s, p.player)
  const unit = p.unitId ? name(s, p.unitId) : ''
  const lines: string[] = []
  switch (p.kind) {
    case 'deploy':
      return { title: 'Deployment', prompt: `${who}: place a 'Mech in your deployment zone.`, lines: (p.context.eligible ?? []).map((id) => name(s, id)) }
    case 'initiativeAck': {
      const d = p.context.data as { totals?: Record<string, number>; winner?: 'A' | 'B' } | undefined
      if (d?.totals) lines.push(`${side(s, 'A')} rolled ${d.totals.A}, ${side(s, 'B')} rolled ${d.totals.B}.`)
      if (d?.winner) lines.push(`${side(s, d.winner)} wins the initiative and acts last.`)
      return { title: `Turn ${s.turn}: initiative`, prompt: 'Initiative is settled.', lines }
    }
    case 'selectUnit':
      return { title: PHASE[p.phase], prompt: `${who}: choose the next 'Mech to act.`, lines: (p.context.eligible ?? []).map((id) => describeUnit(s, id)) }
    case 'move':
      if (p.context.lockedMode) lines.push(`Movement mode already set: ${p.context.lockedMode}, ${p.context.mpLeft ?? 0} MP left.`)
      if (p.context.entry) lines.push(`Enter from the ${p.context.entry.edge} edge.`)
      return { title: 'Movement', prompt: `Move ${unit}.`, lines }
    case 'standUp':
      if (p.context.psr) lines.push(`Standing needs ${p.context.psr.tn}+ on 2d6 (${Math.round(p.context.psr.p * 100)}%).`)
      return { title: 'Movement', prompt: `${unit} is prone: try to stand, or stay down.`, lines }
    case 'torsoTwist':
      return { title: PHASE[p.phase], prompt: `${unit}: twist the torso or keep it forward.`, lines }
    case 'declareFire':
      return { title: 'Ranged Attack Phase', prompt: `${unit}: choose weapons and targets, or hold fire.`, lines: (p.context.targets ?? []).map((id) => `In reach: ${name(s, id)}`) }
    case 'chooseAmmo': {
      const weapon = p.context.mountId ? mountName(s, p.unitId, p.context.mountId) : null
      const prompt = weapon ? `${unit}: choose which ammunition the ${weapon} fires.` : `${unit}: choose which ammunition to load.`
      return { title: 'Ranged Attack Phase', prompt, lines: (p.context.bins ?? []).map((b) => ammoLabel(s, b.ammo, b.shots)) }
    }
    case 'declarePhysical':
      return { title: 'Physical Attack Phase', prompt: `${unit}: choose a punch, kick or push, or none.`, lines: (p.context.targets ?? []).map((id) => `Adjacent: ${name(s, id)}`) }
    case 'powerChoice':
      return { title: 'End Phase', prompt: `${who}: power up or shut down 'Mechs.`, lines: (p.context.power ?? []).map((e) => `${name(s, e.unitId)}: ${e.options.join(' / ')}`) }
    case 'choice':
      return { title: PHASE[p.phase], prompt: `${who}: make a choice.`, lines: (p.options ?? []).map((o) => o.label) }
    case 'gameOver': {
      const r = p.context.result
      const text = !r ? 'The battle is over.' : r.winner ? `${side(s, r.winner)} wins on turn ${r.turn}.` : `The battle ends in a draw on turn ${r.turn}.`
      return { title: 'Battle over', prompt: text, lines }
    }
  }
}

export function describeAction(s: GameState, a: Action): string {
  switch (a.type) {
    case 'pass': return `${side(s, a.player)} passes`
    case 'ack': return `${side(s, a.player)} continues`
    case 'choice': return `${side(s, a.player)} picks ${a.optionId}`
    case 'deploy': return `${name(s, a.unitId)} deploys at ${hex(s, a.hex)} facing ${FACING[a.facing]}`
    case 'selectUnit': return `${side(s, a.player)} selects ${name(s, a.unitId)}`
    case 'move': {
      if (a.mode === 'standStill') return `${name(s, a.unitId)} stands still`
      if (a.mode === 'jump') return `${name(s, a.unitId)} jumps to ${hex(s, a.jumpTo)}`
      return `${name(s, a.unitId)} ${a.mode === 'run' ? 'runs' : 'walks'} ${a.steps.length} steps, ending facing ${FACING[a.facing]}`
    }
    case 'standUp': return a.attempt ? `${name(s, a.unitId)} tries to stand` : `${name(s, a.unitId)} stays prone`
    case 'torsoTwist': return a.flip ? `${name(s, a.unitId)} flips its arms` : a.twist === 0 ? `${name(s, a.unitId)} keeps its torso forward` : `${name(s, a.unitId)} twists ${a.twist < 0 ? 'left' : 'right'}`
    case 'declareFire':
      if (a.shots.length === 0) return `${name(s, a.unitId)} holds fire`
      return `${name(s, a.unitId)} fires ${a.shots.length} weapon${a.shots.length > 1 ? 's' : ''} at ${[...new Set(a.shots.map((x) => name(s, x.targetId)))].join(' and ')}`
    case 'chooseAmmo': {
      // the action names no unit: the open chooseAmmo decision's unit, else the player's unit holding that mount and bin
      const uid = (s.pending?.kind === 'chooseAmmo' && s.pending.id === a.decisionId ? s.pending.unitId : null)
        ?? s.unitOrder.find((id) => { const u = s.units[id]!; return u.owner === a.player && !!u.mounts[a.mountId] && !!u.bins[a.binId] }) ?? null
      const bin = uid ? s.units[uid]?.bins[a.binId] : undefined
      const what = bin ? ammoLabel(s, bin.ammo) : `bin ${a.binId}`
      return `${uid ? name(s, uid) : side(s, a.player)} loads ${what} into the ${mountName(s, uid, a.mountId)}`
    }
    case 'declarePhysical': {
      const k = a.attack
      if (k.kind === 'none') return `${name(s, a.unitId)} makes no physical attack`
      if (k.kind === 'punch') return `${name(s, a.unitId)} punches ${k.arms.map((x) => name(s, x.targetId)).join(' and ')}`
      if (k.kind === 'kick') return `${name(s, a.unitId)} kicks ${name(s, k.targetId)}`
      return `${name(s, a.unitId)} pushes ${name(s, k.targetId)}`
    }
    case 'powerChoice': return a.changes.length === 0 ? `${side(s, a.player)} keeps power as it is` : a.changes.map((c) => `${name(s, c.unitId)}: ${c.to}`).join(', ')
  }
}

export function describeEvent(s: GameState, e: GameEvent): string {
  switch (e.type) {
    case 'DiceRolled': return `${e.purpose} roll: ${e.dice.join('+')} = ${e.total}${e.target !== undefined ? ` against ${e.target} (${e.success ? 'success' : 'failure'})` : ''}`
    case 'ActionRejected': return `Not allowed: ${e.rejection.message}`
    case 'DecisionAutoResolved': return `Only one choice: ${e.optionId}`
    case 'GameStarted': return 'The battle begins.'
    case 'UnitDeployed': return `${name(s, e.unitId)} takes position at ${hex(s, e.hex)}.`
    case 'TurnStarted': return `Turn ${e.turn} begins.`
    case 'PhaseStarted': return `${PHASE[e.phase]} begins.`
    case 'PhaseEnded': return `${PHASE[e.phase]} ends.`
    case 'InitiativeResolved': return `${side(s, e.winner)} wins the initiative ${e.totals[e.winner]} to ${e.totals[e.loser]}.`
    case 'PairStarted': return `Selection round ${e.pair}.`
    case 'UnitSelected': return `${name(s, e.unitId)} acts.`
    case 'MoveStarted': return `${name(s, e.unitId)} starts to ${e.mode === 'standStill' ? 'hold position' : e.mode} with ${e.mp} MP.`
    case 'UnitEntered': return `${name(s, e.unitId)} enters the field at ${hex(s, e.hex)}.`
    case 'UnitStepped': return `${name(s, e.unitId)}: ${e.op} to ${hex(s, e.to)} (${e.cost} MP, ${e.mpLeft} left).`
    case 'UnitJumped': return `${name(s, e.unitId)} jumps from ${hex(s, e.from)} to ${hex(s, e.to)}.`
    case 'StandAttempted': return `${name(s, e.unitId)} ${e.success ? 'gets back up' : 'fails to stand'}.`
    case 'MoveTruncated': return `${name(s, e.unitId)} stops at ${hex(s, e.at)}.`
    case 'MoveEnded': return `${name(s, e.unitId)} ends its move: ${e.hexesMoved} hexes, target modifier +${e.tmm}.`
    case 'PhysicalDeclaredInMove': return `${name(s, e.unitId)} commits to a ${e.kind === 'dfa' ? 'death from above' : 'charge'} on ${name(s, e.targetId)}.`
    case 'UnitExited': return `${name(s, e.unitId)} leaves the field by the ${e.edge} edge.`
    case 'TorsoTwisted': return e.flipped ? `${name(s, e.unitId)} flips its arms.` : `${name(s, e.unitId)} twists ${e.twist < 0 ? 'left' : e.twist > 0 ? 'right' : 'back to forward'}.`
    case 'FireDeclared': return e.shots.length ? `${name(s, e.unitId)} opens fire with ${e.shots.length} weapon${e.shots.length > 1 ? 's' : ''}.` : `${name(s, e.unitId)} holds fire.`
    case 'PhysicalDeclared': return `${name(s, e.unitId)} prepares a ${e.kind} on ${name(s, e.targetId)} (needs ${e.tn}+).`
    case 'AmmoSpent': return `${name(s, e.unitId)} spends ${e.shots} shot${e.shots > 1 ? 's' : ''}, ${e.left} left.`
    case 'HeatAdded': return `${name(s, e.unitId)} builds ${e.entry.amount} heat (${e.entry.source}).`
    case 'AttackRolled': return `${name(s, e.attackerId)} ${e.hit ? 'hits' : 'misses'} ${name(s, e.targetId)}${e.roll !== null ? ` (${e.roll} vs ${e.tn})` : ''}.`
    case 'AimedShotResolved': return e.onTarget ? `The aimed shot finds the ${LOC[e.aimedAt]}.` : 'The aimed shot drifts.'
    case 'ClusterResolved': return `${e.hits} of ${e.rackSize} hit.`
    case 'HitLocated': return `${name(s, e.unitId)} is hit in the ${LOC[e.location]}${e.side === 'rear' ? ' (rear)' : ''} for ${e.damage}.`
    case 'HitAbsorbedByCover': return `Cover absorbs ${e.damage} damage to the ${LOC[e.location]}.`
    case 'DamageApplied': return `${name(s, e.unitId)} ${LOC[e.location]}: armor ${e.armorBefore}→${e.armorAfter}, structure ${e.structureBefore}→${e.structureAfter}.`
    case 'LocationDestroyed': return `${name(s, e.unitId)} loses its ${LOC[e.location]}.`
    case 'CritCheckRolled': return e.blownOff ? `${name(s, e.unitId)}'s ${LOC[e.location]} is blown off!` : e.crits ? `${e.crits} critical hit${e.crits > 1 ? 's' : ''} in the ${LOC[e.appliesTo ?? e.location]}.` : 'No critical hit.'
    case 'CritLost': return `${e.count} critical hit${e.count > 1 ? 's' : ''} find nothing left to break.`
    case 'CritSlotHit': return `Critical: ${e.itemName ?? e.token} in the ${LOC[e.location]}.`
    case 'ComponentDestroyed': return `${name(s, e.unitId)}: ${e.token.replace('#', '')} destroyed.`
    case 'AmmoExploded': return `${name(s, e.unitId)}'s ammunition explodes for ${e.damage}!`
    case 'ComponentExploded': return `${name(s, e.unitId)}: a component explodes for ${e.damage}!`
    case 'PilotHit': return `${name(s, e.unitId)}'s pilot is hurt (${e.total} hits).`
    case 'UnitDestroyed': return `${name(s, e.unitId)} is destroyed.`
    case 'AttackEnded': return e.hit ? `${e.damageDealt} damage dealt.` : 'No damage.'
    case 'PsrQueued': return `${name(s, e.unitId)} must make a piloting roll (${e.reason}).`
    case 'PsrResolved': return `${name(s, e.unitId)} ${e.success ? 'keeps its footing' : 'loses its footing'}${e.roll !== null ? ` (${e.roll} vs ${e.tn})` : ''}.`
    case 'PsrDiscarded': return `A piloting roll for ${name(s, e.unitId)} is no longer needed.`
    case 'UnitFell': return `${name(s, e.unitId)} falls for ${e.damage} damage.`
    case 'UnitDisplaced': return `${name(s, e.unitId)} is pushed to ${hex(s, e.to)}.`
    case 'HeatApplied': return `${name(s, e.unitId)} heat ${e.before} → ${e.after} (+${e.generated}, -${e.dissipated}).`
    case 'UnitShutdown': return `${name(s, e.unitId)} shuts down at heat ${e.heat}.`
    case 'UnitRestarted': return `${name(s, e.unitId)} powers back up.`
    case 'ConsciousnessChecked': return `${name(s, e.unitId)}'s pilot ${e.conscious ? 'stays awake' : 'blacks out'} (${e.roll} vs ${e.tn}).`
    case 'PilotRecovered': return `${name(s, e.unitId)}'s pilot ${e.recovered ? 'comes round' : 'is still out'}.`
    case 'PilotKilled': return `${name(s, e.unitId)}'s pilot is killed.`
    case 'TwistReset': return `${name(s, e.unitId)} returns its torso forward.`
    case 'StatusChanged': return `${name(s, e.unitId)} is now ${e.status}${e.crippled ? ' (crippled)' : ''}.`
    case 'UnitRemoved': return `${name(s, e.unitId)} leaves the battle.`
    case 'GameEnded': return e.result.winner ? `${side(s, e.result.winner)} wins.` : 'The battle ends in a draw.'
  }
}
