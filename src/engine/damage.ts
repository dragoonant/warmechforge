// The ONE damage pipeline (00 §6, 10 §10): armor -> internal -> transfer -> crit check -> destruction, explosions with the
// 2026 caps and CASE / CASE II, the 20-point PSR tally, and attack resolution (to-hit, aimed, cluster, location, damage).
// Pure at the edge: state in, { state, events } out. Inside, a Work context holds lazily cloned units.
import type { AmmoExploded, ComponentDestroyed, ComponentExploded, DamageApplied, DamageSourceKind, GameEvent, LocationDestroyed } from './events'
import type {
  ArmorSide, AttackContext, AttackDirection, AttackId, DataBundle, DestroyCause, GameState, HitTable, Loc, LocalId, LocState, RangedDeclaration, UnitId,
} from './types'
import { beginWork, endWork, roll1d6, roll2d6, unitOf, viaState } from './dice'
import type { Work } from './dice'
import { caseAt, hasExplosive, binExplosionRaw, CASE_CAP, EXPLOSION_CAP, effectiveProfile, hasFlag, ammoRec, weaponRec, spendAmmo, pickHeatExplosionBin } from './ammo'
import { artemisClusterMod, rollCluster } from './cluster'
import { critCheckW, engineSlotsLost } from './crits'
import { isTorso, rollHitLocation, sideFor } from './hitloc'
import { addPilotHit } from './pilot'
import { queuePsr, fallDeps } from './psr'
import type { PsrRequest } from './psr'
import { heatDeps } from './heat'
import { bundleFor } from './index'

export interface Stepped { state: GameState; events: GameEvent[] }

/** DMG-005 transfer map. HD and CT never transfer. */
export const TRANSFER: Readonly<Partial<Record<Loc, Loc>>> = { LA: 'LT', LL: 'LT', RA: 'RT', RL: 'RT', LT: 'CT', RT: 'CT' }

export interface DamageInstance {
  unitId: UnitId
  amount: number
  location: Loc
  side: ArmorSide
  source: DamageSourceKind
  sourceUnitId?: UnitId | null
  attackId?: AttackId | null
  internal?: boolean // structure only, skips armor (DMG-007)
  noTransfer?: boolean // CASE: excess is lost
  /** Explosion damage: CASE state of each location the damage moves INTO (AMMO-011/012, v7.01 errata). */
  confine?: (loc: Loc) => 'none' | 'case' | 'caseII'
  onConfined?: (loc: Loc, amount: number, cs: 'case' | 'caseII') => void
}

// ---------- small shared effects (also used by crits.ts) ----------
export function queuePsrW(w: Work, req: PsrRequest): void {
  viaState(w, (s) => queuePsr(s, req))
}
export function pilotHitW(w: Work, unitId: UnitId, cause: 'head' | 'seatbelt' | 'explosion'): void {
  viaState(w, (s) => addPilotHit(s, unitId, cause))
}
/** Pilot killed outright (head or cockpit gone, CT explosion): sets 6 hits and dead without a consciousness check. */
export function killPilotW(w: Work, unitId: UnitId): void {
  const u = unitOf(w, unitId)
  if (u.pilot.dead) return
  u.pilot.hits = 6
  u.pilot.dead = true
  u.pilot.conscious = false
  w.ev.push({ type: 'PilotKilled', unitId })
}
/** Books (simultaneous window) or applies (immediate) a unit's destruction (00 §5.3). */
export function destroyUnitW(w: Work, unitId: UnitId, cause: DestroyCause): void {
  const u = unitOf(w, unitId)
  if (u.status === 'destroyed' || u.doomed) return
  if (w.s.damageWindow === 'simultaneous') {
    u.doomed = cause
    w.ev.push({ type: 'UnitDestroyed', unitId, cause, effective: false })
  } else {
    const was = u.status
    u.status = 'destroyed'
    u.destroyedCause = cause
    w.ev.push({ type: 'UnitDestroyed', unitId, cause, effective: true })
    w.ev.push({ type: 'StatusChanged', unitId, status: 'destroyed', crippled: u.crippled, was })
  }
}

const psrWhen = (w: Work): PsrRequest['when'] => (w.s.phase === 'movement' ? 'now' : 'endOfPhase')

/** DMG tally for the 20-point PSR (PSR-015): armor + structure removed this phase. */
function tally(w: Work, unitId: UnitId, n: number): void {
  if (n <= 0) return
  const before = w.ledger.damage[unitId] ?? 0
  const after = before + n
  w.ledger.damage[unitId] = after
  if (before < 20 && after >= 20 && !w.ledger.damage20.includes(unitId)) {
    w.ledger.damage20.push(unitId)
    queuePsrW(w, { unitId, reason: 'damage20', mod: 1, auto: false, when: 'endOfPhase' })
  }
}

// ---------- location destruction ----------
type DestroyCauseLoc = LocationDestroyed['cause']

export function destroyLocationW(w: Work, unitId: UnitId, loc: Loc, cause: DestroyCauseLoc): void {
  const u0 = unitOf(w, unitId)
  const L = u0.locs[loc]
  if (L.destroyed) return
  const armorLost = L.armor + (L.rear ?? 0)
  L.armor = 0
  if (L.rear !== null) L.rear = 0
  L.structure = 0
  L.destroyed = true
  L.destroyedCause = cause
  w.ev.push({ type: 'LocationDestroyed', unitId, location: loc, cause, armorLost })
  if (cause === 'damage' || cause === 'explosion') tally(w, unitId, armorLost) // DMG-010; blown-off / side-torso arms are not counted (DMG-011/013)

  if (loc === 'HD') {
    killPilotW(w, unitId)
    destroyUnitW(w, unitId, 'headDestroyed')
    return
  }
  if (loc === 'CT') {
    if (cause === 'explosion') killPilotW(w, unitId)
    destroyUnitW(w, unitId, 'ctDestroyed')
    return
  }
  // CRIT-005: a location destroyed by damage still gets a crit check if it holds something explosive
  if ((cause === 'damage' || cause === 'explosion') && hasExplosive(w.data, unitOf(w, unitId), loc)) {
    critCheckW(w, { unitId, location: loc, why: 'explosive' })
  }
  // DMG-010: its items are destroyed; ammo left in it is lost (it does not explode on blow-off, CRIT-004)
  const u = unitOf(w, unitId)
  for (const m of Object.values(u.mounts)) {
    if (m.destroyed || (m.location !== loc && m.split !== loc)) continue
    m.destroyed = true
    const ev: ComponentDestroyed = { type: 'ComponentDestroyed', unitId, mountId: m.id, token: `#${m.id}`, location: m.location }
    w.ev.push(ev)
  }
  for (const b of Object.values(u.bins)) if (b.location === loc && !b.exploded) b.shots = 0

  if (loc === 'LT' || loc === 'RT') {
    destroyLocationW(w, unitId, loc === 'LT' ? 'LA' : 'RA', 'sideTorso') // DMG-011
    engineSlotsLost(w, unitId, loc)
  }
  if (loc === 'LL' || loc === 'RL') {
    const other = loc === 'LL' ? 'RL' : 'LL'
    const both = unitOf(w, unitId).locs[other].destroyed
    queuePsrW(w, { unitId, reason: both ? 'bothLegs' : 'legDestroyed', mod: 0, auto: true, when: psrWhen(w) })
  }
}

// ---------- the damage pipeline ----------
/** Applies one damage instance location by location. Returns armor + structure removed (not counting what was lost). */
export function applyDamageW(w: Work, inst: DamageInstance): number {
  const id = inst.unitId
  let loc = inst.location as Loc | null
  let amt: number = inst.amount
  const rearAttack = inst.side === 'rear'
  let dealt = 0
  if (inst.location === 'HD' && !inst.internal && amt > 0) pilotHitW(w, id, 'head') // even if armor absorbs it
  while (amt > 0 && loc !== null) {
    const cur: Loc = loc
    const L: LocState = unitOf(w, id).locs[cur]
    if (inst.confine && cur !== inst.location && !L.destroyed) {
      const cs = inst.confine(cur)
      if (cs !== 'none') { inst.onConfined?.(cur, amt, cs); break } // the blast stops in a CASE / CASE II location
    }
    const side: ArmorSide = rearAttack && !inst.internal && isTorso(cur) ? 'rear' : 'front'
    const next: Loc | null = inst.noTransfer ? null : TRANSFER[cur] ?? null
    const base = {
      type: 'DamageApplied' as const, unitId: id, source: inst.source, sourceUnitId: inst.sourceUnitId ?? null,
      attackId: inst.attackId ?? null, location: cur, side,
    }
    if (L.destroyed) {
      // DMG-003: a hit rolling a destroyed location transfers in full
      const armor = side === 'rear' ? L.rear ?? 0 : L.armor
      const ev: DamageApplied = {
        ...base, damage: amt, armorBefore: armor, armorAfter: armor, structureBefore: 0, structureAfter: 0,
        transferredTo: next, transferred: next ? amt : 0, lost: next ? 0 : amt,
      }
      w.ev.push(ev)
      if (!next) break
      loc = next
      continue
    }
    const armorBefore: number = side === 'rear' ? L.rear ?? 0 : L.armor
    const structBefore = L.structure
    const absorbed: number = inst.internal ? 0 : Math.min(amt, armorBefore)
    if (side === 'rear') L.rear = armorBefore - absorbed
    else L.armor = armorBefore - absorbed
    const rest: number = amt - absorbed
    const sdmg = Math.min(rest, structBefore)
    L.structure = structBefore - sdmg
    const excess: number = rest - sdmg
    const destroyedNow = L.structure === 0
    const transfers: boolean = destroyedNow && excess > 0 && next !== null
    const ev: DamageApplied = {
      ...base, damage: amt, armorBefore, armorAfter: armorBefore - absorbed, structureBefore: structBefore, structureAfter: structBefore - sdmg,
      transferredTo: transfers ? next : null, transferred: transfers ? excess : 0, lost: excess > 0 && !transfers ? excess : 0,
    }
    w.ev.push(ev)
    dealt += absorbed + sdmg
    tally(w, id, absorbed + sdmg)
    if (sdmg > 0 && !destroyedNow) critCheckW(w, { unitId: id, location: cur, why: 'structure' })
    else if (destroyedNow) destroyLocationW(w, id, cur, inst.internal ? 'explosion' : 'damage')
    amt = transfers ? excess : 0
    loc = transfers ? next : null
  }
  return dealt
}

/** The public entry point (falls, physical self-damage, anything outside an attack). `data` defaults to the registered bundle. */
export function applyDamage(state: GameState, inst: DamageInstance, data?: DataBundle): Stepped {
  const w = beginWork(state, data ?? bundleFor(state))
  applyDamageW(w, inst)
  return endWork(w)
}

// ---------- explosions (AMMO-010..020) ----------
/** Internal explosion damage at a location, honouring CASE (cap 10, confined, rear armor lost) and CASE II. */
function explosionDamageW(w: Work, unitId: UnitId, loc: Loc, dmg: number, source: 'ammoExplosion' | 'componentExplosion', cs: 'none' | 'case' | 'caseII'): void {
  if (dmg <= 0) return
  const common = { unitId, location: loc, side: 'front' as ArmorSide, source, internal: true }
  const confine = (l: Loc): 'none' | 'case' | 'caseII' => caseAt(w.data, unitOf(w, unitId), l)
  if (cs === 'none') {
    applyDamageW(w, { ...common, amount: dmg, confine, onConfined: (l, n, c) => explosionDamageW(w, unitId, l, n, source, c) })
    return
  }
  if (cs === 'case') {
    applyDamageW(w, { ...common, amount: dmg, noTransfer: true })
    const L = unitOf(w, unitId).locs[loc]
    if (isTorso(loc) && !L.destroyed && (L.rear ?? 0) > 0) { // AMMO-011: the torso's rear armor is lost (2026?)
      const rear = L.rear ?? 0
      L.rear = 0
      w.ev.push({
        type: 'DamageApplied', unitId, source, sourceUnitId: null, attackId: null, location: loc, side: 'rear', damage: rear,
        armorBefore: rear, armorAfter: 0, structureBefore: L.structure, structureAfter: L.structure, transferredTo: null, transferred: 0, lost: 0,
      })
      tally(w, unitId, rear)
    }
    return
  }
  // CASE II (AMMO-012): 1 point to structure, the rest to the location's armor (rear for torsos), excess lost
  applyDamageW(w, { ...common, amount: 1, noTransfer: true })
  const rest = dmg - 1
  if (rest <= 0) return
  const L = unitOf(w, unitId).locs[loc]
  const useRear = isTorso(loc)
  const before = useRear ? L.rear ?? 0 : L.armor
  const taken = L.destroyed ? 0 : Math.min(rest, before)
  if (useRear) L.rear = before - taken
  else L.armor = before - taken
  w.ev.push({
    type: 'DamageApplied', unitId, source, sourceUnitId: null, attackId: null, location: loc, side: useRear ? 'rear' : 'front', damage: rest,
    armorBefore: before, armorAfter: before - taken, structureBefore: L.structure, structureAfter: L.structure, transferredTo: null, transferred: 0, lost: rest - taken,
  })
  tally(w, unitId, taken)
}

/** AMMO-010: a bin explodes (crit or heat): damage = shots x per-shot, cap 20 (CASE 10), 1 pilot hit. */
export function explodeBinW(w: Work, unitId: UnitId, binId: LocalId, cause: 'crit' | 'heat'): void {
  const u = unitOf(w, unitId)
  const bin = u.bins[binId]
  if (!bin || bin.exploded) return
  const raw = binExplosionRaw(w.data, u, binId)
  if (raw <= 0) return
  const cs = caseAt(w.data, u, bin.location)
  const cap = cs === 'case' ? CASE_CAP : EXPLOSION_CAP
  const dmg = Math.min(raw, cap)
  const shots = bin.shots
  bin.exploded = true
  bin.shots = 0
  const ev: AmmoExploded = { type: 'AmmoExploded', unitId, binId, location: bin.location, shots, damage: dmg, capped: raw > dmg, cause }
  w.ev.push(ev)
  explosionDamageW(w, unitId, bin.location, dmg, 'ammoExplosion', cs)
  pilotHitW(w, unitId, 'explosion')
}

/** AMMO-020: a crit on an explosive component (Gauss) explodes it for 2 x slots, same caps; no ammo needed. */
export function explodeComponentW(w: Work, unitId: UnitId, mountId: LocalId): void {
  const u = unitOf(w, unitId)
  const m = u.mounts[mountId]
  if (!m) return
  let slots = 0
  for (const sl of Object.values(u.slots)) for (const s of sl) if (s.token === `#${mountId}`) slots++
  const raw = 2 * Math.max(1, slots)
  const cs = caseAt(w.data, u, m.location)
  const dmg = Math.min(raw, cs === 'case' ? CASE_CAP : EXPLOSION_CAP)
  const ev: ComponentExploded = { type: 'ComponentExploded', unitId, mountId, location: m.location, damage: dmg, capped: raw > dmg }
  w.ev.push(ev)
  explosionDamageW(w, unitId, m.location, dmg, 'componentExplosion', cs)
  pilotHitW(w, unitId, 'explosion')
}

export function explodeBin(state: GameState, unitId: UnitId, binId: LocalId, cause: 'crit' | 'heat' = 'heat', data?: DataBundle): Stepped {
  const w = beginWork(state, data ?? bundleFor(state))
  explodeBinW(w, unitId, binId, cause)
  return endWork(w)
}

// ---------- one damage group ----------
export interface GroupInput {
  attackId: AttackId | null
  attackerId: UnitId | null
  targetId: UnitId
  damage: number
  group: number // 1-based index in resolution order
  table: HitTable
  direction: AttackDirection
  partialCover?: boolean
  rerollLegs?: boolean // TOHIT-036: aimed shot under partial cover: a normal roll giving a leg is rolled again
  forcedLocation?: Loc | null // aimed shot on target (TOHIT-035)
  source: DamageSourceKind
  floatingCrits?: boolean
}
export interface GroupResult { location: Loc; dealt: number; absorbedByCover: boolean }

/** HITLOC-002: roll the location for one group and fully resolve it (damage, TAC) before the next. */
export function resolveGroupW(w: Work, g: GroupInput): GroupResult {
  w.legPsr.clear() // CRIT-095: the one-PSR-per-leg cap is per hit (damage group), not per attack
  const target = unitOf(w, g.targetId)
  let location: Loc
  let side: ArmorSide
  let tac = false
  let tacLocation: Loc | null = null
  if (g.forcedLocation) {
    location = g.forcedLocation
    side = sideFor(location, g.direction)
    w.ev.push({
      type: 'HitLocated', attackId: g.attackId, unitId: g.targetId, group: g.group, damage: g.damage, table: 'standard',
      direction: g.direction, roll: 0, location, side, tac: false,
    })
  } else {
    const spec = {
      attackId: g.attackId, unitId: g.targetId, table: g.table, direction: g.direction, prone: target.prone, group: g.group, damage: g.damage,
      ...(g.attackerId ? { attackerId: g.attackerId } : {}), ...(g.floatingCrits ? { floatingCrits: true } : {}),
    }
    let r = rollHitLocation(w, spec)
    for (let guard = 0; g.rerollLegs && (r.location === 'LL' || r.location === 'RL') && guard < 200; guard++) r = rollHitLocation(w, spec)
    location = r.location; side = r.side; tac = r.tac; tacLocation = r.tacLocation
  }
  if (g.partialCover && (location === 'LL' || location === 'RL')) {
    w.ev.push({ type: 'HitAbsorbedByCover', attackId: g.attackId, unitId: g.targetId, location, damage: g.damage })
    return { location, dealt: 0, absorbedByCover: true }
  }
  const dealt = applyDamageW(w, {
    unitId: g.targetId, amount: g.damage, location, side, source: g.source, sourceUnitId: g.attackerId, attackId: g.attackId,
  })
  if (tac && g.damage >= 1) {
    // HITLOC-004: crit check on that torso even if armor remains; a torso destroyed by now (this hit or earlier) sends it to CT
    let critLoc: Loc = tacLocation ?? location
    if (isTorso(critLoc) && critLoc !== 'CT' && unitOf(w, g.targetId).locs[critLoc].destroyed) critLoc = 'CT'
    critCheckW(w, { unitId: g.targetId, location: critLoc, why: 'tac' })
  }
  return { location, dealt, absorbedByCover: false }
}

// ---------- a ranged attack ----------
export interface AttackResult extends Stepped { hit: boolean; damageDealt: number; streakHit: boolean }
export interface ResolveOptions { floatingCrits?: boolean; data?: DataBundle }

function damagePer(prof: { damage: number | { short?: number; medium?: number; long?: number } }, band: RangedDeclaration['band']): number {
  const d = prof.damage
  if (typeof d === 'number') return d
  return (band === 'long' ? d.long : band === 'medium' ? d.medium : d.short) ?? d.short ?? 0
}

/**
 * Resolves one declared ranged shot (00 §6 steps 1-6): to-hit roll, aimed shot, cluster roll, a location roll per group and the
 * damage for each. Ammo and heat for non-Streak weapons are spent at declaration by the caller; a Streak hit spends its ammo here
 * (CLUS-005) and reports `streakHit` so the caller can book its heat.
 */
export function resolveAttack(state: GameState, decl: RangedDeclaration, opts: ResolveOptions = {}): AttackResult {
  const w = beginWork(state, opts.data ?? bundleFor(state))
  const { attackId, attackerId, targetId } = decl
  const attacker = unitOf(w, attackerId)
  const mount = attacker.mounts[decl.mountId]
  const weapon = mount ? weaponRec(w.data, mount.item) : null
  const prof = weapon ? effectiveProfile(weapon, decl.ammoId ? ammoRec(w.data, decl.ammoId) : null) : null

  const ctx: AttackContext = {
    attackId, attackerId, targetId, kind: 'ranged', mountId: decl.mountId, tn: decl.tn, mods: decl.mods, pHit: 0,
    direction: decl.direction, table: decl.table, stage: 'toHit', hit: null, groups: [], groupIndex: 0,
  }
  w.s = { ...w.s, current: ctx }
  const finish = (hit: boolean, damageDealt: number, streakHit = false): AttackResult => {
    w.ev.push({ type: 'AttackEnded', attackId, hit, damageDealt })
    w.s = { ...w.s, current: null }
    return { ...endWork(w), hit, damageDealt, streakHit }
  }

  if (targetId === null) return finish(false, 0) // empty hex (TOHIT-004): ammo and heat spent, nothing else
  if (!prof) return finish(false, 0)

  // 2. to-hit
  let hit: boolean
  let auto: 'hit' | 'miss' | null = null
  let rolled: number | null = null
  if (decl.tn <= 2) { hit = true; auto = 'hit' }
  else if (decl.tn >= 13) { hit = false; auto = 'miss' }
  else {
    const r = roll2d6(w, { purpose: 'toHit', unitId: attackerId, targetId, attackId, target: decl.tn, mods: decl.mods })
    hit = !!r.success
    rolled = r.total
  }
  w.ev.push({ type: 'AttackRolled', attackId, attackerId, targetId, kind: 'ranged', mountId: decl.mountId, tn: decl.tn, roll: rolled, hit, auto })
  if (!hit) return finish(false, 0)

  const streak = hasFlag(prof, 'streak')
  if (streak && decl.binId) spendAmmo(w, attackerId, decl.binId, 1) // CLUS-005: ammo only on a hit

  // 3. aimed shot
  let forced: Loc | null = null
  if (decl.aimedAt) {
    const r = roll1d6(w, { purpose: 'aimedShot', unitId: attackerId, targetId, attackId, target: 4 })
    const onTarget = r.total >= 4
    w.ev.push({ type: 'AimedShotResolved', attackId, aimedAt: decl.aimedAt, onTarget })
    if (onTarget) forced = decl.aimedAt
  }

  // 4. groups
  const dmg = damagePer(prof, decl.band)
  let groups: number[]
  const rapid = decl.rapidShots ?? 0
  const cluster = prof.cluster ?? (rapid > 1 ? { rackSize: rapid, groupSize: 1 } : null)
  if (cluster) {
    groups = rollCluster(w, {
      attackId, attackerId, targetId, rackSize: cluster.rackSize, mod: (prof.clusterMod ?? 0) + artemisClusterMod(w.data, attacker, decl.mountId, decl.ammoId ?? (decl.binId ? attacker.bins[decl.binId]?.ammo ?? null : null)), dmgPerHit: dmg, perGroup: cluster.groupSize, streak,
    }).groups
  } else {
    groups = [dmg]
  }
  w.s = { ...w.s, current: { ...ctx, stage: 'location', hit: true, groups, groupIndex: 0 } }

  // 5. each group: location, damage
  const aimedCover = !!decl.aimedAt && !!decl.partialCover // TOHIT-036: re-roll legs instead of absorbing them
  let total = 0
  for (let i = 0; i < groups.length; i++) {
    const gin: GroupInput = {
      attackId, attackerId, targetId, damage: groups[i]!, group: i + 1, table: decl.table, direction: decl.direction,
      partialCover: aimedCover ? false : decl.partialCover, rerollLegs: aimedCover, forcedLocation: forced, source: 'weapon',
    }
    if (opts.floatingCrits) gin.floatingCrits = true
    total += resolveGroupW(w, gin).dealt
  }
  return finish(true, total, streak)
}

// ---------- wire the late-bound collaborators ----------
try {
  fallDeps.applyDamage = (state, i) => applyDamage(state, i)
  heatDeps.explodeAmmo = (state, unitId, binId) => explodeBin(state, unitId, binId, 'heat')
  heatDeps.pickBin = (state, unitId) => pickHeatExplosionBin(bundleFor(state), state.units[unitId]!)
} catch {
  // module cycle during evaluation: the engine wires these again from index (see issues)
}
