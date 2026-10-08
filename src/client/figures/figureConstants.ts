// Figure sizes (30-figures section 2). World units: 1 = one hex flat to flat. Client only; LEVEL_HEIGHT is the engine's.
// Heights are measured from the TOP of the base disc to the highest point, so they match the GLBs (light 0.75, assault 1.0).

export type WeightClass = 'light' | 'medium' | 'heavy' | 'assault'
export const WEIGHT_CLASSES: readonly WeightClass[] = ['light', 'medium', 'heavy', 'assault']

/** Thickness of the base disc (the GLBs carry a base of exactly this height). */
export const BASE_THICKNESS = 0.12
/** Figure height above the base disc, per weight class. */
export const HEIGHT_BY_CLASS: Readonly<Record<WeightClass, number>> = { light: 0.75, medium: 0.8333, heavy: 0.9167, assault: 1.0 }
/** Base disc radius per weight class (the GLB discs are 0.394 and 0.433). Fits inside the hex's inscribed circle (0.5). */
export const BASE_RADIUS_BY_CLASS: Readonly<Record<WeightClass, number>> = { light: 0.394, medium: 0.41, heavy: 0.42, assault: 0.433 }
/** Woods stay below the shoulders: 0.55 x the smallest figure height on the board (the board agent reads this). */
export const TREE_MAX_HEIGHT = 0.55 * HEIGHT_BY_CLASS.light
/** Prone tip angle (about 80 degrees) about the forward axis. */
export const TIP_ANGLE = 1.4
/** Shutdown slump of the upper body, radians forward. */
export const SLUMP_ANGLE = 0.25
/** Wreck tilt of the upper body, radians. */
export const WRECK_TILT = 0.6

/** Weight class from the unit's tonnage (data): light 20-35 t, medium 40-55 t, heavy 60-75 t, assault 80-100 t. */
export function weightClassOf(tonnage: number): WeightClass {
  if (tonnage <= 35) return 'light'
  if (tonnage <= 55) return 'medium'
  if (tonnage <= 75) return 'heavy'
  return 'assault'
}
