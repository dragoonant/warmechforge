// Presentation beats -> visual effect specs (pure: no three.js, no timers). The layer plays them. Reads what a beat carries
// (its fx payload, the presented state for positions); invents no rules numbers. Times are ms at speed 1; the engine scales.
import type { ArmorSide, GameState, Loc, UnitId } from '../../engine/index'
import type { ActiveBeat, UnitTween } from '../presentation/presentedStore'
import { bundle } from '../store/setup'
import { centreWorld, socketWorld, type V3 } from '../figures/sockets'
import { hexTopY, unitFrame, isOnTable, type UnitFrame } from '../figures/unitFrame'

export type WeaponLook = 'laser' | 'ppc' | 'tracer' | 'missile' | 'melee'

export interface WeaponFlavour { look: WeaponLook; clan: boolean; /** Visible projectiles for a missile rack (capped). */ rack: number }

const MISSILE_RE = /(lrm|srm|mml|mrm|atm|rocket|streak|narc|missile)/
const LASER_RE = /laser/
const PPC_RE = /(ppc|particle)/
const BALLISTIC_RE = /(ac-?\d|autocannon|machine-gun|(^|[.-])mg([.-]|$)|gauss|ultra|lb-?\d|rotary|flamer)/

/** What a weapon looks like in flight, from its data id and category (energy / ballistic / missile). */
export function weaponLook(weaponId: string | null | undefined): WeaponFlavour {
  const id = (weaponId ?? '').toLowerCase()
  const clan = id.startsWith('cl.')
  const rec = weaponId ? (bundle().weapons[weaponId] as { category?: string; cluster?: { rackSize: number } } | undefined) : undefined
  const rack = Math.min(8, Math.max(2, rec?.cluster?.rackSize ?? 6))
  if (MISSILE_RE.test(id)) return { look: 'missile', clan, rack }
  if (PPC_RE.test(id)) return { look: 'ppc', clan, rack }
  if (LASER_RE.test(id)) return { look: 'laser', clan, rack }
  if (BALLISTIC_RE.test(id)) return { look: 'tracer', clan, rack }
  switch (rec?.category) {
    case 'missile': return { look: 'missile', clan, rack }
    case 'ballistic': return { look: 'tracer', clan, rack }
    default: return { look: 'laser', clan, rack }
  }
}

export type FxSpec =
  | { kind: 'muzzle'; at: V3; dir: V3; big: boolean; delay: number }
  | { kind: 'beam'; from: V3; to: V3; colour: number; width: number; dur: number; delay: number }
  | { kind: 'bolt'; from: V3; to: V3; colour: number; dur: number; delay: number }
  | { kind: 'tracers'; from: V3; to: V3; count: number; dur: number; delay: number; spread: number }
  | { kind: 'missiles'; from: V3; to: V3; count: number; dur: number; delay: number }
  | { kind: 'impact'; at: V3; mode: 'spark' | 'blast' | 'melee' | 'crit'; delay: number; delayReal?: number }
  | { kind: 'fireball'; at: V3; size: number; delay: number }
  | { kind: 'ring'; at: V3; radius: number; dur: number; delay: number; delayReal?: number; colour: number }
  | { kind: 'dust'; at: V3; delay: number; delayReal?: number }
  | { kind: 'smoke'; at: V3; delay: number }

export const LASER_RED = 0xff3b30
export const LASER_CLAN = 0xffb13a
export const PPC_BLUE = 0x8fb8ff

const dir = (a: V3, b: V3): V3 => {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz) || 1
  return { x: dx / l, y: dy / l, z: dz / l }
}
const dist = (a: V3, b: V3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)

/** Where a missed shot ends: past the target, pushed sideways so it visibly misses. */
export function missPoint(from: V3, to: V3): V3 {
  const d = dir(from, to)
  const side = { x: -d.z, z: d.x }
  const k = 0.55
  return { x: to.x + side.x * k + d.x * 0.5, y: to.y + 0.05, z: to.z + side.z * k + d.z * 0.5 }
}

export interface PlanContext { state: GameState; tweens: Record<UnitId, UnitTween>; now: number }

function frameFor(c: PlanContext, id: UnitId | null | undefined): UnitFrame | null {
  const u = id ? c.state.units[id] : undefined
  if (!u || !isOnTable(u)) return null
  return unitFrame(c.state, u, undefined, c.now)
}

/** Locations a hit lands on: `side` says whether it was the rear armour. */
export function hitPoint(c: PlanContext, unitId: UnitId, location: Loc, side: ArmorSide): V3 | null {
  const f = frameFor(c, unitId)
  return f ? socketWorld(location, f, side === 'rear') : null
}

/** Effects for the beat that just started. */
export function planBeat(beat: ActiveBeat, c: PlanContext): FxSpec[] {
  const out: FxSpec[] = []
  const fx = beat.fx
  if (fx) {
    switch (fx.kind) {
      case 'fire': {
        const a = frameFor(c, fx.attackerId)
        const t = frameFor(c, fx.targetId)
        if (!a) break
        const au = c.state.units[fx.attackerId]!
        if (fx.attack !== 'ranged') {
          // physical attack: the swing itself needs no projectile; the hit beat brings the sparks
          if (t && (fx.attack === 'charge' || fx.attack === 'dfa')) out.push({ kind: 'dust', at: { x: t.x, y: t.y + 0.15, z: t.z }, delay: 0 })
          break
        }
        const mount = fx.mountId ? au.mounts[fx.mountId] : undefined
        const from = socketWorld(mount?.location ?? 'CT', a, !!mount?.rear)
        const flavour = weaponLook(fx.weaponId ?? mount?.item)
        const centre = t ? centreWorld(t) : null
        const to = centre ? (fx.hit ? centre : missPoint(from, centre)) : null
        if (!to) break
        const d = dist(from, to)
        const travel = Math.min(450, 120 + d * 60)
        out.push({ kind: 'muzzle', at: from, dir: dir(from, to), big: flavour.look === 'ppc' || flavour.look === 'missile', delay: 0 })
        switch (flavour.look) {
          case 'laser': out.push({ kind: 'beam', from, to, colour: flavour.clan ? LASER_CLAN : LASER_RED, width: 0.035, dur: 380, delay: 30 }); break
          case 'ppc': out.push({ kind: 'bolt', from, to, colour: PPC_BLUE, dur: travel, delay: 30 }); break
          case 'tracer': out.push({ kind: 'tracers', from, to, count: 5, dur: travel * 0.7, delay: 20, spread: 0.06 }); break
          case 'missile': out.push({ kind: 'missiles', from, to, count: flavour.rack, dur: travel * 1.6, delay: 40 }); break
          default: break
        }
        // the impact itself comes with the 'hit' beat that follows (hit location and damage), so nothing more here
        break
      }
      case 'hit': {
        const p = hitPoint(c, fx.unitId, fx.location, fx.side)
        if (p) out.push({ kind: 'impact', at: p, mode: fx.damage >= 10 ? 'blast' : 'spark', delay: 0 })
        break
      }
      case 'crit': {
        const p = hitPoint(c, fx.unitId, fx.location, 'front')
        if (p) out.push({ kind: 'impact', at: p, mode: 'crit', delay: 0 })
        break
      }
      case 'explosion': {
        const p = hitPoint(c, fx.unitId, fx.location, 'front')
        if (p) { out.push({ kind: 'fireball', at: p, size: Math.min(2.2, 0.8 + fx.damage * 0.04), delay: 0 }); out.push({ kind: 'ring', at: { x: p.x, y: p.y, z: p.z }, radius: 0.9, dur: 500, delay: 0, colour: 0xffa040 }) }
        break
      }
      case 'destroyed': {
        const f = frameFor(c, fx.unitId)
        if (f) { const p = centreWorld(f); out.push({ kind: 'fireball', at: p, size: 1.6, delay: 0 }); out.push({ kind: 'smoke', at: p, delay: 200 }) }
        break
      }
      case 'fall': {
        const f = frameFor(c, fx.unitId)
        if (f) out.push({ kind: 'dust', at: { x: f.x, y: f.y + 0.1, z: f.z }, delay: 120 })
        break
      }
      case 'shutdown': {
        const f = frameFor(c, fx.unitId)
        if (f) out.push({ kind: 'smoke', at: centreWorld(f), delay: 0 })
        break
      }
      default: break
    }
  }
  // a jump ends with dust at the landing hex (the tween keeps the unit in the air until then)
  for (const id of beat.unitIds) {
    const tw = c.tweens[id]
    if (tw && tw.kind === 'jump') {
      const last = tw.keys[tw.keys.length - 1]!
      const y = hexTopY(c.state, last.hex)
      out.push({ kind: 'dust', at: { x: last.x, y, z: last.z }, delay: 0, delayReal: tw.durationMs })
    }
  }
  return out
}
