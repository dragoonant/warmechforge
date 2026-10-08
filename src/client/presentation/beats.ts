// Event batch -> timed beats (50 §3). Pure: no timers, no stores. The director plays the beats.
// Durations at speed 1 come from 50 §3; every number a beat shows comes from its events.
import {
  query,
  type ArmorSide, type AttackId, type AttackKind, type DiceRolled, type Facing, type GameEvent, type GameState, type Hex, type Id,
  type LocalId, type Loc, type PlayerId, type RollPurpose, type UnitId,
} from '../../engine/index'
import { CRIT_EFFECT_LABELS, LOC_SHORT, PHASE_LABELS, unitName } from './labels'

/** An event with its position in the game's event stream (1-based, monotonic for the whole game). */
export interface SeqEvent { seq: number; event: GameEvent }

export type BeatKind =
  | 'apply' | 'banner' | 'initiative' | 'deploy' | 'move' | 'twist' | 'fire' | 'cluster' | 'hit' | 'crit' | 'check' | 'fall'
  | 'explosion' | 'heat' | 'destroyed' | 'shutdown' | 'pilot'
export type BannerKind = 'turn' | 'phase' | 'crit' | 'explosion' | 'destroyed' | 'game' | 'info'

/** One keyframe of a unit tween. `at` is the fraction 0..1 of the beat; `twist` is continuous (-1..1). */
export interface TweenKey { at: number; hex: Hex; x: number; z: number; facing: Facing; twist: number; prone: boolean }
export type TweenKind = 'walk' | 'jump' | 'twist' | 'displace' | 'deploy' | 'enter'
export interface TweenSpec { unitId: UnitId; kind: TweenKind; keys: TweenKey[] }
export type PopKind = 'damage' | 'miss' | 'hit' | 'crit' | 'heat' | 'pilot' | 'info'
export interface PopSpec { unitId: UnitId; text: string; kind: PopKind; location?: Loc }
export interface BannerSpec { text: string; kind: BannerKind; sub?: string }

/** What the board / VFX should show for a beat (all values from events). */
export type BeatFx =
  | { kind: 'initiative'; winner: PlayerId; totals: Record<PlayerId, number> }
  | { kind: 'fire'; attackId: AttackId; attackerId: UnitId; targetId: UnitId | null; attack: AttackKind; mountId: LocalId | null; weaponId: Id | null; hit: boolean; tn: number; roll: number | null }
  | { kind: 'cluster'; attackId: AttackId; hits: number; rackSize: number }
  | { kind: 'hit'; unitId: UnitId; location: Loc; side: ArmorSide; damage: number; attackId: AttackId | null }
  | { kind: 'crit'; unitId: UnitId; location: Loc; text: string }
  | { kind: 'check'; unitId: UnitId | null; purpose: RollPurpose; success: boolean | null }
  | { kind: 'fall'; unitId: UnitId }
  | { kind: 'explosion'; unitId: UnitId; location: Loc; damage: number }
  | { kind: 'heat'; unitId: UnitId; before: number; after: number }
  | { kind: 'destroyed'; unitId: UnitId }
  | { kind: 'shutdown'; unitId: UnitId; on: boolean }

export interface Beat {
  kind: BeatKind
  events: SeqEvent[]
  /** Duration at speed 1, in ms (0 = instantaneous). */
  baseMs: number
  /** When the beat's events reach the presented state: tweens land at the end, everything else at the start. */
  applyAt: 'start' | 'end'
  /** Units the beat is about (highlight rings). */
  unitIds: UnitId[]
  tweens?: TweenSpec[]
  /** Every roll in the beat, in order (all reach the dice log; the last is the one the tray shows). */
  rolls?: DiceRolled[]
  pops?: PopSpec[]
  banner?: BannerSpec
  fx?: BeatFx
}

/** 50 §3 durations at speed 1. */
export const BEAT_MS = {
  turn: 1600, phase: 2400, initiative: 900, hex: 180, hexTurn: 90, jumpBase: 500, jumpPerHex: 60, twist: 250, fire: 700,
  hit: 600, cluster: 500, crit: 600, check: 800, roll: 500, fall: 500, explosion: 1200, heat: 700, destroyed: 1200,
  deploy: 400, displace: 300, pilot: 600, shutdown: 800, game: 2400,
} as const

/** Ease in-out for tweens. */
export const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

export interface BeatOptions { narration: boolean }

interface Pose { hex: Hex | null; facing: Facing; twist: number; prone: boolean }

const AVOID_PURPOSES: ReadonlySet<RollPurpose> = new Set<RollPurpose>(['psr', 'consciousness', 'shutdownAvoid', 'startup', 'ammoExplosionAvoid', 'recovery', 'seatbelt', 'sensorCheck'])
/** The event that reports a roll's outcome, when it comes right after the roll. */
const RESULT_OF: Partial<Record<RollPurpose, GameEvent['type']>> = {
  toHit: 'AttackRolled', physicalToHit: 'AttackRolled', aimedShot: 'AimedShotResolved', cluster: 'ClusterResolved',
  critCheck: 'CritCheckRolled', psr: 'PsrResolved', consciousness: 'ConsciousnessChecked', recovery: 'PilotRecovered',
}
const LOCATION_PURPOSES: ReadonlySet<RollPurpose> = new Set<RollPurpose>(['hitLocation', 'punchLocation', 'kickLocation', 'fallLocation'])
/** Events folded into the hit beat that precedes them. */
const HIT_FOLLOWERS: ReadonlySet<GameEvent['type']> = new Set<GameEvent['type']>(['DamageApplied', 'LocationDestroyed', 'PilotHit', 'HitAbsorbedByCover'])

/**
 * Group a batch into beats. `before` is the state the batch starts from (start poses for tweens, weapon ids, names).
 */
export function buildBeats(before: GameState, events: readonly SeqEvent[], _opts: BeatOptions = { narration: true }): Beat[] {
  const beats: Beat[] = []
  let pending: SeqEvent[] = [] // zero-time events waiting to be flushed as one apply beat
  const flush = () => { if (pending.length) { beats.push({ kind: 'apply', events: pending, baseMs: 0, applyAt: 'start', unitIds: [] }); pending = [] } }
  const push = (b: Beat) => { flush(); beats.push(b) }
  const name = (id: UnitId | null | undefined) => unitName(before, id)

  const poses = new Map<UnitId, Pose>()
  const pose = (id: UnitId): Pose => {
    let p = poses.get(id)
    if (!p) {
      const u = before.units[id]
      p = { hex: u?.pos ?? null, facing: u?.facing ?? 0, twist: u?.attacks.twist ?? 0, prone: u?.prone ?? false }
      poses.set(id, p)
    }
    return p
  }
  const key = (at: number, hex: Hex, facing: Facing, twist: number, prone: boolean): TweenKey => {
    const w = query.hexToWorld(before, hex)
    return { at, hex, x: w.x, z: w.z, facing, twist, prone }
  }
  const ev = (i: number): GameEvent | undefined => events[i]?.event

  for (let i = 0; i < events.length; i++) {
    const se = events[i]!
    const e = se.event
    switch (e.type) {
      // ---------- banners ----------
      case 'TurnStarted':
        push({ kind: 'banner', events: [se], baseMs: BEAT_MS.turn, applyAt: 'start', unitIds: [], banner: { text: `Turn ${e.turn}`, kind: 'turn' } })
        break
      case 'PhaseStarted':
        if (e.phase === 'ended') { pending.push(se); break }
        push({ kind: 'banner', events: [se], baseMs: BEAT_MS.phase, applyAt: 'start', unitIds: [], banner: { text: PHASE_LABELS[e.phase], kind: 'phase', sub: `Turn ${e.turn}` } })
        break
      case 'GameEnded': {
        const r = e.result
        const text = r.winner ? `${before.sides[r.winner]?.label || `Side ${r.winner}`} wins` : 'Draw'
        push({ kind: 'banner', events: [se], baseMs: BEAT_MS.game, applyAt: 'start', unitIds: [], banner: { text, kind: 'game', sub: `Turn ${r.turn}` } })
        break
      }
      // ---------- placement and movement ----------
      case 'UnitDeployed': {
        const group: SeqEvent[] = [se]
        while (ev(i + 1)?.type === 'UnitDeployed') group.push(events[++i]!)
        const tweens: TweenSpec[] = group.map((g) => {
          const d = g.event as Extract<GameEvent, { type: 'UnitDeployed' }>
          const p = pose(d.unitId)
          const k = key(1, d.hex, d.facing, 0, false)
          p.hex = d.hex; p.facing = d.facing
          return { unitId: d.unitId, kind: 'deploy', keys: [{ ...k, at: 0 }, k] }
        })
        push({ kind: 'deploy', events: group, baseMs: BEAT_MS.deploy, applyAt: 'end', unitIds: tweens.map((t) => t.unitId), tweens })
        break
      }
      case 'UnitEntered': case 'UnitStepped': {
        // one beat for a run of steps by one unit (an entry hex first, when it comes on board)
        const unitId = e.unitId
        const group: SeqEvent[] = [se]
        while (true) {
          const nx = ev(i + 1)
          if (!nx || (nx.type !== 'UnitStepped' && nx.type !== 'UnitEntered') || nx.unitId !== unitId) break
          group.push(events[++i]!)
        }
        const p = pose(unitId)
        type K = { ms: number; hex: Hex; facing: Facing; prone: boolean }
        const ks: K[] = []
        let ms = 0
        for (const g of group) {
          const x = g.event
          if (x.type === 'UnitEntered') {
            p.hex = x.hex; p.facing = x.facing
            if (!ks.length) ks.push({ ms: 0, hex: x.hex, facing: x.facing, prone: p.prone })
            else { ms += BEAT_MS.hex; ks.push({ ms, hex: x.hex, facing: x.facing, prone: p.prone }) }
          } else if (x.type === 'UnitStepped') {
            if (!ks.length) ks.push({ ms: 0, hex: x.from, facing: p.facing, prone: p.prone })
            const moved = x.from.q !== x.to.q || x.from.r !== x.to.r
            ms += moved ? BEAT_MS.hex : BEAT_MS.hexTurn
            if (x.op === 'dropProne') p.prone = true
            p.hex = x.to; p.facing = x.facing
            ks.push({ ms, hex: x.to, facing: x.facing, prone: p.prone })
          }
        }
        if (ms <= 0) { pending.push(...group); break }
        const keys = ks.map((k) => key(k.ms / ms, k.hex, k.facing, p.twist, k.prone))
        push({ kind: 'move', events: group, baseMs: ms, applyAt: 'end', unitIds: [unitId], tweens: [{ unitId, kind: group[0]!.event.type === 'UnitEntered' ? 'enter' : 'walk', keys }] })
        break
      }
      case 'UnitJumped': {
        const p = pose(e.unitId)
        const hexes = Math.max(1, query.distance(e.from, e.to))
        const keys = [key(0, e.from, p.facing, p.twist, false), key(1, e.to, e.facing, p.twist, false)]
        p.hex = e.to; p.facing = e.facing
        push({ kind: 'move', events: [se], baseMs: BEAT_MS.jumpBase + BEAT_MS.jumpPerHex * hexes, applyAt: 'end', unitIds: [e.unitId], tweens: [{ unitId: e.unitId, kind: 'jump', keys }] })
        break
      }
      case 'UnitDisplaced': {
        const p = pose(e.unitId)
        const keys = [key(0, e.from, p.facing, p.twist, p.prone), key(1, e.to, p.facing, p.twist, p.prone)]
        p.hex = e.to
        push({ kind: 'move', events: [se], baseMs: BEAT_MS.displace, applyAt: 'end', unitIds: [e.unitId], tweens: [{ unitId: e.unitId, kind: 'displace', keys }] })
        break
      }
      case 'TorsoTwisted': {
        const p = pose(e.unitId)
        const to = e.flipped ? p.twist : e.twist
        if (!p.hex || to === p.twist) { pending.push(se); break }
        const keys = [key(0, p.hex, p.facing, p.twist, p.prone), key(1, p.hex, p.facing, to, p.prone)]
        p.twist = to
        push({ kind: 'twist', events: [se], baseMs: BEAT_MS.twist, applyAt: 'end', unitIds: [e.unitId], tweens: [{ unitId: e.unitId, kind: 'twist', keys }] })
        break
      }
      case 'TwistReset': pose(e.unitId).twist = 0; pending.push(se); break
      case 'StandAttempted': { const p = pose(e.unitId); if (e.success) p.prone = false; p.facing = e.facing; pending.push(se); break }
      // ---------- rolls and their results ----------
      case 'DiceRolled': {
        const group: SeqEvent[] = [se]
        const rolls: DiceRolled[] = [e]
        if (e.purpose === 'initiative') {
          while (ev(i + 1)?.type === 'DiceRolled' && (ev(i + 1) as DiceRolled).purpose === 'initiative') { group.push(events[++i]!); rolls.push(group[group.length - 1]!.event as DiceRolled) }
          const res = ev(i + 1)
          if (res?.type === 'InitiativeResolved') {
            group.push(events[++i]!)
            push({ kind: 'initiative', events: group, baseMs: BEAT_MS.initiative, applyAt: 'start', unitIds: [], rolls, fx: { kind: 'initiative', winner: res.winner, totals: res.totals }, banner: { text: `${before.sides[res.winner]?.label || `Side ${res.winner}`} wins initiative`, kind: 'info', sub: `${res.totals.A} vs ${res.totals.B}` } })
          } else push({ kind: 'initiative', events: group, baseMs: BEAT_MS.initiative, applyAt: 'start', unitIds: [], rolls })
          break
        }
        if (e.purpose === 'toHit' || e.purpose === 'physicalToHit') {
          const res = ev(i + 1)
          if (res?.type === 'AttackRolled') { group.push(events[++i]!); push(fireBeat(before, group, res, rolls)); break }
        }
        if (LOCATION_PURPOSES.has(e.purpose) && ev(i + 1)?.type === 'HitLocated') {
          group.push(events[++i]!)
          while (ev(i + 1) && HIT_FOLLOWERS.has(ev(i + 1)!.type)) group.push(events[++i]!)
          push(hitBeat(before, group, rolls))
          break
        }
        if (e.purpose === 'critSlot') {
          while (ev(i + 1)?.type === 'DiceRolled' && (ev(i + 1) as DiceRolled).purpose === 'critSlot') { group.push(events[++i]!); rolls.push(group[group.length - 1]!.event as DiceRolled) }
          const res = ev(i + 1)
          if (res?.type === 'CritSlotHit' || res?.type === 'CritLost') {
            group.push(events[++i]!)
            while (ev(i + 1)?.type === 'ComponentDestroyed') group.push(events[++i]!)
          }
          push(critBeat(before, group, rolls))
          break
        }
        const want = RESULT_OF[e.purpose]
        if (want && ev(i + 1)?.type === want) group.push(events[++i]!)
        const res = group[1]?.event
        if (res?.type === 'ClusterResolved') {
          push({ kind: 'cluster', events: group, baseMs: BEAT_MS.cluster, applyAt: 'start', unitIds: e.unitId ? [e.unitId] : [], rolls, fx: { kind: 'cluster', attackId: res.attackId, hits: res.hits, rackSize: res.rackSize } })
          break
        }
        if (res?.type === 'CritCheckRolled') {
          while (ev(i + 1)?.type === 'CritLost') group.push(events[++i]!)
          const banner: BannerSpec | undefined = res.blownOff ? { text: `${name(res.unitId)}: ${LOC_SHORT[res.location]} blown off!`, kind: 'crit' } : undefined
          push({ kind: 'crit', events: group, baseMs: BEAT_MS.crit, applyAt: 'start', unitIds: [res.unitId], rolls, ...(banner ? { banner } : {}), pops: res.crits || res.blownOff ? [{ unitId: res.unitId, text: res.blownOff ? 'blown off' : `${res.crits} crit${res.crits > 1 ? 's' : ''}`, kind: 'crit', location: res.location }] : [] })
          break
        }
        const unitId = (res && 'unitId' in res ? (res as { unitId: UnitId }).unitId : undefined) ?? e.unitId ?? null
        const success = res?.type === 'PsrResolved' ? res.success : res?.type === 'ConsciousnessChecked' ? res.conscious : res?.type === 'PilotRecovered' ? res.recovered : e.success ?? null
        push({
          kind: 'check', events: group, baseMs: AVOID_PURPOSES.has(e.purpose) ? BEAT_MS.check : BEAT_MS.roll, applyAt: 'start', unitIds: unitId ? [unitId] : [], rolls,
          fx: { kind: 'check', unitId, purpose: e.purpose, success },
        })
        break
      }
      case 'AttackRolled': push(fireBeat(before, [se], e, [])); break
      case 'HitLocated': {
        const group: SeqEvent[] = [se]
        while (ev(i + 1) && HIT_FOLLOWERS.has(ev(i + 1)!.type)) group.push(events[++i]!)
        push(hitBeat(before, group, []))
        break
      }
      case 'DamageApplied': {
        const group: SeqEvent[] = [se]
        while (ev(i + 1) && HIT_FOLLOWERS.has(ev(i + 1)!.type) && ev(i + 1)!.type !== 'DamageApplied') group.push(events[++i]!)
        push(hitBeat(before, group, []))
        break
      }
      case 'CritSlotHit': push(critBeat(before, [se], [])); break
      case 'PsrResolved':
        push({ kind: 'check', events: [se], baseMs: BEAT_MS.check, applyAt: 'start', unitIds: [e.unitId], fx: { kind: 'check', unitId: e.unitId, purpose: 'psr', success: e.success } })
        break
      case 'UnitFell': {
        const group: SeqEvent[] = [se]
        const rolls: DiceRolled[] = []
        // the jolt roll, its pilot hit and the fall-direction roll belong to the fall itself
        while (true) {
          const nx = ev(i + 1)
          if (nx?.type === 'DiceRolled' && (nx.purpose === 'seatbelt' || nx.purpose === 'fallSide')) { group.push(events[++i]!); rolls.push(nx); continue }
          if (nx?.type === 'PilotHit' && nx.unitId === e.unitId) { group.push(events[++i]!); continue }
          break
        }
        const p = pose(e.unitId)
        p.prone = true; p.hex = e.hex; p.facing = e.facing
        push({ kind: 'fall', events: group, baseMs: BEAT_MS.fall, applyAt: 'start', unitIds: [e.unitId], rolls, fx: { kind: 'fall', unitId: e.unitId }, pops: [{ unitId: e.unitId, text: 'Falls!', kind: 'crit' }] })
        break
      }
      case 'AmmoExploded': case 'ComponentExploded':
        push({ kind: 'explosion', events: [se], baseMs: BEAT_MS.explosion, applyAt: 'start', unitIds: [e.unitId], fx: { kind: 'explosion', unitId: e.unitId, location: e.location, damage: e.damage }, banner: { text: `${name(e.unitId)}: ${e.type === 'AmmoExploded' ? 'ammo explosion' : 'explosion'}!`, kind: 'explosion', sub: `${e.damage} damage to the ${LOC_SHORT[e.location]}` } })
        break
      // ---------- heat, power, pilot, destruction ----------
      case 'HeatApplied':
        push({ kind: 'heat', events: [se], baseMs: BEAT_MS.heat, applyAt: 'start', unitIds: [e.unitId], fx: { kind: 'heat', unitId: e.unitId, before: e.before, after: e.after }, pops: [{ unitId: e.unitId, text: `heat ${e.before} → ${e.after}`, kind: 'heat' }] })
        break
      case 'UnitShutdown':
        push({ kind: 'shutdown', events: [se], baseMs: BEAT_MS.shutdown, applyAt: 'start', unitIds: [e.unitId], fx: { kind: 'shutdown', unitId: e.unitId, on: false }, pops: [{ unitId: e.unitId, text: 'Shutdown', kind: 'heat' }] })
        break
      case 'UnitRestarted':
        push({ kind: 'shutdown', events: [se], baseMs: BEAT_MS.pilot, applyAt: 'start', unitIds: [e.unitId], fx: { kind: 'shutdown', unitId: e.unitId, on: true }, pops: [{ unitId: e.unitId, text: 'Restarts', kind: 'info' }] })
        break
      case 'PilotHit':
        push({ kind: 'pilot', events: [se], baseMs: BEAT_MS.pilot, applyAt: 'start', unitIds: [e.unitId], pops: [{ unitId: e.unitId, text: `pilot hit (${e.total})`, kind: 'pilot' }] })
        break
      case 'PilotKilled':
        push({ kind: 'pilot', events: [se], baseMs: BEAT_MS.check, applyAt: 'start', unitIds: [e.unitId], pops: [{ unitId: e.unitId, text: 'pilot killed', kind: 'crit' }] })
        break
      case 'UnitDestroyed':
        if (e.effective) push({ kind: 'destroyed', events: [se], baseMs: BEAT_MS.destroyed, applyAt: 'start', unitIds: [e.unitId], fx: { kind: 'destroyed', unitId: e.unitId }, banner: { text: `${name(e.unitId)} destroyed`, kind: 'destroyed' } })
        else push({ kind: 'pilot', events: [se], baseMs: BEAT_MS.pilot, applyAt: 'start', unitIds: [e.unitId], pops: [{ unitId: e.unitId, text: 'finished', kind: 'crit' }] })
        break
      default:
        pending.push(se)
    }
  }
  flush()
  return beats
}

function fireBeat(before: GameState, group: SeqEvent[], e: Extract<GameEvent, { type: 'AttackRolled' }>, rolls: DiceRolled[]): Beat {
  const weaponId = e.mountId ? before.units[e.attackerId]?.mounts[e.mountId]?.item ?? null : null
  const pops: PopSpec[] = !e.hit && e.targetId ? [{ unitId: e.targetId, text: 'Miss', kind: 'miss' }] : []
  return {
    kind: 'fire', events: group, baseMs: BEAT_MS.fire, applyAt: 'start', unitIds: e.targetId ? [e.attackerId, e.targetId] : [e.attackerId], rolls, pops,
    fx: { kind: 'fire', attackId: e.attackId, attackerId: e.attackerId, targetId: e.targetId, attack: e.kind, mountId: e.mountId, weaponId, hit: e.hit, tn: e.tn, roll: e.roll },
  }
}

function hitBeat(_before: GameState, group: SeqEvent[], rolls: DiceRolled[]): Beat {
  const pops: PopSpec[] = []
  let fx: BeatFx | undefined
  const units = new Set<UnitId>()
  for (const g of group) {
    const x = g.event
    if (x.type === 'HitLocated') {
      units.add(x.unitId)
      fx ??= { kind: 'hit', unitId: x.unitId, location: x.location, side: x.side, damage: x.damage, attackId: x.attackId }
    } else if (x.type === 'DamageApplied') {
      units.add(x.unitId)
      const taken = x.armorBefore - x.armorAfter + (x.structureBefore - x.structureAfter)
      pops.push({ unitId: x.unitId, text: `−${taken} ${LOC_SHORT[x.location]}${x.side === 'rear' ? ' (R)' : ''}`, kind: x.structureBefore !== x.structureAfter ? 'crit' : 'damage', location: x.location })
      fx ??= { kind: 'hit', unitId: x.unitId, location: x.location, side: x.side, damage: x.damage, attackId: x.attackId }
    } else if (x.type === 'LocationDestroyed') {
      pops.push({ unitId: x.unitId, text: `${LOC_SHORT[x.location]} destroyed`, kind: 'crit', location: x.location })
    } else if (x.type === 'HitAbsorbedByCover') {
      pops.push({ unitId: x.unitId, text: 'cover', kind: 'info', location: x.location })
    }
  }
  return { kind: 'hit', events: group, baseMs: BEAT_MS.hit, applyAt: 'start', unitIds: [...units], rolls, pops, ...(fx ? { fx } : {}) }
}

function critBeat(before: GameState, group: SeqEvent[], rolls: DiceRolled[]): Beat {
  const hit = group.map((g) => g.event).find((x): x is Extract<GameEvent, { type: 'CritSlotHit' }> => x.type === 'CritSlotHit')
  if (!hit) {
    const lost = group.map((g) => g.event).find((x): x is Extract<GameEvent, { type: 'CritLost' }> => x.type === 'CritLost')
    return { kind: 'crit', events: group, baseMs: BEAT_MS.crit, applyAt: 'start', unitIds: lost ? [lost.unitId] : [], rolls }
  }
  const text = `${hit.itemName ?? hit.token} (${LOC_SHORT[hit.location]}): ${CRIT_EFFECT_LABELS[hit.effect]}`
  return {
    kind: 'crit', events: group, baseMs: BEAT_MS.crit, applyAt: 'start', unitIds: [hit.unitId], rolls,
    fx: { kind: 'crit', unitId: hit.unitId, location: hit.location, text },
    banner: { text: `Critical hit: ${unitName(before, hit.unitId)}`, kind: 'crit', sub: text },
    pops: [{ unitId: hit.unitId, text: hit.itemName ?? 'crit', kind: 'crit', location: hit.location }],
  }
}

// ---------- tween sampling (display interpolation only) ----------
export interface TweenPose {
  x: number
  z: number
  /** Feet facing as a continuous value in hexsides (0 = north, clockwise; may be fractional mid-turn). */
  facing: number
  /** Torso twist, continuous -1..1. */
  twist: number
  /** 0..1 height fraction of a jump arc (sin curve); 0 on the ground. */
  air: number
  /** Segment endpoints and the fraction between them (board picks heights from its own hex levels). */
  from: Hex
  to: Hex
  f: number
  prone: boolean
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f
/** Shortest turn between two facings in hexsides (-3..3]. */
function facingDelta(a: number, b: number): number { let d = ((b - a) % 6 + 6) % 6; if (d > 3) d -= 6; return d }

/** Sample a tween at fraction `t` (0..1, already eased or not, caller's choice). */
export function sampleTween(kind: TweenKind, keys: readonly TweenKey[], t: number): TweenPose {
  const first = keys[0]!
  if (keys.length === 1 || t <= 0) return { x: first.x, z: first.z, facing: first.facing, twist: first.twist, air: 0, from: first.hex, to: first.hex, f: 0, prone: first.prone }
  const last = keys[keys.length - 1]!
  if (t >= 1) return { x: last.x, z: last.z, facing: last.facing, twist: last.twist, air: 0, from: last.hex, to: last.hex, f: 1, prone: last.prone }
  let j = 1
  while (j < keys.length - 1 && keys[j]!.at < t) j++
  const a = keys[j - 1]!, b = keys[j]!
  const span = b.at - a.at
  const f = span > 0 ? Math.min(1, Math.max(0, (t - a.at) / span)) : 1
  const facing = ((a.facing + facingDelta(a.facing, b.facing) * f) % 6 + 6) % 6
  return {
    x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), facing, twist: lerp(a.twist, b.twist, f),
    air: kind === 'jump' ? Math.sin(Math.PI * t) : 0, from: a.hex, to: b.hex, f, prone: f < 1 ? a.prone : b.prone,
  }
}
