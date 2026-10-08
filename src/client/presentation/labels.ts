// Our words (50 §1 labels.ts): one table each for mod codes, roll purposes, locations, phases, PSR reasons, LOS reasons,
// terrain, crit effects. Names come from the engine state / data; numbers come from events and queries, never computed here.
import type {
  AttackDirection, CritEffect, DecisionKind, DestroyCause, DiceRolled, Facing, GameEvent, GameState, Hex, HexLabel, Loc,
  LosReason, ModCode, MoveMode, PhaseId, PlayerId, PsrReason, RangeBand, RollPurpose, UnitId, UnitStatus,
} from '../../engine/index'
import { hexToLabel } from '../../engine/hex'

// ---------- names ----------
/** Display name of a unit (the engine's unit name), falling back to its id. */
export function unitName(state: GameState | null, id: UnitId | null | undefined): string {
  if (!id) return 'nobody'
  return state?.units[id]?.name ?? id
}
/** The side's label ("Eris Lance"), falling back to "Side A". */
export function sideName(state: GameState | null, p: PlayerId | null | undefined): string {
  if (!p) return 'Nobody'
  return state?.sides[p]?.label || state?.setup.sides[p === 'A' ? 0 : 1]?.label || `Side ${p}`
}
/** Fallback force colours when the force data has none (A blue, B red). */
export const DEFAULT_FORCE_COLOURS: Record<PlayerId, string> = { A: '#3b6ea8', B: '#b8432f' }
/** Colour of a side, from its force (50: colours follow the force, not the seat). */
export function forceColour(state: GameState | null, p: PlayerId): string {
  const c = state?.setup.sides[p === 'A' ? 0 : 1]?.force.color
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : DEFAULT_FORCE_COLOURS[p]
}
/** 'XXYY' label of a hex on the state's board, or '(q,r)' off the board. */
export function hexName(state: GameState | null, h: Hex | null | undefined): HexLabel {
  if (!h) return 'off the board'
  return (state ? hexToLabel(state.board, h) : null) ?? `(${h.q},${h.r})`
}

// ---------- tables ----------
export const PHASE_LABELS: Record<PhaseId, string> = {
  deployment: 'Deployment', initiative: 'Initiative Phase', movement: 'Movement Phase', rangedAttack: 'Ranged Attack Phase',
  physicalAttack: 'Physical Attack Phase', heat: 'Heat Phase', end: 'End Phase', ended: 'Battle over',
}
export const LOC_LABELS: Record<Loc, string> = {
  HD: 'head', CT: 'centre torso', LT: 'left torso', RT: 'right torso', LA: 'left arm', RA: 'right arm', LL: 'left leg', RL: 'right leg',
}
export const LOC_SHORT: Record<Loc, string> = { HD: 'HD', CT: 'CT', LT: 'LT', RT: 'RT', LA: 'LA', RA: 'RA', LL: 'LL', RL: 'RL' }
/** Compass words for feet facings 0-5. */
export const FACING_LABELS: Record<Facing, string> = { 0: 'N', 1: 'NE', 2: 'SE', 3: 'S', 4: 'SW', 5: 'NW' }
export const FACING_WORDS: Record<Facing, string> = { 0: 'north', 1: 'north-east', 2: 'south-east', 3: 'south', 4: 'south-west', 5: 'north-west' }
export const MOVE_MODE_LABELS: Record<MoveMode, string> = { standStill: 'Stand still', walk: 'Walk', run: 'Run', jump: 'Jump' }
export const RANGE_LABELS: Record<RangeBand, string> = { short: 'short', medium: 'medium', long: 'long', out: 'out of range' }
export const DIRECTION_LABELS: Record<AttackDirection, string> = { front: 'front', left: 'left side', right: 'right side', rear: 'rear' }

/** Modifier lines (TN breakdowns). Values come with the mod; the label never carries a number. */
export const MOD_LABELS: Record<ModCode, string> = {
  gunnery: 'Gunnery', piloting: 'Piloting', range: 'range', minRange: 'inside minimum range', attackerMove: 'you moved',
  attackerProne: 'you are prone', tmm: 'target moved', targetJumped: 'target jumped', targetProne: 'target prone',
  targetImmobile: 'target immobile', woodsTarget: "woods in the target's hex", woodsIntervening: 'woods in the way',
  partialCover: 'partial cover', heat: 'heat', secondaryTarget: 'secondary target', sensors: 'sensors damaged',
  shoulder: 'shoulder damaged', upperArm: 'upper arm damaged', lowerArm: 'lower arm damaged', hand: 'hand damaged',
  weapon: 'weapon', targetingComputer: 'targeting computer', aimedShot: 'aimed shot', physicalBase: 'base',
  comparative: 'skill difference', upperLeg: 'upper leg damaged', lowerLeg: 'lower leg damaged', foot: 'foot damaged',
  hip: 'hip damaged', gyro: 'gyro damaged', legDestroyed: 'leg destroyed', damage20: '20+ damage this phase',
  charged: 'was charged', dfa: 'death from above', chargeMade: 'made a charge', dfaMade: 'made a death from above',
  stand: 'standing up', water: 'water', levelsFallen: 'levels fallen', clusterMod: 'cluster bonus', caseII: 'CASE II',
  consciousness: 'pilot hits', avoid: 'avoid roll', fallFromAbove: 'falling from above', terrain: 'terrain', spa: 'special ability',
  other: 'other',
}

/** Dice tray purpose labels (50 §9). Typed Record: a new engine purpose fails typecheck until it has a label. */
export const ROLL_PURPOSE_LABELS: Record<RollPurpose, string> = {
  initiative: 'Initiative', toHit: 'To hit', physicalToHit: 'Physical to hit', aimedShot: 'Aimed shot', cluster: 'Cluster',
  hitLocation: 'Hit location', punchLocation: 'Punch location', kickLocation: 'Kick location', fallSide: 'Fall direction',
  fallLocation: 'Fall location', critCheck: 'Critical check', critSlot: 'Critical slot', psr: 'Piloting roll', seatbelt: 'Pilot jolt',
  consciousness: 'Consciousness', recovery: 'Pilot recovery', shutdownAvoid: 'Shutdown avoid', startup: 'Restart',
  ammoExplosionAvoid: 'Ammo avoid', fallFromAbove: 'Falling unit', escalatingFailure: 'Equipment strain', jam: 'Jam check',
  sensorCheck: 'Sensor check', tieBreak: 'Tie-break',
}

export const PSR_REASON_LABELS: Record<PsrReason, string> = {
  damage20: '20+ damage', gyroCrit: 'gyro hit', hipCrit: 'hip hit', upperLegCrit: 'upper leg hit', lowerLegCrit: 'lower leg hit',
  legDestroyed: 'leg destroyed', bothLegs: 'both legs gone', gyroDestroyed: 'gyro destroyed', kicked: 'kicked', pushed: 'pushed',
  charged: 'charged', dfaTarget: 'struck from above', missedKick: 'missed kick', chargeMade: 'made a charge', dfaMade: 'landed a DFA',
  dfaMissed: 'missed a DFA', stand: 'standing up', runWater: 'running into water', rubble: 'entering rubble',
  backwardLevel: 'backing down a level', landWater: 'landing in water', runDamaged: 'running damaged', jumpDamaged: 'jumping damaged',
  domino: 'knocked by a falling unit', fallFromAbove: 'unit fell on it', seatbelt: 'fall jolt', sensorCheck: 'sensor check', masc: 'MASC strain',
}

export const LOS_REASON_LABELS: Record<LosReason['code'], string> = {
  clear: 'clear', adjacent: 'adjacent', hill: 'blocked: higher ground', woods: 'woods', woodsBlock: 'blocked: woods total 3+',
  waterLine: 'across the water line: no attack', partialCoverHill: 'partial cover', partialCoverWater: 'partial cover (water)',
  divided: "divided line: defender's choice", offBoard: 'off the board', sameHex: 'same hex',
}

export const CRIT_EFFECT_LABELS: Record<CritEffect, string> = {
  none: 'no effect', componentDestroyed: 'destroyed', componentDamaged: 'damaged', ammoExplosion: 'ammo explodes',
  componentExplosion: 'explodes', cockpit: 'cockpit hit', engine: 'engine hit', gyro: 'gyro hit', sensors: 'sensors hit',
  lifeSupport: 'life support hit', actuator: 'actuator hit', heatSink: 'heat sink lost', jumpJet: 'jump jet lost', emptyBin: 'empty ammo bin',
}

export const DESTROY_CAUSE_LABELS: Record<DestroyCause, string> = {
  headDestroyed: 'head destroyed', ctDestroyed: 'centre torso destroyed', cockpit: 'cockpit destroyed', pilotKilled: 'pilot killed',
  engine: 'engine destroyed', displacedOff: 'pushed off the board', noLegalHex: 'nowhere to stand', surrendered: 'surrendered',
}

export const STATUS_LABELS: Record<UnitStatus, string> = {
  offBoard: 'waiting', active: 'active', withdrawing: 'withdrawing', withdrawn: 'withdrawn', surrendered: 'surrendered', destroyed: 'destroyed',
}

export const DECISION_LABELS: Record<DecisionKind, string> = {
  deploy: 'Deploy', initiativeAck: 'Initiative', selectUnit: "Pick a 'Mech", move: 'Move', standUp: 'Stand up', torsoTwist: 'Torso twist',
  declareFire: 'Fire', chooseAmmo: 'Choose ammo', declarePhysical: 'Physical attack', powerChoice: 'Power', choice: 'Choice', gameOver: 'Battle over',
}

/** Terrain words for a board hex (tooltip helper; numbers come from query.terrainInfo). */
export const TERRAIN_LABELS = {
  clear: 'Clear', lightWoods: 'Light woods', heavyWoods: 'Heavy woods', rough: 'Rough', rubble: 'Rubble', pavement: 'Pavement',
  road: 'Road', water: 'Water', level: 'Level', depth: 'Depth',
} as const

/** Heat scale effect chips (50 §11); value from query.heatScale(). */
export const HEAT_EFFECT_LABELS = {
  mp: (v: number) => `−${Math.abs(v)} MP`,
  toHit: (v: number) => `+${v} to-hit`,
  shutdown: (v: number) => `shutdown ${v}+`,
  autoShutdown: () => 'shuts down',
  ammo: (v: number) => `ammo ${v}+`,
  lifeSupport: () => 'pilot takes 1 hit (life support damaged)',
} as const

// ---------- formatting (never computing) ----------
/**
 * Odds text (50 §2): integer percent; TN <= 2 'auto', TN >= 13 'impossible'; never prints 0% or 100% otherwise.
 * `p` is the engine's probability; `tn` the engine's target number.
 */
export function formatOdds(p: number, tn?: number): string {
  if (tn !== undefined && tn <= 2) return 'auto'
  if (tn !== undefined && tn >= 13) return 'impossible'
  if (!(p > 0)) return tn === undefined ? 'impossible' : '<1%'
  if (p >= 1) return tn === undefined ? 'auto' : '>99%'
  const pct = Math.round(p * 100)
  if (pct >= 100) return '>99%'
  if (pct <= 0) return '<1%'
  return `${pct}%`
}
/** Signed modifier: +2, −1, 0. */
export function formatMod(v: number): string { return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0' }

// ---------- dice tray ----------
export function rollLabel(state: GameState | null, ev: DiceRolled): string {
  const base = ROLL_PURPOSE_LABELS[ev.purpose] ?? 'Roll'
  return ev.unitId ? `${unitName(state, ev.unitId)}: ${base}` : base
}
/** Short verdict word for a roll with a target (from the event's own target / success); null when there is none. */
export function rollVerdict(ev: DiceRolled): string | null {
  if (ev.target === undefined) return null
  const ok = ev.success ?? ev.total >= ev.target
  switch (ev.purpose) {
    case 'toHit': case 'physicalToHit': return ok ? 'HIT' : 'MISS'
    case 'psr': return ok ? 'PASS' : 'FAIL'
    case 'consciousness': return ok ? 'awake' : 'unconscious'
    case 'shutdownAvoid': return ok ? 'avoided' : 'shuts down'
    case 'startup': return ok ? 'restarts' : 'stays down'
    case 'ammoExplosionAvoid': return ok ? 'avoided' : 'explodes'
    case 'recovery': return ok ? 'recovers' : 'still out'
    default: return ok ? 'pass' : 'fail'
  }
}

// ---------- narration (one line per notable event; numbers from the event) ----------
/** Where a unit was when the event happened, tracked by the caller from earlier events (never read from live unit state). */
export interface NarrateAt { hex?: Hex; facing?: Facing; stayedDown?: boolean }
export function narrate(state: GameState | null, ev: GameEvent, at: NarrateAt = {}): string | null {
  const n = (id: UnitId | null | undefined) => unitName(state, id)
  switch (ev.type) {
    case 'TurnStarted': return `Turn ${ev.turn} begins.`
    case 'PhaseStarted': return ev.phase === 'ended' ? null : `${PHASE_LABELS[ev.phase]}.`
    case 'InitiativeResolved': return `${sideName(state, ev.winner)} wins initiative ${ev.totals[ev.winner]} to ${ev.totals[ev.loser]} and moves last.`
    case 'UnitDeployed': return `${n(ev.unitId)} deploys at ${hexName(state, ev.hex)}, facing ${FACING_LABELS[ev.facing]}.`
    case 'UnitEntered': return `${n(ev.unitId)} enters the field at ${hexName(state, ev.hex)}.`
    case 'MoveEnded': {
      const u = state?.units[ev.unitId]
      if (ev.mode === 'standStill') return `${n(ev.unitId)} holds position.`
      // hex and facing come from the move's own steps (at), so a past row never changes when the unit moves later
      const hex = at.hex ?? u?.pos
      const facing = at.facing ?? u?.facing
      if (at.stayedDown) return `${n(ev.unitId)} stays down in ${hexName(state, hex)} (${ev.mpSpent} MP spent trying to stand).`
      const verb = ev.mode === 'jump' ? 'jumps' : ev.mode === 'run' ? 'runs' : 'walks'
      return `${n(ev.unitId)} ${verb} to ${hexName(state, hex)} (${ev.mpSpent} MP), facing ${facing !== undefined ? FACING_LABELS[facing] : '?'}.`
    }
    case 'PhysicalDeclaredInMove': return `${n(ev.unitId)} commits to a ${ev.kind === 'dfa' ? 'death from above' : 'charge'} on ${n(ev.targetId)}.`
    case 'StandAttempted': return ev.success ? `${n(ev.unitId)} gets back up.` : `${n(ev.unitId)} fails to stand.`
    case 'TorsoTwisted': return ev.flipped ? `${n(ev.unitId)} flips its arms.` : ev.twist === 0 ? null : `${n(ev.unitId)} twists ${ev.twist < 0 ? 'left' : 'right'}.`
    case 'FireDeclared': return ev.shots.length ? `${n(ev.unitId)} fires ${ev.shots.length} weapon${ev.shots.length > 1 ? 's' : ''}.` : `${n(ev.unitId)} holds fire.`
    case 'PhysicalDeclared': return `${n(ev.unitId)} readies a ${ev.kind} on ${n(ev.targetId)} (TN ${ev.tn}).`
    case 'AttackRolled': return `${n(ev.attackerId)} → ${n(ev.targetId)}: ${ev.auto ? `automatic ${ev.auto}` : `${ev.tn > 0 ? `TN ${ev.tn}, ` : ''}rolled ${ev.roll}`} ${ev.hit ? 'HIT' : 'MISS'}.`
    case 'ClusterResolved': return `${ev.hits} of ${ev.rackSize} hit.`
    case 'DamageApplied': {
      const armor = ev.armorBefore !== ev.armorAfter ? ` armor ${ev.armorBefore}→${ev.armorAfter}` : ''
      const st = ev.structureBefore !== ev.structureAfter ? ` internal ${ev.structureBefore}→${ev.structureAfter}` : ''
      return `${n(ev.unitId)} ${LOC_SHORT[ev.location]}${ev.side === 'rear' ? ' (rear)' : ''}: ${ev.damage} damage,${armor}${st}${ev.reduced ? ` (armor stopped ${ev.reduced})` : ''}.`
    }
    case 'LocationDestroyed': return `${n(ev.unitId)} loses its ${LOC_LABELS[ev.location]}.`
    case 'CritSlotHit': return `Critical hit on ${n(ev.unitId)}: ${ev.itemName ?? ev.token} (${LOC_SHORT[ev.location]}), ${CRIT_EFFECT_LABELS[ev.effect]}.`
    case 'AmmoExploded': return `${n(ev.unitId)}'s ammunition explodes for ${ev.damage}!`
    case 'ComponentExploded': return `A component on ${n(ev.unitId)} explodes for ${ev.damage}!`
    case 'PilotHit': return `${n(ev.unitId)}'s pilot is hurt (${ev.total} hit${ev.total === 1 ? '' : 's'}).`
    case 'PilotKilled': return `${n(ev.unitId)}'s pilot is killed.`
    case 'ConsciousnessChecked': return `${n(ev.unitId)}'s pilot ${ev.conscious ? 'stays awake' : 'blacks out'} (TN ${ev.tn}, rolled ${ev.roll}).`
    case 'PsrResolved': return `${n(ev.unitId)} piloting roll (${PSR_REASON_LABELS[ev.reason]}): ${ev.auto ? 'automatic fall' : `TN ${ev.tn}, rolled ${ev.roll}`} ${ev.success ? 'PASS' : 'FAIL'}.`
    case 'UnitFell': return `${n(ev.unitId)} falls${ev.damage ? ` and takes ${ev.damage} damage` : ''}.`
    case 'UnitDisplaced': return `${n(ev.unitId)} is pushed to ${hexName(state, ev.to)}.`
    case 'HeatApplied': return `Heat: ${n(ev.unitId)} ${ev.before} → ${ev.after}.`
    case 'UnitShutdown': return `${n(ev.unitId)} shuts down at heat ${ev.heat}.`
    case 'UnitRestarted': return `${n(ev.unitId)} powers back up.`
    case 'UnitDestroyed': return ev.effective ? `${n(ev.unitId)} is destroyed (${DESTROY_CAUSE_LABELS[ev.cause]}).` : `${n(ev.unitId)} is finished (${DESTROY_CAUSE_LABELS[ev.cause]}); it falls at the end of the phase.`
    case 'UnitExited': return `${n(ev.unitId)} leaves the field by the ${ev.edge} edge.`
    case 'GameEnded': return ev.result.winner ? `${sideName(state, ev.result.winner)} wins on turn ${ev.result.turn}.` : `The battle ends in a draw on turn ${ev.result.turn}.`
    default: return null
  }
}

/** Game-over cause words (50 §15). */
export function endCause(reason: string): string {
  switch (reason) {
    case 'eliminate': return "all enemy 'Mechs destroyed or crippled"
    case 'turnLimitBV': return 'turn limit'
    case 'objective': return 'objective'
    case 'draw': return 'draw'
    default: return reason
  }
}
