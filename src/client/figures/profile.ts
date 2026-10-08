// Unit -> figure profile: chassis key, weight class and procedural style. Data lookups only (no rules).
import type { UnitState } from '../../engine/index'
import { bundle } from '../store/setup'
import { weightClassOf, type WeightClass } from './figureConstants'

export type LegStyle = 'humanoid' | 'reverse'
export type ArmStyle = 'hand' | 'gunpod'
export type CockpitStyle = 'head' | 'nose'
export interface FigureStyle { legs: LegStyle; arms: ArmStyle; shoulderPods: 0 | 2; cockpit: CockpitStyle }

const HUMANOID: FigureStyle = { legs: 'humanoid', arms: 'hand', shoulderPods: 0, cockpit: 'head' }
const CAT: FigureStyle = { legs: 'reverse', arms: 'gunpod', shoulderPods: 2, cockpit: 'nose' }
/** Procedural styles by chassis key (30-figures section 4). Anything unlisted is humanoid. */
export const STYLE_BY_CHASSIS: Readonly<Record<string, FigureStyle>> = {
  'mad-cat-mk-ii': CAT, 'vulture-mk-iv': CAT,
  hollander: HUMANOID, rakshasa: HUMANOID, solitaire: HUMANOID, uziel: HUMANOID, regent: HUMANOID, eris: HUMANOID,
}

/** 'Mad Cat Mk II' -> 'mad-cat-mk-ii'. */
export const chassisKey = (chassis: string): string => chassis.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Chassis name of a unit from the data bundle (falls back to the middle segment of the mech id, 'mech.<chassis>.<model>'). */
export function chassisOf(mechId: string): string {
  const rec = bundle().mechs[mechId] as { chassis?: string } | undefined
  if (rec?.chassis) return rec.chassis
  return mechId.split('.')[1] ?? mechId
}
export const chassisKeyOf = (u: Pick<UnitState, 'mechId'>): string => chassisKey(chassisOf(u.mechId))

/** The data's `figure` id for a mech, when it names one ('bt-solitaire'). */
export function dataFigureSlug(mechId: string): string | undefined {
  const f = (bundle().mechs[mechId] as { figure?: string } | undefined)?.figure
  return typeof f === 'string' && f ? f : undefined
}

export const styleFor = (key: string): FigureStyle => STYLE_BY_CHASSIS[key] ?? HUMANOID

export interface FigureProfile { chassis: string; key: string; cls: WeightClass; style: FigureStyle }
export function profileOf(u: Pick<UnitState, 'mechId' | 'tonnage'>): FigureProfile {
  const key = chassisKey(chassisOf(u.mechId))
  return { chassis: chassisOf(u.mechId), key, cls: weightClassOf(u.tonnage), style: styleFor(key) }
}
