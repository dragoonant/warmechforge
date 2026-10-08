// query.* bodies (00 §11, §11.5): pure read-only views over a state. Hypothetical positions are applied to a copy of the
// state and the same rules functions step uses then run on it, so a preview always matches what step would do.
import type {
  ArcsView, AttackPreview, AttackPreviewRequest, ExplosionPreview, FirePlan, FirePreview, HeatEffects, HeatScaleRow,
  LosOptions, LosVerdict, SheetView, TerrainInfo, UnitAt,
} from './index'
import { bundleFor } from './bundles'
import { ammoRec, binExplosionRaw, caseAt, CASE_CAP, EXPLOSION_CAP, effectiveProfile, equipRec, hasFlag, weaponRec } from './ammo'
import { artemisClusterMod, expectedClusterHits } from './cluster'
import { damagePer, TRANSFER } from './damage'
import {
  ammoAvoidTn, baseDissipation, heatMpLoss, heatToHitMod, hitCount, lifeSupportHits, projectHeat, shutdownAvoidTn,
} from './heat'
import { distance, firingArc, hexKey, hexToWorld, mountCoversArc, onBoard, torsoFacing } from './hex'
import { computeLos } from './los'
import { currentMp, damagedWalk, terrainCost } from './movement'
import { directionFor, effectivePos } from './physical'
import { consciousnessTn } from './pilot'
import { pAtLeast2d6 as p2d6AtLeast } from './prob'
import { persistentMods, psrTarget } from './psr'
import { evaluateShot, mountArcOf } from './phases/ranged'
import { hexAt } from './terrain'
import { tmmForHexes } from './tohit'
import { withdrawalTrigger, computeCrippled } from './victory'
import type {
  Facing, GameState, Hex, Loc, LocalId, Mod, PlayerId, PsrEntry, PsrReason, SlotRef, Twist, UnitId, UnitState,
} from './types'
import { LOCS } from './types'

// ---------- hypothetical positions (00 §11.5) ----------
/** A copy of the state with UnitAt applied to one unit. Omitted fields keep the unit's values. */
export function withUnitAt(state: GameState, unitId: UnitId, at: UnitAt | undefined, role: 'attacker' | 'target'): GameState {
  if (!at) return state
  const u = state.units[unitId]
  if (!u) return state
  const next: UnitState = { ...u, move: { ...u.move }, attacks: { ...u.attacks } }
  if (at.hex) { next.pos = at.hex; next.attacks.charge = null; next.attacks.dfa = null }
  if (at.facing !== undefined) next.facing = at.facing
  if (at.prone !== undefined) next.prone = at.prone
  if (at.twist !== undefined) next.attacks.twist = at.twist
  if (role === 'attacker' && at.mode !== undefined) next.move.mode = at.mode
  if (at.jumped !== undefined) next.move.jumped = at.jumped
  if (at.hexesMoved !== undefined) {
    next.move.hexesMoved = at.hexesMoved
    next.move.tmm = tmmForHexes(at.hexesMoved) + (next.move.jumped ? 1 : 0)
  }
  if (at.tmm !== undefined) next.move.tmm = at.tmm + (next.move.jumped ? 1 : 0)
  let ledger = state.ledger
  if (at.immobile !== undefined) {
    const rest = state.ledger.immobileAtStart.filter((id) => id !== unitId)
    ledger = { ...state.ledger, immobileAtStart: at.immobile ? [...rest, unitId] : rest }
  }
  return { ...state, ledger, units: { ...state.units, [unitId]: next } }
}

// ---------- LOS ----------
export function losQuery(state: GameState, from: UnitId | Hex, to: UnitId | Hex, opts: LosOptions = {}): LosVerdict {
  const end = (x: UnitId | Hex, at?: UnitAt): { hex: Hex; prone: boolean; key: string } => {
    if (typeof x === 'string') {
      const u = state.units[x]
      const hex = at?.hex ?? (u ? effectivePos(u) : null) ?? { q: -999, r: -999 }
      return { hex, prone: at?.prone ?? u?.prone ?? false, key: x }
    }
    return { hex: at?.hex ?? x, prone: at?.prone ?? false, key: hexKey(x) }
  }
  const a = end(from, opts.fromAt), b = end(to, opts.toAt)
  const choice = state.choices.los[`${a.key}>${b.key}`] ?? null
  return computeLos(state.board, { hex: a.hex, prone: a.prone }, { hex: b.hex, prone: b.prone }, { choice })
}

// ---------- arcs ----------
export function arcsQuery(state: GameState, unitId: UnitId, twist?: Twist): ArcsView {
  const u = state.units[unitId]!
  const pos = effectivePos(u)
  const view: ArcsView = { front: [], left: [], right: [], rear: [], mountArcs: {} }
  const tw = twist ?? (u.prone ? 0 : u.attacks.twist)
  if (pos) {
    const tf = torsoFacing(u.facing, tw)
    for (const bh of Object.values(state.board.hexes)) {
      if (bh.hex.q === pos.q && bh.hex.r === pos.r) continue
      const arc = firingArc(pos, tf, bh.hex)
      ;(arc === 'forward' ? view.front : view[arc]).push(bh.hex)
    }
  }
  const arcs = ['forward', 'left', 'right', 'rear'] as const
  for (const m of Object.values(u.mounts)) {
    if (!weaponRec(bundleFor(state), m.item)) continue
    view.mountArcs[m.id] = arcs.filter((a) => mountCoversArc(mountArcOf(m), a, { flipped: u.attacks.flipped && !u.prone })).map((a) => (a === 'forward' ? 'front' : a))
  }
  return view
}

// ---------- attack preview ----------
export function attackPreviewQuery(state: GameState, req: AttackPreviewRequest): AttackPreview {
  const data = bundleFor(state)
  let s = withUnitAt(state, req.attackerId, req.attackerAt, 'attacker')
  s = withUnitAt(s, req.targetId, req.targetAt, 'target')
  const secondary = req.primaryTargetId !== undefined && req.primaryTargetId !== null && req.primaryTargetId !== req.targetId
  const ev = evaluateShot(s, data, req.attackerId, {
    mountId: req.mountId, targetId: req.targetId,
    ...(req.binId ? { binId: req.binId } : {}), ...(req.aimedAt ? { aimedAt: req.aimedAt } : {}),
    ...(req.rapidShots !== undefined ? { rapidShots: req.rapidShots } : {}),
  }, { secondary, ...(req.propArm ? { propArm: req.propArm } : {}) })
  const a = s.units[req.attackerId], t = s.units[req.targetId]
  const aPos = a ? effectivePos(a) : null, tPos = t?.pos ?? null
  const dist = ev.geometry?.distance ?? (aPos && tPos ? distance(aPos, tPos) : 0)
  const los = ev.geometry?.los ?? (aPos && tPos
    ? computeLos(s.board, { hex: aPos, prone: a!.prone }, { hex: tPos, prone: t!.prone })
    : computeLos(s.board, { hex: { q: -999, r: -999 } }, { hex: { q: -999, r: -999 } }))
  let direction: AttackPreview['direction'] = 'front'
  if (a && t && aPos && tPos) direction = directionFor(s, a.id, t.id, aPos).direction
  const mount = a?.mounts[req.mountId]
  const weapon = mount ? weaponRec(data, mount.item) : null
  const prof = weapon ? effectiveProfile(weapon, ev.ammoId ? ammoRec(data, ev.ammoId) : null) : null
  const band = ev.geometry?.band ?? 'out'
  const tn = ev.tn?.tn ?? 0
  const mods: Mod[] = ev.tn?.mods ?? []
  let rejection = ev.rejection
  // TOHIT-005 against the plan's primary target: a Forward-arc secondary needs a Forward-arc primary
  if (!rejection && secondary && ev.geometry?.forward && a && aPos) {
    const p = s.units[req.primaryTargetId!]
    const pPos = p ? effectivePos(p) : null
    if (pPos && firingArc(aPos, torsoFacing(a.facing, a.prone ? 0 : a.attacks.twist), pPos) !== 'forward') {
      rejection = { code: 'E_PRIMARY_TARGET', message: 'a Forward-arc target must be primary' }
    }
  }
  const legal = rejection === null
  const pHit = legal ? p2d6AtLeast(tn) : 0
  const damage = prof ? damagePer(prof, band === 'out' ? 'long' : band) : 0
  const rapid = req.rapidShots ?? 1
  const heat = (prof?.heat ?? 0) * rapid
  let cluster: AttackPreview['cluster'] = null
  const rack = prof?.cluster?.rackSize ?? (rapid > 1 ? rapid : 0)
  if (prof && rack > 0) {
    const streak = hasFlag(prof, 'streak')
    const mod = (prof.clusterMod ?? 0) + (a ? artemisClusterMod(data, a, req.mountId, ev.ammoId) : 0)
    cluster = { rackSize: rack, expectedHits: streak ? rack : expectedClusterHits(rack, mod) }
  }
  const perHit = cluster ? cluster.expectedHits * damage : damage
  const out: AttackPreview = {
    legal, mountId: req.mountId, targetId: req.targetId, distance: dist, band, tn, mods, pHit, direction, table: 'standard',
    partialCover: los.partialCover, los, heat, damage, cluster, expectedDamage: pHit * perHit,
  }
  if (rejection) { out.reason = rejection.code; out.why = rejection.message }
  return out
}

export function firePreviewQuery(state: GameState, unitId: UnitId, plan: FirePlan): FirePreview {
  let s = state
  if (plan.twist !== undefined || plan.flip !== undefined) {
    const u = s.units[unitId]!
    s = { ...s, units: { ...s.units, [unitId]: { ...u, attacks: { ...u.attacks, twist: plan.twist ?? u.attacks.twist, flipped: plan.flip ?? u.attacks.flipped } } } }
  }
  const primary = plan.shots[0]?.targetId ?? null
  const weapons = plan.shots.map((sh) => attackPreviewQuery(s, {
    attackerId: unitId, mountId: sh.mountId, targetId: sh.targetId, primaryTargetId: primary,
    ...(sh.binId ? { binId: sh.binId } : {}), ...(sh.aimedAt ? { aimedAt: sh.aimedAt } : {}),
    ...(sh.rapidShots !== undefined ? { rapidShots: sh.rapidShots } : {}), ...(plan.propArm ? { propArm: plan.propArm } : {}),
  }))
  const rapidShots: Record<LocalId, number> = {}
  for (const sh of plan.shots) if (sh.rapidShots !== undefined) rapidShots[sh.mountId] = sh.rapidShots
  const proj = projectHeat(s, unitId, { mounts: plan.shots.map((x) => x.mountId), rapidShots })
  const move = proj.entries.filter((e) => e.source === 'movement').reduce((n, e) => n + e.amount, 0)
  const weaponsHeat = proj.entries.filter((e) => e.source === 'weapon').reduce((n, e) => n + e.amount, 0)
  return { weapons, primaryTargetId: primary, heat: { ...proj, move, weapons: weaponsHeat } }
}

// ---------- heat ----------
export function heatEffectsQuery(heat: number): HeatEffects {
  return {
    heat, mpLoss: heatMpLoss(heat), toHitMod: heatToHitMod(heat), shutdownTn: heat >= 30 ? null : shutdownAvoidTn(heat), autoShutdown: heat >= 30,
    ammoTn: ammoAvoidTn(heat), lifeSupportPilotHits: lifeSupportHits(heat), // the hits a damaged life support would deal
  }
}
export function heatScaleQuery(): HeatScaleRow[] {
  const rows: HeatScaleRow[] = []
  for (let level = 0; level <= 30; level++) {
    const e = heatEffectsQuery(level)
    const effects: HeatScaleRow['effects'] = []
    if (e.mpLoss) effects.push({ code: 'mp', value: e.mpLoss })
    if (e.toHitMod) effects.push({ code: 'toHit', value: e.toHitMod })
    if (e.shutdownTn) effects.push({ code: 'shutdown', value: e.shutdownTn })
    if (e.autoShutdown) effects.push({ code: 'autoShutdown', value: 30 })
    if (e.ammoTn) effects.push({ code: 'ammo', value: e.ammoTn })
    if (e.lifeSupportPilotHits) effects.push({ code: 'lifeSupport', value: e.lifeSupportPilotHits })
    rows.push({ level, effects })
  }
  return rows
}

// ---------- PSR preview ----------
const EVENT_MOD: Partial<Record<PsrReason, number>> = {
  damage20: 1, charged: 2, dfaTarget: 2, chargeMade: 2, dfaMade: 2, stand: -1,
}
export function psrPreviewQuery(state: GameState, unitId: UnitId, reason: PsrReason): { tn: number; mods: Mod[]; p: number; auto: boolean } {
  const u = state.units[unitId]!
  const entry: PsrEntry = { id: 'p:preview', unitId, reason, mod: EVENT_MOD[reason] ?? 0, auto: false, when: 'now', phase: state.phase }
  const { tn, mods } = psrTarget(state, entry)
  const auto = tn > 12 || u.shutdown !== null || !u.pilot.conscious
  return { tn, mods, p: auto ? 0 : p2d6AtLeast(tn), auto }
}

// ---------- explosions and kill locations ----------
const engineSlotsIn = (u: UnitState, loc: Loc): number => u.slots[loc].filter((s) => s.token === 'engine' && !s.hit).length
export function isKillLocationQuery(state: GameState, unitId: UnitId, loc: Loc): boolean {
  const u = state.units[unitId]!
  if (loc === 'HD' || loc === 'CT') return true
  if (loc !== 'LT' && loc !== 'RT') return false
  return hitCount(u, 'engine') + engineSlotsIn(u, loc) >= 3
}
export function explosionPreviewQuery(state: GameState, unitId: UnitId, slot: SlotRef): ExplosionPreview {
  const data = bundleFor(state)
  const u = state.units[unitId]!
  const token = u.slots[slot.location]?.[slot.index]?.token ?? 'empty'
  const id = token.startsWith('#') ? token.slice(1) : null
  let raw = 0
  let explodes = false
  if (id && u.bins[id]) { raw = binExplosionRaw(data, u, id); explodes = raw > 0 }
  else if (id && u.mounts[id]) {
    const m = u.mounts[id]!
    explodes = !m.destroyed && !!(weaponRec(data, m.item)?.flags?.includes('explodes') || equipRec(data, m.item)?.explodes)
    let n = 0
    for (const sl of Object.values(u.slots)) for (const s of sl) if (s.token === token) n++
    raw = explodes ? 2 * Math.max(1, n) : 0
  }
  const cs = caseAt(data, u, slot.location)
  const damage = explodes ? Math.min(raw, cs === 'case' ? CASE_CAP : EXPLOSION_CAP) : 0
  const transfersTo: Loc[] = []
  let destroysUnit = false
  if (damage > 0) {
    let left = damage
    let loc: Loc | undefined = slot.location
    while (loc && left > 0) {
      const L = u.locs[loc]
      if (cs === 'caseII') { left = 0; break }
      if (!L.destroyed && left < L.structure) break
      left -= L.destroyed ? 0 : L.structure
      if (isKillLocationQuery(state, unitId, loc)) { destroysUnit = true; break }
      if (cs === 'case') break
      loc = TRANSFER[loc]
      if (loc) transfersTo.push(loc)
    }
  }
  const pilotHits = damage > 0 ? 1 : 0
  if (u.pilot.hits + pilotHits >= 6) destroysUnit = true
  return { damage, location: slot.location, transfersTo, pilotHits, destroysUnit }
}

export function mustWithdrawQuery(state: GameState, unitId: UnitId): boolean {
  const u = state.units[unitId]!
  if (!state.setup.forcedWithdrawal) return false
  if (u.status === 'withdrawing') return true
  return withdrawalTrigger({ ...u, crippled: u.crippled || computeCrippled(u, bundleFor(state)) })
}

// ---------- record sheet ----------
const rangeText = (r?: { short: number; medium: number; long: number; min?: number }): string =>
  r ? `${r.min ? `min ${r.min}, ` : ''}${r.short}/${r.medium}/${r.long}` : '-'
export function sheetQuery(state: GameState, unitId: UnitId): SheetView {
  const data = bundleFor(state)
  const u = state.units[unitId]!
  const mech = data.mechs[u.mechId] as { bv?: number } | undefined
  const tables = data.tables as { bvSkillMultiplier?: { rows: number[][] } }
  const bv = mech?.bv ?? 0
  const mult = tables.bvSkillMultiplier?.rows[u.pilot.gunnery]?.[u.pilot.piloting] ?? 1
  const locations = {} as SheetView['locations']
  const slots = {} as SheetView['slots']
  const nameOf = (token: string): string => {
    if (!token.startsWith('#')) return token
    const id = token.slice(1)
    const m = u.mounts[id], b = u.bins[id]
    const rid = m?.item ?? b?.ammo
    return ((rid && (data.byId[rid] as { name?: string } | undefined)?.name) ?? id)
  }
  for (const l of LOCS) {
    const L = u.locs[l]
    locations[l] = { armor: L.armor, maxArmor: L.maxArmor, rear: L.rear, maxRear: L.maxRear, structure: L.structure, maxStructure: L.maxStructure, destroyed: L.destroyed }
    slots[l] = u.slots[l].map((s) => {
      const id = s.token.startsWith('#') ? s.token.slice(1) : null
      const destroyed = !!id && (!!u.mounts[id]?.destroyed || !!u.bins[id]?.exploded)
      return { label: nameOf(s.token), token: s.token, hit: s.hit, destroyed: destroyed || (s.hit && !id) }
    })
  }
  const weapons: SheetView['weapons'] = []
  for (const m of Object.values(u.mounts)) {
    const w = weaponRec(data, m.item)
    if (!w) continue
    const dmg = typeof w.damage === 'number' ? String(w.damage) : `${w.damage.short ?? '-'}/${w.damage.medium ?? '-'}/${w.damage.long ?? '-'}`
    weapons.push({
      mountId: m.id, name: w.name ?? m.item, location: m.location, rear: m.rear, heat: w.heat ?? 0,
      damage: w.cluster ? `${dmg}/msl (${w.cluster.rackSize})` : dmg, ranges: rangeText(w.ranges),
      destroyed: m.destroyed || u.locs[m.location].destroyed, firedThisTurn: u.attacks.firedMounts.includes(m.id),
    })
  }
  const ammo: SheetView['ammo'] = Object.values(u.bins).map((b) => ({
    binId: b.id, name: (ammoRec(data, b.ammo)?.name ?? b.ammo), location: b.location, shots: b.shots, capacity: b.capacity,
  }))
  const mp = currentMp(state, unitId)
  const walkMods: Mod[] = []
  const dmgLoss = u.baseMp.walk - damagedWalk(u)
  if (dmgLoss) walkMods.push({ code: 'legDestroyed', value: -dmgLoss, detail: 'damage' })
  const heatLoss = heatMpLoss(u.heat)
  if (heatLoss) walkMods.push({ code: 'heat', value: -heatLoss })
  const sinkMounts = Object.values(u.mounts).filter((m) => m.item.includes('heat-sink'))
  const operable = u.sinks.count - sinkMounts.filter((m) => m.destroyed || u.locs[m.location].destroyed).length
  const tns: number[] = [1, 2, 3, 4, 5].map((h) => consciousnessTn(h) ?? 0)
  return {
    unitId, name: u.name, tonnage: u.tonnage, bv, adjustedBv: Math.floor(bv * mult + 0.5 + 1e-9),
    locations, slots, weapons, ammo,
    mp: { baseWalk: u.baseMp.walk, baseRun: Math.ceil(u.baseMp.walk * 1.5), baseJump: u.baseMp.jump, walk: mp.walk, run: mp.run, jump: mp.jump, walkMods },
    sinks: { count: u.sinks.count, type: u.sinks.type, operable, dissipation: baseDissipation(u) },
    status: { prone: u.prone, shutdown: u.shutdown !== null, immobile: state.ledger.immobileAtStart.includes(unitId), jumped: u.move.jumped, twist: u.attacks.twist, flipped: u.attacks.flipped },
    heat: u.heat,
    pilot: {
      name: u.pilot.name, gunnery: u.pilot.gunnery, piloting: u.pilot.piloting, hits: u.pilot.hits, conscious: u.pilot.conscious,
      consciousnessTn: consciousnessTn(u.pilot.hits), consciousnessTns: tns,
    },
  }
}

// ---------- terrain ----------
export function terrainInfoQuery(state: GameState, hex: Hex): TerrainInfo {
  const bh = hexAt(state.board, hex)
  if (!bh || !onBoard(state.board, hex)) {
    return { label: '', level: 0, terrain: [], depth: null, moveCost: { walk: null, run: null, jump: null }, losEffect: 'off the board' }
  }
  const terrain: string[] = []
  if (bh.woods !== 'none') terrain.push(bh.woods === 'heavy' ? 'heavy woods' : 'light woods')
  if (bh.rough) terrain.push('rough')
  if (bh.rubble) terrain.push('rubble')
  if (bh.pavement) terrain.push('pavement')
  if (bh.road.length) terrain.push('road')
  if (bh.depth > 0) terrain.push(`water depth ${bh.depth}`)
  if (terrain.length === 0) terrain.push('clear')
  const cost = 1 + terrainCost(bh)
  const losEffect = bh.woods === 'heavy' ? 'heavy woods: 2 points of intervening woods, +2 to hit a target inside'
    : bh.woods === 'light' ? 'light woods: 1 point of intervening woods, +1 to hit a target inside'
      : bh.depth === 1 ? 'depth 1 water: a standing unit here has partial cover'
        : bh.depth >= 2 ? 'deep water: a unit here is submerged'
          : `level ${bh.level}: blocks lines that pass below its height`
  return { label: bh.label, level: bh.level, terrain, depth: bh.depth > 0 ? bh.depth : null, moveCost: { walk: cost, run: bh.depth > 0 ? cost : cost, jump: 1 }, losEffect }
}

export function hexToWorldQuery(state: GameState, hex: Hex): { x: number; z: number } { return hexToWorld(state.board, hex) }

// ---------- threat (simple release-1 form; the AI's model is 40-ai §5, M4) ----------
export interface ThreatView {
  hex: Hex
  /** Expected damage a standing 'Mech at the hex would take this turn from each side's units at their current positions. */
  bySide: Record<PlayerId, number>
  sources: { unitId: UnitId; expectedDamage: number }[]
}
export function threatQuery(state: GameState, hex: Hex): ThreatView {
  const bySide: Record<PlayerId, number> = { A: 0, B: 0 }
  const sources: ThreatView['sources'] = []
  for (const id of state.unitOrder) {
    const u = state.units[id]!
    if ((u.status !== 'active' && u.status !== 'withdrawing') || !u.pos || u.doomed) continue
    const stand = state.unitOrder.map((x) => state.units[x]!).find((t) => t.owner !== u.owner)
    if (!stand) continue
    let total = 0
    for (const m of Object.values(u.mounts)) {
      if (!weaponRec(bundleFor(state), m.item)) continue
      const p = attackPreviewQuery(state, { attackerId: id, mountId: m.id, targetId: stand.id, targetAt: { hex, prone: false, tmm: 0, jumped: false, immobile: false } })
      if (p.legal) total += p.expectedDamage
    }
    bySide[u.owner] += total
    sources.push({ unitId: id, expectedDamage: total })
  }
  return { hex, bySide, sources }
}

/** Facing helper used by describe. */
export const FACING_NAMES: Record<Facing, string> = { 0: 'north', 1: 'north-east', 2: 'south-east', 3: 'south', 4: 'south-west', 5: 'north-west' }
export { persistentMods }
