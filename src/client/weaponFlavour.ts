// One flavour per weapon, read by BOTH the sound and the VFX layers so a gun never plays another gun's sound.
// A weapon id (e.g. "cl.w.er-large-laser") maps to the flavour whose slug is the LONGEST slug contained in it.
export interface Flavour {
  id: string
  /** Slugs matched against the weapon id; the longest contained slug wins. */
  slugs: readonly string[]
  /** Sound id in audio-manifest (the shot or strike). */
  sfx: string
  /** Sound id for the hit landing (defaults to the armor clang). */
  impact: string
  /** VFX hint for the projectile layer. */
  vfx: 'beam' | 'pulse' | 'bolt' | 'shell' | 'scatter' | 'burst' | 'gauss' | 'missile' | 'physical'
  melee: boolean
}

const R = (id: string, slugs: string[], sfx: string, vfx: Flavour['vfx'], impact = 'dm-armor'): Flavour => ({ id, slugs, sfx, impact, vfx, melee: false })
const P = (id: string, slugs: string[], sfx: string): Flavour => ({ id, slugs, sfx, impact: sfx, vfx: 'physical', melee: true })

export const FLAVOURS: readonly Flavour[] = [
  R('laser-small', ['small-laser'], 'wp-laser-small', 'beam'),
  R('laser-medium', ['medium-laser', 'laser'], 'wp-laser-medium', 'beam'),
  R('laser-large', ['large-laser'], 'wp-laser-large', 'beam'),
  R('laser-er', ['er-small-laser', 'er-medium-laser', 'er-large-laser'], 'wp-laser-er', 'beam'),
  R('laser-pulse', ['pulse-laser'], 'wp-laser-pulse', 'pulse'),
  R('laser-heavy', ['heavy-small-laser', 'heavy-medium-laser', 'heavy-large-laser'], 'wp-laser-heavy', 'beam'),
  R('laser-xpulse', ['x-pulse-laser'], 'wp-laser-xpulse', 'pulse'),
  R('ppc', ['ppc'], 'wp-ppc', 'bolt'),
  R('ppc-light', ['snub-nose-ppc', 'light-ppc'], 'wp-ppc-light', 'bolt'),
  R('autocannon', ['autocannon', '.ac-', '-ac-'], 'wp-ac', 'shell'),
  R('lbx', ['lb-'], 'wp-ac-lbx', 'scatter'),
  R('ultra-ac', ['ultra-ac'], 'wp-ac-ultra', 'shell'),
  R('rotary-ac', ['rotary-ac'], 'wp-ac-rotary', 'burst'),
  R('proto-ac', ['protomech-ac', 'proto-ac'], 'wp-ac-proto', 'shell'),
  R('gauss', ['gauss'], 'wp-gauss', 'gauss'),
  R('lrm', ['lrm'], 'wp-lrm', 'missile', 'wp-missile-impact'),
  R('srm', ['srm', 'streak'], 'wp-srm', 'missile', 'wp-missile-impact'),
  R('mml', ['mml', 'mrm', 'atm'], 'wp-mml', 'missile', 'wp-missile-impact'),
  R('machine-gun', ['machine-gun', 'mg-'], 'wp-mg', 'burst'),
  P('punch', ['punch', 'fist'], 'ph-punch'),
  P('kick', ['kick'], 'ph-kick'),
  P('charge', ['charge'], 'ph-charge'),
  P('dfa', ['dfa', 'death-from-above'], 'ph-dfa'),
  P('hatchet', ['hatchet', 'sword', 'mace', 'club'], 'ph-punch'),
]

export const FLAVOUR_BY_ID: Readonly<Record<string, Flavour>> = Object.fromEntries(FLAVOURS.map((f) => [f.id, f]))

/** The flavour whose slug is the longest slug contained in the weapon id, or undefined when none matches. */
export function matchFlavour(weaponId: string): Flavour | undefined {
  const id = weaponId.toLowerCase()
  let best: Flavour | undefined
  let bestLen = 0
  for (const f of FLAVOURS) {
    for (const s of f.slugs) {
      if (s.length > bestLen && id.includes(s)) { best = f; bestLen = s.length }
    }
  }
  return best
}

/** Flavour for a weapon id; ids no slug matches fall back to the medium laser (ranged) or the punch (melee). */
export function weaponFlavour(weaponId: string, melee = false): Flavour {
  return matchFlavour(weaponId) ?? FLAVOUR_BY_ID[melee ? 'punch' : 'laser-medium']!
}
