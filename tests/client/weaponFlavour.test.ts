import { describe, expect, it } from 'vitest'
import weapons from '../../src/data/core/weapons.json'
import manifest from '../../tools/audio-manifest.json'
import { AUDIO_ASSETS, AUDIO_BY_ID } from '../../src/client/audio/manifest'
import { FLAVOURS, matchFlavour, weaponFlavour } from '../../src/client/weaponFlavour'

const ids = (weapons as { id: string }[]).map((w) => w.id)

describe('weapon flavours', () => {
  it('every weapon in the data has a flavour', () => {
    const missing = ids.filter((id) => !matchFlavour(id))
    expect(missing).toEqual([])
  })

  it('flavour ids are unique and every sound exists in the audio manifest', () => {
    expect(new Set(FLAVOURS.map((f) => f.id)).size).toBe(FLAVOURS.length)
    for (const f of FLAVOURS) {
      expect(AUDIO_BY_ID[f.sfx], `${f.id} sfx ${f.sfx}`).toBeDefined()
      expect(AUDIO_BY_ID[f.impact], `${f.id} impact ${f.impact}`).toBeDefined()
    }
  })

  it('the longest slug wins', () => {
    expect(matchFlavour('is.w.streak-srm-6')?.id).toBe('srm')
    expect(matchFlavour('cl.w.er-large-laser')?.id).toBe('laser-er')
    expect(matchFlavour('cl.w.heavy-medium-laser')?.id).toBe('laser-heavy')
    expect(matchFlavour('is.w.small-x-pulse-laser')?.id).toBe('laser-xpulse')
    expect(matchFlavour('is.w.medium-pulse-laser')?.id).toBe('laser-pulse')
    expect(matchFlavour('is.w.snub-nose-ppc')?.id).toBe('ppc-light')
    expect(matchFlavour('cl.w.ultra-ac-10')?.id).toBe('ultra-ac')
    expect(matchFlavour('cl.w.lb-20x')?.id).toBe('lbx')
    expect(matchFlavour('is.w.ac-10')?.id).toBe('autocannon')
    expect(weaponFlavour('unknown.thing').id).toBe('laser-medium')
  })

  it('the runtime audio manifest mirrors tools/audio-manifest.json', () => {
    expect(AUDIO_ASSETS.map((a) => a.id)).toEqual(manifest.items.map((i) => i.id))
    expect(AUDIO_ASSETS.length).toBeGreaterThanOrEqual(60)
  })
})
