// Presentation beats -> sounds. Pure: no audio calls, so it is easy to test. `soundsForBeat` is the only mapping;
// beatAudio.ts plays its result. Shots come from src/client/weaponFlavour.ts, the same classification the VFX read.
// Narrator lines are neutral commentary; cockpit-computer lines are only for the human side's 'Mech.
import type { AttackKind, GameState, PlayerId, UnitId } from '../../engine/index'
import { BEAT_MS, type Beat } from '../presentation/beats'
import { weaponFlavour } from '../weaponFlavour'
import type { PlayOptions } from './manager'

/** One sound of a beat. `at` is the fraction 0..1 of the beat at which it starts (default 0). */
export interface BeatSound { id: string; at?: number; opts?: PlayOptions }

export interface SoundContext {
  /** The human seat. Omit (bot vs bot, hot seat) for neutral lines and no cockpit voice. */
  perspective?: PlayerId | undefined
  /** The presented state as the beat starts (tonnage, owner). Optional: unknown units get the generic sound. */
  state?: GameState | null | undefined
  /** attackId -> impact sound, filled by fire beats and read by the hit beats that follow. Optional. */
  impacts?: Map<number | string, string> | undefined
}

export const HEAT_WARN_AT = 14
export const HEAT_CRITICAL_AT = 19
export const REACTOR_WARN_AT = 26

const VOICE: PlayOptions = { detuneJitter: 0 }

export type WeightClass = 'light' | 'medium' | 'heavy' | 'assault'
/** Footstep class by tonnage: 20-35 light, 40-55 medium, 60-75 heavy, 80+ assault. */
export function weightClass(tonnage: number | undefined): WeightClass {
  if (tonnage === undefined) return 'medium'
  return tonnage <= 35 ? 'light' : tonnage <= 55 ? 'medium' : tonnage <= 75 ? 'heavy' : 'assault'
}

const PHASE_LINE: Record<string, string> = {
  initiative: 'nar-initiative', movement: 'nar-movement', rangedAttack: 'nar-ranged', physicalAttack: 'nar-physical', heat: 'nar-heat',
}
const PHYSICAL_SOUND: Record<string, string> = { punch: 'ph-punch', kick: 'ph-kick', charge: 'ph-charge', dfa: 'ph-dfa', push: 'ph-punch' }

/** The shot (or strike) sound for an attack: the weapon's flavour for ranged fire, the blow for physical attacks. */
export function shotSound(attack: AttackKind, weaponId: string | null): { id: string; impact: string } {
  if (attack !== 'ranged') return { id: PHYSICAL_SOUND[attack] ?? 'ph-punch', impact: 'dm-armor' }
  const f = weaponFlavour(weaponId ?? '', false)
  return { id: f.sfx, impact: f.impact }
}

/** Sounds for one beat, with start fractions. `ctx.state` is the state the beat starts from. */
export function soundsForBeat(beat: Beat, ctx: SoundContext = {}): BeatSound[] {
  const out: BeatSound[] = []
  const units = ctx.state?.units
  const mine = (id: UnitId | null | undefined): boolean => !!ctx.perspective && !!id && units?.[id]?.owner === ctx.perspective
  const cockpit = (id: string, unitId: UnitId | null | undefined, at = 0) => { if (mine(unitId)) out.push({ id, at, opts: VOICE }) }
  const ms = Math.max(1, beat.baseMs)
  const frac = (t: number) => Math.min(0.95, Math.max(0, t / ms))
  const fx = beat.fx
  const hasRolls = !!beat.rolls?.length

  switch (beat.kind) {
    case 'banner': {
      const first = beat.events[0]?.event
      if (first?.type === 'TurnStarted') out.push({ id: 'ui-turn-bell' })
      else if (first?.type === 'PhaseStarted') {
        const line = PHASE_LINE[first.phase]
        if (line) out.push({ id: line, at: 0.05, opts: VOICE })
      } else if (first?.type === 'GameEnded') {
        const w = first.result.winner
        if (w) {
          const lost = !!ctx.perspective && w !== ctx.perspective
          out.push({ id: lost ? 'nar-defeat' : 'nar-victory', opts: { ...VOICE, interrupt: true } })
        }
      }
      break
    }
    case 'initiative':
      out.push({ id: 'ui-dice', opts: { volume: 0.8 } })
      break
    case 'move': {
      const t = beat.tweens?.[0]
      const unitId = t?.unitId ?? beat.unitIds[0]
      const cls = weightClass(unitId ? units?.[unitId]?.tonnage : undefined)
      const own = mine(unitId)
      if (t?.kind === 'jump') {
        out.push({ id: 'mv-jump-ignite', opts: { volume: 0.8 } }, { id: 'mv-jump-thrust', at: 0.12, opts: { volume: 0.7 } }, { id: 'mv-jump-land', at: 0.85 })
        break
      }
      if (t?.kind === 'displace' || t?.kind === 'deploy') break
      // one footstep per hex entered, at the middle of that hex's share of the beat
      let clock = 0
      let steps = 0
      for (const se of beat.events) {
        const e = se.event
        if (e.type === 'UnitStepped') {
          const moved = e.from.q !== e.to.q || e.from.r !== e.to.r
          if (moved && (e.op === 'forward' || e.op === 'backward') && steps < 10) {
            out.push({ id: `mv-step-${cls}`, at: frac(clock + BEAT_MS.hex / 2), opts: { volume: own ? 0.85 : 0.6 } })
            steps++
          }
          if (e.op === 'dropProne') out.push({ id: 'mv-fall', at: frac(clock), opts: { volume: 0.5 } })
          clock += moved ? BEAT_MS.hex : BEAT_MS.hexTurn
        } else if (e.type === 'UnitEntered') clock += BEAT_MS.hex
      }
      break
    }
    case 'twist':
      out.push({ id: 'mv-torso-twist', opts: { volume: 0.7 } })
      break
    case 'apply':
      for (const se of beat.events) if (se.event.type === 'StandAttempted' && se.event.success) out.push({ id: 'mv-standup' })
      break
    case 'fire': {
      if (fx?.kind !== 'fire') break
      if (hasRolls) out.push({ id: 'ui-dice', opts: { volume: 0.55 } })
      const s = shotSound(fx.attack, fx.weaponId)
      ctx.impacts?.set(fx.attackId, s.impact)
      out.push({ id: s.id, at: hasRolls ? 0.3 : 0 })
      break
    }
    case 'hit': {
      if (hasRolls) out.push({ id: 'ui-dice', opts: { volume: 0.5 } })
      const attackId = fx?.kind === 'hit' ? fx.attackId : null
      const impact = (attackId !== null && ctx.impacts?.get(attackId)) || 'dm-armor'
      let internal = false
      let breach: UnitId | null = null
      let limb = false
      let pilot = false
      for (const se of beat.events) {
        const e = se.event
        if (e.type === 'DamageApplied') {
          if (e.structureAfter < e.structureBefore) internal = true
          else if (e.armorBefore > 0 && e.armorAfter === 0) breach = e.unitId
        } else if (e.type === 'LocationDestroyed') limb = true
        else if (e.type === 'PilotHit') pilot = true
      }
      out.push({ id: internal ? 'dm-internal' : impact, at: 0.1 })
      if (limb) out.push({ id: 'dm-limb', at: 0.25 })
      if (pilot) out.push({ id: 'dm-cockpit', at: 0.4 })
      if (breach) cockpit('cmp-armor-breach', breach, 0.3)
      break
    }
    case 'crit': {
      const slot = beat.events.map((se) => se.event).find((e) => e.type === 'CritSlotHit')
      const blown = beat.events.some((se) => se.event.type === 'CritCheckRolled' && se.event.blownOff)
      if (hasRolls) out.push({ id: 'ui-dice', opts: { volume: 0.5 } })
      if (blown) out.push({ id: 'dm-limb', at: 0.2 })
      if (slot?.type === 'CritSlotHit') {
        if (slot.effect === 'engine') out.push({ id: 'dm-engine-breach', at: 0.15 })
        else if (slot.effect !== 'ammoExplosion' && slot.effect !== 'componentExplosion') out.push({ id: 'dm-crit', at: 0.1 })
        out.push({ id: 'nar-critical', at: 0.3, opts: VOICE })
        if (slot.effect === 'componentDestroyed') cockpit('cmp-weapon-destroyed', slot.unitId, 0.5)
      }
      break
    }
    case 'check':
      if (hasRolls) out.push({ id: 'ui-dice', opts: { volume: 0.6 } })
      break
    case 'fall':
      if (hasRolls) out.push({ id: 'ui-dice', opts: { volume: 0.5 } })
      out.push({ id: 'mv-fall', at: 0.1 })
      if (beat.events.some((se) => se.event.type === 'PilotHit')) out.push({ id: 'dm-cockpit', at: 0.5 })
      break
    case 'explosion': {
      const ammo = beat.events.some((se) => se.event.type === 'AmmoExploded')
      out.push({ id: 'dm-ammo-explosion' })
      if (ammo) out.push({ id: 'nar-ammo', at: 0.2, opts: VOICE })
      break
    }
    case 'heat': {
      if (fx?.kind !== 'heat') break
      if (fx.after < fx.before && fx.before >= 8) out.push({ id: 'ht-vent', opts: { volume: 0.6 } })
      if (mine(fx.unitId) && fx.after >= HEAT_WARN_AT) {
        out.push({ id: 'ht-warning', at: 0.15 })
        if (fx.after >= REACTOR_WARN_AT) cockpit('cmp-reactor', fx.unitId, 0.4)
        else if (fx.after >= HEAT_CRITICAL_AT) cockpit('cmp-heat-critical', fx.unitId, 0.4)
      }
      break
    }
    case 'shutdown':
      if (fx?.kind !== 'shutdown') break
      if (fx.on) {
        out.push({ id: 'ht-startup' })
        cockpit('cmp-systems-online', fx.unitId, 0.5)
      } else out.push({ id: 'ht-shutdown' }, { id: 'nar-shutdown', at: 0.3, opts: VOICE })
      break
    case 'destroyed':
      out.push({ id: 'dm-destroyed' }, { id: 'nar-destroyed', at: 0.3, opts: VOICE })
      break
    case 'pilot':
      out.push({ id: 'dm-cockpit' })
      break
    default:
      break
  }
  return out
}
