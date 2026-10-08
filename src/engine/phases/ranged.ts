// Ranged Attack Phase (10 §6-§7, INIT-010/012, 00 §5, §9.3, §9.7): selection, torso twist, the composite fire declaration,
// resolution in declaration order inside a simultaneous damage window, and the end-of-phase steps.
// Pure: state in, { state, events } out. Every roll goes through rng.roll() (inside damage.ts resolveAttack).
import type { DeclareFireAction, FireShot, TorsoTwistAction } from '../actions'
import type { GameEvent } from '../events'
import { beginWork, endWork } from '../dice'
import { resolveAttack } from '../damage'
import { addHeat } from '../heat'
import { beginPhase, finishPhase, startSelection } from '../initiative'
import type { Stepped } from '../initiative'
import { hexKey, canFire, distance, firingArc, onBoard, torsoFacing } from '../hex'
import type { MountArc } from '../hex'
import { computeLos, legWeaponsBlocked } from '../los'
import { effectivePos, directionFor } from '../physical'
import { aimedShotLegal, computeRangedTn, rangeBand, armCritsFor, sensorCrits } from '../tohit'
import { ammoRec, binsFor, defaultBin, effectiveProfile, equipRec, hasFlag, spendAmmo, weaponRec } from '../ammo'
import type { WeaponRec } from '../ammo'
import { collectHooks } from '../hooks'
import { hexAt, woodsPointsOf } from '../terrain'
import type {
  ArmLoc, AttackDirection, DataBundle, GameState, Hex, Id, Loc, LocalId, Mod, MountState, RangedDeclaration, Rejection, RejectionCode,
  Twist, UnitId, UnitState,
} from '../types'

export type { Stepped }
export interface FireOutcome extends Stepped {
  rejection?: Rejection
  /** Set when a shot needs a chooseAmmo answer first; the caller raises the decision and re-calls with `ammoChoices`. */
  ammoChoice?: { mountId: LocalId; bins: { binId: LocalId; ammo: Id; shots: number }[] }
}
const rej = (state: GameState, code: RejectionCode, message: string, detail?: Record<string, unknown>): FireOutcome => ({
  state, events: [], rejection: { code, message, ...(detail ? { detail } : {}) },
})

// ---------- phase start ----------
/** PhaseStarted for the Ranged Attack Phase and the first selection (loser first). */
export function startRangedPhase(state: GameState): Stepped {
  const b = beginPhase(state, 'rangedAttack', 'ranged.select')
  const sel = startSelection(b.state, 'rangedAttack')
  return { state: sel.state, events: [...b.events, ...sel.events] }
}

// ---------- torso twist (ARC-010..014) ----------
export interface TwistOptions { twistOptions: Twist[]; canFlip: boolean }
/** Twist and flip options for a unit that has not used its once-per-turn twist/flip (ARC-010/012/013). */
export function twistOptionsFor(state: GameState, unitId: UnitId): TwistOptions {
  const u = state.units[unitId]!
  if (u.prone || u.attacks.twistPhase !== null) return { twistOptions: [0], canFlip: false }
  const noActuators = (arm: ArmLoc): boolean => !u.slots[arm].some((s) => s.token === 'lowerArm' || s.token === 'hand')
  const split = Object.values(u.mounts).some((m) => m.split === 'LA' || m.split === 'RA')
  const canFlip = noActuators('LA') && noActuators('RA') && !split
  return { twistOptions: [0, -1, 1], canFlip }
}

/** Books a torso twist or arm flip (Ranged or Physical declaration, once per turn). */
export function applyTorsoTwist(state: GameState, a: TorsoTwistAction): Stepped & { rejection?: Rejection } {
  const u = state.units[a.unitId]
  if (!u) return { state, events: [], rejection: { code: 'E_UNKNOWN_UNIT', message: 'unknown unit' } }
  const keep = a.twist === 0 && !a.flip
  if (keep) return { state, events: [] }
  const opt = twistOptionsFor(state, a.unitId)
  if (u.attacks.twistPhase !== null || u.prone) return { state, events: [], rejection: { code: 'E_NO_TWIST', message: 'a twist or flip was already used this turn, or the unit is prone' } }
  if (a.twist !== 0 && a.flip) return { state, events: [], rejection: { code: 'E_NO_TWIST', message: 'twist and flip cannot be combined' } }
  if (a.flip && !opt.canFlip) return { state, events: [], rejection: { code: 'E_NO_TWIST', message: 'this unit cannot flip its arms' } }
  const next: UnitState = { ...u, attacks: { ...u.attacks, twist: a.twist, flipped: a.flip, twistPhase: state.phase } }
  return {
    state: { ...state, units: { ...state.units, [u.id]: next } },
    events: [{ type: 'TorsoTwisted', unitId: u.id, twist: a.twist, flipped: a.flip, phase: state.phase }],
  }
}

// ---------- evaluating one shot ----------
export function mountArcOf(m: MountState): MountArc {
  if (m.location === 'LA') return 'leftArm'
  if (m.location === 'RA') return 'rightArm'
  if (m.location === 'LL' || m.location === 'RL') return m.rear ? 'legRear' : 'leg'
  return m.rear ? 'rear' : 'torso'
}
const targetKey = (s: FireShot): string => (s.targetId ? s.targetId : `hex:${s.hex ? hexKey(s.hex) : '?'}`)
export const mountOperable = (u: UnitState, m: MountState): boolean => !m.destroyed && !m.jammed && !u.locs[m.location].destroyed

export interface ShotGeometry {
  mount: MountState
  weapon: WeaponRec
  prof: WeaponRec
  targetId: UnitId | null
  targetHex: Hex
  distance: number
  forward: boolean // target in the attacker's Forward arc (TOHIT-005)
  los: ReturnType<typeof computeLos>
  band: ReturnType<typeof rangeBand>
}

/** Arc, range and LOS facts for one shot, or the first reason it is illegal (00 §9.7 check order). */
function shotGeometry(state: GameState, data: DataBundle, a: UnitState, shot: FireShot, propArm: ArmLoc | null): ShotGeometry | Rejection {
  const mount = a.mounts[shot.mountId]
  if (!mount) return { code: 'E_UNKNOWN_WEAPON', message: `no weapon ${shot.mountId}` }
  const weapon = weaponRec(data, mount.item)
  if (!weapon) return { code: 'E_UNKNOWN_WEAPON', message: `${mount.item} is not a weapon` }
  if (!mountOperable(a, mount)) return { code: 'E_WEAPON_DESTROYED', message: 'that weapon cannot fire' }
  if (a.attacks.firedMounts.includes(mount.id)) return { code: 'E_WEAPON_USED', message: 'that weapon already fired this turn' }
  if (a.prone) {
    if (mount.location === 'LL' || mount.location === 'RL') return { code: 'E_PROP_ARM', message: 'leg weapons cannot fire from prone' }
    if (propArm && (mount.location === propArm || mount.split === propArm)) return { code: 'E_PROP_ARM', message: 'the propping arm cannot fire' }
  }
  // target
  let targetId: UnitId | null = null
  let targetHex: Hex
  let targetProne = false
  if (shot.targetId) {
    const t = state.units[shot.targetId]
    if (!t) return { code: 'E_UNKNOWN_UNIT', message: `unknown target ${shot.targetId}` }
    if (t.owner === a.owner) return { code: 'E_FRIENDLY_TARGET', message: 'cannot target a friendly unit' }
    const tp = effectivePos(t)
    if (!tp || (t.status !== 'active' && t.status !== 'withdrawing') || t.doomed) return { code: 'E_BAD_TARGET', message: 'target is not on the board' }
    targetId = t.id; targetHex = tp; targetProne = t.prone
  } else {
    if (!shot.hex) return { code: 'E_BAD_PAYLOAD', message: 'an empty-hex shot needs a hex' }
    if (!onBoard(state.board, shot.hex)) return { code: 'E_OFF_BOARD', message: 'hex is off the board' }
    targetHex = shot.hex
  }
  const aPos = effectivePos(a)!
  // arc
  const arcName = mountArcOf(mount)
  const feet = a.facing
  const twist = a.prone ? 0 : a.attacks.twist
  const flipped = a.attacks.flipped && !a.prone
  const dist = distance(aPos, targetHex)
  if (!canFire(aPos, feet, twist, arcName, targetHex, { flipped })) return { code: 'E_OUT_OF_ARC', message: 'target is outside the weapon arc' }
  const forward = firingArc(aPos, torsoFacing(feet, twist), targetHex) === 'forward'
  // range
  const prof = effectiveProfile(weapon, shot.binId ? ammoRec(data, a.bins[shot.binId]?.ammo ?? '') : null)
  const ranges = prof.ranges ?? weapon.ranges
  if (!ranges) return { code: 'E_UNKNOWN_WEAPON', message: 'weapon has no range data' }
  const band = rangeBand(dist, ranges)
  if (band === 'out') return { code: 'E_OUT_OF_RANGE', message: 'target is beyond long range' }
  // LOS
  const key = `${a.id}>${targetId ?? hexKey(targetHex)}`
  const choice = state.choices.los[key] ?? null
  const los = computeLos(state.board, { hex: aPos, prone: a.prone }, { hex: targetHex, prone: targetProne }, { choice })
  if (!los.visible) return { code: 'E_NO_LOS', message: 'no line of sight' }
  if (!los.attackAllowed) return { code: 'E_WATER_LINE', message: 'a submerged unit and a unit on land cannot shoot each other' }
  if ((mount.location === 'LL' || mount.location === 'RL') && legWeaponsBlocked(state.board, { hex: aPos, prone: a.prone }, { hex: targetHex, prone: targetProne }, { choice })) {
    return { code: 'E_NO_LOS', message: 'leg weapons are blocked here' }
  }
  return { mount, weapon, prof, targetId, targetHex, distance: dist, forward, los, band }
}

export interface ShotTn { tn: number; mods: Mod[]; legal: boolean; pHit: number; autoHit: boolean }

function hookMods(state: GameState, unitId: UnitId, mountId: LocalId, targetId: UnitId | null): Mod[] {
  let bound
  try { bound = collectHooks(state, unitId, 'toHit') } catch { return [] }
  const out: Mod[] = []
  for (const b of bound) {
    const ctx = { state, point: 'toHit' as const, unitId, sourceId: b.sourceId, mountId, ...(targetId ? { targetId } : {}) }
    const m = b.hook.toHit?.(ctx)
    if (m) out.push(...m)
  }
  return out
}

/** An intact targeting computer on the unit (EQUIP-001): a live mount of kind 'targetingComputer' in a live location. */
export function hasTargetingComputer(data: DataBundle, u: UnitState): boolean {
  return Object.values(u.mounts).some((m) => !m.destroyed && !u.locs[m.location].destroyed && equipRec(data, m.item)?.kind === 'targetingComputer')
}
/** EQUIP-001: the TC helps direct-fire weapons only, never missiles, cluster fire (LB-X cluster ammo, MG arrays) or MGs. */
export function tcEligible(prof: WeaponRec): boolean {
  // machine guns and flamers carry no flag of their own (data marks the MG directFire): excluded by id
  return hasFlag(prof, 'directFire') && !hasFlag(prof, 'cluster') && !hasFlag(prof, 'missile') && !hasFlag(prof, 'mgArray') && !/machine-gun|flamer/.test(prof.id)
}
const tcFor = (data: DataBundle, a: UnitState, prof: WeaponRec): boolean => tcEligible(prof) && hasTargetingComputer(data, a)

/** The target number for a shot whose geometry is already known (TOHIT-001..036). */
function shotTn(state: GameState, data: DataBundle, a: UnitState, g: ShotGeometry, shot: FireShot, secondary: boolean): ShotTn {
  const t = g.targetId ? state.units[g.targetId]! : null
  const bhT = hexAt(state.board, g.targetHex)
  const immobile = t ? state.ledger.immobileAtStart.includes(t.id) : false
  const tc = tcFor(data, a, g.prof)
  const aimed = shot.aimedAt
    ? { at: shot.aimedAt, targetImmobile: immobile, tc, pulse: hasFlag(g.prof, 'pulse') }
    : null
  const r = computeRangedTn({
    gunnery: a.pilot.gunnery, distance: g.distance, band: g.band,
    ...(g.prof.ranges?.min ? { minRange: g.prof.ranges.min } : {}),
    weaponMod: g.prof.toHitMod ?? 0,
    attackerMode: a.move.mode, attackerProne: a.prone, attackerHeat: a.heat,
    target: t
      ? {
          tmm: t.move.tmm - (t.move.jumped ? 1 : 0), jumped: t.move.jumped, prone: t.prone, adjacent: g.distance <= 1,
          immobile, woods: bhT?.woods ?? 'none',
        }
      : null,
    interveningWoods: g.los.woodsPoints,
    partialCover: g.los.partialCover,
    secondary,
    sensorCrits: sensorCrits(a),
    armCrits: armCritsFor(a, g.mount.location),
    aimed,
    targetingComputer: tc,
    extra: hookMods(state, a.id, g.mount.id, g.targetId),
  })
  return r
}

const NO_AIM_FLAGS = ['cluster', 'missile', 'indirect', 'mgArray']

/**
 * The bin a shot draws from for its profile (ammo overrides change ranges): the shot's own bin, an answered chooseAmmo, else the
 * 00 §9.4 default (fewest shots, ties by record order) among live bins with enough shots. Undefined for weapons without ammo.
 */
export function ammoBinFor(a: UnitState, data: DataBundle, sh: FireShot, choices?: Record<LocalId, LocalId>): LocalId | undefined {
  if (sh.binId) return sh.binId
  const m = a.mounts[sh.mountId]
  if (!m) return undefined
  const w = weaponRec(data, m.item)
  if (!w?.ammo?.length) return undefined
  const c = choices?.[sh.mountId]
  if (c) return c
  const spend = sh.rapidShots ?? 1
  const usable = binsFor(a, w).filter((b) => b.shots >= spend && !a.locs[b.location].destroyed)
  if (usable.length === 0) return undefined
  return [...usable].sort((x, y) => x.shots - y.shots)[0]!.id
}

// ---------- one shot for previews (query.attackPreview / firePreview) ----------
export interface ShotEval {
  rejection: Rejection | null
  geometry: ShotGeometry | null
  tn: ShotTn | null
  binId: LocalId | null
  ammoId: Id | null
}
/**
 * The per-shot checks of declareFire (unit, prop arm, weapon, target, arc, range, LOS, rapid mode, ammo, aimed shot, TN) for
 * ONE shot, with `secondary` deciding TOHIT-024. Returns the first rejection plus whatever numbers were reached (a TN above 12
 * still reports its breakdown). An ammo choice between types is not a rejection: the preview takes the default-type bin.
 */
export function evaluateShot(state: GameState, data: DataBundle, unitId: UnitId, sh: FireShot, opts: { secondary: boolean; propArm?: ArmLoc }): ShotEval {
  const out: ShotEval = { rejection: null, geometry: null, tn: null, binId: null, ammoId: null }
  const no = (code: RejectionCode, message: string): ShotEval => ({ ...out, rejection: { code, message } })
  const a = state.units[unitId]
  if (!a) return no('E_UNKNOWN_UNIT', `unknown unit ${unitId}`)
  if (a.status !== 'active' && a.status !== 'withdrawing') return no('E_NOT_ELIGIBLE', 'unit is not on the board')
  if (a.shutdown) return no('E_SHUTDOWN', 'a shut-down unit makes no ranged attack')
  if (!a.pilot.conscious || a.pilot.dead) return no('E_UNCONSCIOUS', 'an unconscious pilot makes no ranged attack')
  if (a.attacks.charge || a.attacks.dfa) return no('E_NO_RANGED', 'a unit that declared a charge or DFA makes no ranged attack')
  if (sensorCrits(a) >= 2) return no('E_NO_RANGED', 'sensors are gone: no ranged attack')
  let propArm: ArmLoc | null = null
  if (a.prone) {
    const intact = (['LA', 'RA'] as const).filter((l) => !a.locs[l].destroyed)
    if (intact.length === 0) return no('E_PROP_ARM', 'a prone unit needs an intact arm to fire')
    if (opts.propArm && !intact.includes(opts.propArm)) return no('E_PROP_ARM', 'that arm cannot prop the unit')
    propArm = opts.propArm ?? (intact.length === 1 ? intact[0]! : (['LA', 'RA'] as const).reduce((best, l) => {
      const n = (x: ArmLoc): number => Object.values(a.mounts).filter((m) => m.location === x).length
      return n(l) < n(best) ? l : best
    }))
  } else if (opts.propArm) return no('E_PROP_ARM', 'only a prone unit props an arm')
  const bin0 = ammoBinFor(a, data, sh)
  const g = shotGeometry(state, data, a, bin0 ? { ...sh, binId: bin0 } : sh, propArm)
  if ('code' in g) return { ...out, rejection: g }
  out.geometry = g
  const rapid = sh.rapidShots ?? null
  if (rapid !== null && (!g.prof.rapidFire || !g.prof.rapidFire.modes.includes(rapid))) return no('E_RAPID_MODE', 'not a rapid-fire mode of this weapon')
  const spend = rapid ?? 1
  if (g.weapon.ammo && g.weapon.ammo.length > 0) {
    const live = (b: { location: Loc }): boolean => !a.locs[b.location].destroyed
    if (sh.binId) {
      const b = a.bins[sh.binId]
      if (!b) return no('E_WRONG_AMMO', 'unknown ammo bin')
      if (!g.weapon.ammo.includes(b.ammo)) return no('E_WRONG_AMMO', 'that ammo does not fit this weapon')
      if (b.exploded || b.shots < spend || !live(b)) return no('E_NO_AMMO', 'not enough ammo in that bin')
      out.binId = b.id; out.ammoId = b.ammo
    } else {
      const usable = binsFor(a, g.weapon).filter((b) => b.shots >= spend && live(b))
      if (usable.length === 0) return no('E_NO_AMMO', 'no ammo for this weapon')
      const pick = a.bins[ammoBinFor(a, data, sh) ?? '']!
      out.binId = pick.id; out.ammoId = pick.ammo
    }
  }
  if (sh.aimedAt) {
    const immobile = g.targetId ? state.ledger.immobileAtStart.includes(g.targetId) : false
    const allows = !g.prof.flags?.some((f) => NO_AIM_FLAGS.includes(f)) && g.targetId !== null
    const ok = allows && aimedShotLegal({ at: sh.aimedAt, targetImmobile: immobile, tc: tcFor(data, a, g.prof), pulse: hasFlag(g.prof, 'pulse'), weaponAllowsAim: true, partialCover: g.los.partialCover })
    if (!ok) return no('E_AIMED_SHOT', 'an aimed shot is not allowed here')
  }
  const tn = shotTn(state, data, a, g, sh, opts.secondary)
  out.tn = tn
  if (!tn.legal) return { ...out, rejection: { code: 'E_TN_TOO_HIGH', message: 'target number above 12', detail: { tn: tn.tn } } }
  return out
}

// ---------- declaration ----------
export interface FireOptions {
  /** Answers to earlier chooseAmmo decisions, mount id -> bin id. */
  ammoChoices?: Record<LocalId, LocalId>
}

/**
 * Validates and books a unit's whole ranged declaration (00 §9.7). Any bad shot rejects the whole action. Books
 * `RangedDeclaration`s with frozen TN, spends ammo and adds heat (Streak: both wait for the hit, CLUS-005), emits
 * FireDeclared, AmmoSpent and HeatAdded. A shot that needs a chooseAmmo answer returns `ammoChoice` and books nothing.
 */
export function declareFire(state: GameState, data: DataBundle, action: DeclareFireAction, opts: FireOptions = {}): FireOutcome {
  const a = state.units[action.unitId]
  if (!a) return rej(state, 'E_UNKNOWN_UNIT', `unknown unit ${action.unitId}`)
  if (a.owner !== action.player) return rej(state, 'E_NOT_YOUR_UNIT', 'not your unit')
  if (a.status !== 'active' && a.status !== 'withdrawing') return rej(state, 'E_NOT_ELIGIBLE', 'unit is not on the board')
  if (a.shutdown) return rej(state, 'E_SHUTDOWN', 'a shut-down unit makes no ranged attack')
  if (!a.pilot.conscious || a.pilot.dead) return rej(state, 'E_UNCONSCIOUS', 'an unconscious pilot makes no ranged attack')
  if (a.attacks.rangedDeclared) return rej(state, 'E_DUPLICATE', 'already declared this phase')
  const shots = action.shots
  if (shots.length === 0) {
    const u2: UnitState = { ...a, attacks: { ...a.attacks, rangedDeclared: true } }
    return { state: { ...state, units: { ...state.units, [a.id]: u2 } }, events: [{ type: 'FireDeclared', unitId: a.id, primaryTargetId: null, shots: [] }] }
  }
  if (a.attacks.charge || a.attacks.dfa) return rej(state, 'E_NO_RANGED', 'a unit that declared a charge or DFA makes no ranged attack')
  if (sensorCrits(a) >= 2) return rej(state, 'E_NO_RANGED', 'sensors are gone: no ranged attack')

  // prop arm (TOHIT-008)
  let propArm: ArmLoc | null = null
  if (a.prone) {
    const intact = (['LA', 'RA'] as const).filter((l) => !a.locs[l].destroyed)
    if (intact.length === 0) return rej(state, 'E_PROP_ARM', 'a prone unit needs an intact arm to fire')
    if (action.propArm && !intact.includes(action.propArm)) return rej(state, 'E_PROP_ARM', 'that arm cannot prop the unit')
    propArm = action.propArm ?? (intact.length === 1 ? intact[0]! : (['LA', 'RA'] as const).reduce((best, l) => {
      const n = (x: ArmLoc): number => Object.values(a.mounts).filter((m) => m.location === x).length
      return n(l) < n(best) ? l : best
    }))
  } else if (action.propArm) return rej(state, 'E_PROP_ARM', 'only a prone unit props an arm')

  // pass 1: geometry per shot (weapon, target, arc, range, LOS)
  const seen = new Set<LocalId>()
  const geos: ShotGeometry[] = []
  for (const sh of shots) {
    if (seen.has(sh.mountId)) return rej(state, 'E_DUPLICATE', 'a weapon appears twice')
    seen.add(sh.mountId)
    const bin0 = ammoBinFor(a, data, sh, opts.ammoChoices)
    const g = shotGeometry(state, data, a, bin0 ? { ...sh, binId: bin0 } : sh, propArm)
    if ('code' in g) return { state, events: [], rejection: g }
    geos.push(g)
  }
  // TOHIT-005: primary target
  const first = targetKey(shots[0]!)
  const anyForward = geos.some((g) => g.forward)
  if (anyForward && !geos[0]!.forward) return rej(state, 'E_PRIMARY_TARGET', 'a Forward-arc target must be primary')

  // pass 2: TN, ammo, aimed shot, rapid mode
  interface Plan { g: ShotGeometry; shot: FireShot; tn: ShotTn; binId: LocalId | null; ammoId: Id | null; spend: number; streak: boolean; primary: boolean }
  const plans: Plan[] = []
  let needChoice: FireOutcome['ammoChoice'] | undefined
  for (let i = 0; i < shots.length; i++) {
    const sh = shots[i]!, g = geos[i]!
    const secondary = targetKey(sh) !== first
    // rapid fire
    let rapid = sh.rapidShots ?? null
    if (rapid !== null) {
      if (!g.prof.rapidFire || !g.prof.rapidFire.modes.includes(rapid)) return rej(state, 'E_RAPID_MODE', 'not a rapid-fire mode of this weapon')
    }
    if (g.prof.rapidFire && rapid === null) rapid = null
    // ammo
    let binId: LocalId | null = null
    let ammoId: Id | null = null
    const streak = hasFlag(g.prof, 'streak')
    const spend = rapid ?? 1
    if (g.weapon.ammo && g.weapon.ammo.length > 0) {
      const live = (b: { location: Loc }): boolean => !a.locs[b.location as Loc].destroyed
      if (sh.binId) {
        const b = a.bins[sh.binId]
        if (!b) return rej(state, 'E_WRONG_AMMO', 'unknown ammo bin')
        if (!g.weapon.ammo.includes(b.ammo)) return rej(state, 'E_WRONG_AMMO', 'that ammo does not fit this weapon')
        if (b.exploded || b.shots < spend || !live(b)) return rej(state, 'E_NO_AMMO', 'not enough ammo in that bin')
        binId = b.id; ammoId = b.ammo
      } else {
        const usable = binsFor(a, g.weapon).filter((b) => b.shots >= spend && live(b))
        if (usable.length === 0) return rej(state, 'E_NO_AMMO', 'no ammo for this weapon')
        const types = new Set(usable.map((b) => b.ammo))
        const chosen = opts.ammoChoices?.[sh.mountId]
        if (types.size > 1 && !chosen && !needChoice) {
          // the controller picks the ammo type; keep checking the remaining shots first so a later bad shot still rejects
          needChoice = { mountId: sh.mountId, bins: usable.map((b) => ({ binId: b.id, ammo: b.ammo, shots: b.shots })) }
        }
        const pick = needChoice?.mountId === sh.mountId ? ammoBinFor(a, data, sh) : chosen ? usable.find((b) => b.id === chosen) : defaultBin({ ...a, bins: Object.fromEntries(usable.map((b) => [b.id, b])) } as UnitState, g.weapon, spend).binId
        const bin = typeof pick === 'object' ? pick : pick ? a.bins[pick] : undefined
        if (!bin) return rej(state, 'E_WRONG_AMMO', 'that ammo choice is not available')
        binId = bin.id; ammoId = bin.ammo
      }
    }
    // aimed shot
    if (sh.aimedAt) {
      const immobile = g.targetId ? state.ledger.immobileAtStart.includes(g.targetId) : false
      const allows = !g.prof.flags?.some((f) => NO_AIM_FLAGS.includes(f)) && g.targetId !== null
      const ok = allows && aimedShotLegal({ at: sh.aimedAt, targetImmobile: immobile, tc: tcFor(data, a, g.prof), pulse: hasFlag(g.prof, 'pulse'), weaponAllowsAim: true, partialCover: g.los.partialCover })
      if (!ok) return rej(state, 'E_AIMED_SHOT', 'an aimed shot is not allowed here')
    }
    const tn = shotTn(state, data, a, { ...g, prof: g.prof }, sh, secondary)
    if (!tn.legal) return rej(state, sensorCrits(a) >= 2 ? 'E_NO_RANGED' : 'E_TN_TOO_HIGH', 'target number above 12', { tn: tn.tn })
    plans.push({ g, shot: sh, tn, binId, ammoId, spend, streak, primary: !secondary })
  }
  if (needChoice) return { state, events: [], ammoChoice: needChoice }

  // book it
  let s = state
  const events: GameEvent[] = []
  const declsOut: RangedDeclaration[] = []
  const fired: LocalId[] = []
  let seq = s.attackSeq
  const evShots: Extract<GameEvent, { type: 'FireDeclared' }>['shots'] = []
  let table = s
  for (const p of plans) {
    seq++
    const attackId = `a:${seq}`
    let direction: AttackDirection = 'front'
    if (p.g.targetId) {
      const d = directionFor(table, a.id, p.g.targetId, effectivePos(a)!)
      direction = d.direction; table = d.state
    }
    declsOut.push({
      kind: 'ranged', attackId, attackerId: a.id, mountId: p.g.mount.id, targetId: p.g.targetId, targetHex: p.g.targetHex,
      binId: p.binId, ammoId: p.ammoId, rapidShots: p.shot.rapidShots ?? null, aimedAt: p.shot.aimedAt ?? null, primary: p.primary,
      tn: p.tn.tn, mods: p.tn.mods, distance: p.g.distance, band: p.g.band, direction, table: 'standard', partialCover: p.g.los.partialCover,
    })
    evShots.push({ attackId, mountId: p.g.mount.id, targetId: p.g.targetId, binId: p.binId, tn: p.tn.tn, band: p.g.band, aimedAt: p.shot.aimedAt ?? null })
    fired.push(p.g.mount.id)
  }
  const primaryTarget = shots[0]!.targetId ?? null
  events.push({ type: 'FireDeclared', unitId: a.id, primaryTargetId: primaryTarget, shots: evShots })
  s = { ...table, attackSeq: seq }
  // ammo and heat per shot
  const w2 = beginWork(s, data)
  for (const p of plans) {
    if (p.binId && !p.streak) spendAmmo(w2, a.id, p.binId, p.spend)
  }
  const ammoDone = endWork(w2)
  s = ammoDone.state
  events.push(...ammoDone.events)
  for (const p of plans) {
    const base = p.g.prof.heat ?? 0
    if (p.streak || base <= 0) continue
    const rapid = p.shot.rapidShots ?? 1
    const h = addHeat(s, a.id, { source: 'weapon', amount: base * rapid, ref: p.g.mount.id })
    s = h.state
    events.push(...h.events)
  }
  const ua = s.units[a.id]!
  const mounts = { ...ua.mounts }
  for (const id of fired) mounts[id] = { ...mounts[id]!, firedTurn: s.turn }
  s = {
    ...s,
    units: {
      ...s.units,
      [a.id]: {
        ...ua, mounts,
        attacks: { ...ua.attacks, rangedDeclared: true, primaryTargetId: primaryTarget, propArm: propArm ?? ua.attacks.propArm, firedMounts: [...ua.attacks.firedMounts, ...fired] },
      },
    },
    declarations: [...s.declarations, ...declsOut],
  }
  return { state: s, events }
}

/** Continuation of a declaration that stopped for chooseAmmo (00 §9.3): `state.resume` carries the action and the answers so far. */
export function resumeDeclareFire(state: GameState, data: DataBundle, mountId: LocalId, binId: LocalId): FireOutcome {
  const r = state.resume
  if (!r || r.code !== 'declareFire') return rej(state, 'E_WRONG_DECISION', 'no declaration is waiting for an ammo choice')
  const action = r.data.action as DeclareFireAction
  const choices = { ...(r.data.choices as Record<LocalId, LocalId>), [mountId]: binId }
  const out = declareFire({ ...state, resume: null }, data, action, { ammoChoices: choices })
  if (out.ammoChoice) return { ...out, state: { ...state, resume: { code: 'declareFire', data: { action, choices } } } }
  return out
}
/** Parks a declaration that needs an ammo answer in `state.resume`. */
export function parkDeclaration(state: GameState, action: DeclareFireAction, choices: Record<LocalId, LocalId> = {}): GameState {
  return { ...state, resume: { code: 'declareFire', data: { action, choices } } }
}

// ---------- what a unit may shoot (decision context, legalActions, AI) ----------
/** Every single shot that is legal on its own (mount order x target order), for the declareFire context and legalActions. */
export function legalShots(state: GameState, data: DataBundle, unitId: UnitId): FireShot[] {
  const a = state.units[unitId]
  if (!a || a.attacks.rangedDeclared || a.attacks.charge || a.attacks.dfa) return []
  const out: FireShot[] = []
  for (const m of Object.values(a.mounts)) {
    for (const id of state.unitOrder) {
      const t = state.units[id]!
      if (t.owner === a.owner) continue
      const sh: FireShot = { mountId: m.id, targetId: id }
      const r = declareFire(state, data, { type: 'declareFire', decisionId: '', player: a.owner, unitId, shots: [sh] }, {})
      if (!r.rejection && !r.ammoChoice) out.push(sh)
      else if (r.ammoChoice) out.push(sh)
    }
  }
  return out
}
/** Enemy units some weapon of this unit could legally fire at. */
export function fireTargets(state: GameState, data: DataBundle, unitId: UnitId): UnitId[] {
  const ids = new Set<UnitId>()
  for (const s of legalShots(state, data, unitId)) if (s.targetId) ids.add(s.targetId)
  return [...ids]
}

// ---------- resolution ----------
/**
 * Resolves every declaration in order inside a simultaneous damage window (INIT-010/012), then returns to the immediate window.
 * Streak heat is booked on a hit. Does not run the end-of-phase steps; see finishRangedPhase.
 */
export function resolveRanged(state: GameState, data: DataBundle, opts: { floatingCrits?: boolean } = {}): Stepped {
  let s: GameState = { ...state, step: 'ranged.resolve', damageWindow: 'simultaneous', resolveIndex: 0 }
  const events: GameEvent[] = []
  const decls = state.declarations
  for (let i = 0; i < decls.length; i++) {
    const d = decls[i]!
    if (d.kind !== 'ranged') continue
    s = { ...s, resolveIndex: i }
    const r = resolveAttack(s, d, { data, ...(opts.floatingCrits ? { floatingCrits: true } : {}) })
    s = r.state; events.push(...r.events)
    if (r.streakHit) {
      const mount = s.units[d.attackerId]!.mounts[d.mountId]
      const heat = mount ? weaponRec(data, mount.item)?.heat ?? 0 : 0
      const h = addHeat(s, d.attackerId, { source: 'weapon', amount: heat, ref: d.mountId })
      s = h.state; events.push(...h.events)
    }
  }
  s = { ...s, resolveIndex: decls.length, damageWindow: 'immediate', step: 'ranged.endOfPhase' }
  return { state: s, events }
}

/** 00 §5.4 (a)-(e) for the Ranged Attack Phase. */
export function finishRangedPhase(state: GameState): Stepped {
  return finishPhase({ ...state, step: 'ranged.endOfPhase' })
}

/** Resolution plus end-of-phase in one call (the phase machine's `ranged.resolve` -> `ranged.endOfPhase`). */
export function runRangedResolution(state: GameState, data: DataBundle, opts: { floatingCrits?: boolean } = {}): Stepped {
  const a = resolveRanged(state, data, opts)
  const b = finishRangedPhase(a.state)
  return { state: b.state, events: [...a.events, ...b.events] }
}

