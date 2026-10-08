// State-driven look of a 'Mech (30-figures section 6). Pure: UnitState in, a plain description out. Never animation-driven.
import type { Loc, UnitState } from '../../engine/index'

export interface HeatGlow { colour: 'none' | 'orange' | 'red'; intensity: number; pulse: boolean }

/** Emissive heat glow: orange 10-19 (0.06 rising to 0.2), red 20+ (0.22 rising to 0.4, slow pulse); low enough that the side colour still reads. None while shut down. */
export function heatGlow(heat: number, shutdown: boolean): HeatGlow {
  if (shutdown || heat < 10) return { colour: 'none', intensity: 0, pulse: false }
  if (heat < 20) return { colour: 'orange', intensity: 0.06 + 0.14 * ((heat - 10) / 9), pulse: false }
  return { colour: 'red', intensity: Math.min(0.4, 0.22 + 0.18 * ((heat - 20) / 10)), pulse: true }
}

export interface UnitVisual {
  destroyed: boolean
  prone: boolean
  shutdown: boolean
  /** Pilot unconscious or dead: canopy dark, status icon. */
  pilotDown: boolean
  /** Canopy lights out (shutdown, pilot down or destroyed). */
  lightsOut: boolean
  glow: HeatGlow
  /** Locations structurally gone (their node is hidden / charcoal). */
  destroyedLocs: Loc[]
  /** Locations whose armour is gone but are not destroyed (tint + smoke wisp). */
  exposedLocs: Loc[]
  hideArmL: boolean
  hideArmR: boolean
  hideTorsoL: boolean
  hideTorsoR: boolean
  hideHead: boolean
  legL: 'ok' | 'destroyed'
  legR: 'ok' | 'destroyed'
  /** Emits a smoke column (destroyed 'Mech stays as a wreck). */
  wreck: boolean
  twist: number
  flipped: boolean
}

const LOCS: Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']

export function unitVisual(u: Pick<UnitState, 'status' | 'prone' | 'shutdown' | 'heat' | 'pilot' | 'locs' | 'attacks'>, over: { prone?: boolean; twist?: number } = {}): UnitVisual {
  const destroyed = u.status === 'destroyed'
  const shutdown = !!u.shutdown
  const pilotDown = !u.pilot.conscious || u.pilot.dead
  const dead: Loc[] = []
  const exposed: Loc[] = []
  for (const l of LOCS) {
    const s = u.locs[l]
    if (!s) continue
    if (s.destroyed) dead.push(l)
    else if (s.armor <= 0) exposed.push(l)
  }
  const gone = (l: Loc) => dead.includes(l)
  return {
    destroyed, prone: over.prone ?? u.prone, shutdown, pilotDown, lightsOut: shutdown || pilotDown || destroyed,
    glow: destroyed ? { colour: 'none', intensity: 0, pulse: false } : heatGlow(u.heat, shutdown),
    destroyedLocs: dead, exposedLocs: exposed,
    hideArmL: gone('LA') || gone('LT'), hideArmR: gone('RA') || gone('RT'),
    hideTorsoL: gone('LT'), hideTorsoR: gone('RT'), hideHead: gone('HD'),
    legL: gone('LL') ? 'destroyed' : 'ok', legR: gone('RL') ? 'destroyed' : 'ok',
    wreck: destroyed, twist: over.twist ?? u.attacks.twist, flipped: u.attacks.flipped,
  }
}

/** True when anything on the figure needs frames without a presentation beat (glow pulse, smoke, wreck). */
export const needsAmbient = (v: UnitVisual): boolean => v.glow.pulse || v.wreck || v.exposedLocs.length > 0 || v.destroyedLocs.length > 0

/** Which 'Mech node a location draws on. GLBs only have upper / lower / armL / armR, so most locations fold into those. */
export type NodeName = 'head' | 'torsoC' | 'torsoL' | 'torsoR' | 'armL' | 'armR' | 'legL' | 'legR' | 'upper' | 'lower'
export const LOC_NODE: Record<Loc, NodeName> = { HD: 'head', CT: 'torsoC', LT: 'torsoL', RT: 'torsoR', LA: 'armL', RA: 'armR', LL: 'legL', RL: 'legR' }
export const NODE_FALLBACK: Record<NodeName, NodeName> = {
  head: 'upper', torsoC: 'upper', torsoL: 'upper', torsoR: 'upper', armL: 'upper', armR: 'upper', legL: 'lower', legR: 'lower', upper: 'upper', lower: 'lower',
}
