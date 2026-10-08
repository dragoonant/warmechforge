// describe.* (00 §11.3): ammunition reads by its display name, never by a raw data id.
import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data/index'
import type { ChooseAmmoAction } from '../../src/engine/actions'
import { ammoLabel } from '../../src/engine/describe'
import { createGame, describe as text } from '../../src/engine/index'
import type { GameState, PendingDecision } from '../../src/engine/types'
import { introSetup } from '../../tools/sim'

const bundle = loadBundle()
const base = createGame(introSetup(bundle, 'mission.intro', 5), 'describe', bundle).state

/** The first unit given an MML 5 with an LRM and an SRM bin, and an open chooseAmmo decision for it. */
function withAmmoChoice(): { s: GameState; unitId: string } {
  const unitId = base.unitOrder[0]!
  const u = base.units[unitId]!
  const mounts = { ...u.mounts, mml: { id: 'mml', item: 'is.w.mml-5', location: 'RT', split: null, rear: false, linkedTo: null, critHits: 0, destroyed: false } }
  const bins = {
    ...u.bins,
    b1: { id: 'b1', ammo: 'is.ammo.mml-5-lrm', location: 'RT', shots: 24, capacity: 24, exploded: false },
    b2: { id: 'b2', ammo: 'is.ammo.mml-5-srm', location: 'RT', shots: 1, capacity: 20, exploded: false },
  }
  const pending: PendingDecision = {
    id: 'd:99', player: u.owner, kind: 'chooseAmmo', phase: 'rangedAttack', step: 'ranged.declare', unitId, canPass: false,
    context: { phase: 'rangedAttack', mountId: 'mml', bins: [{ binId: 'b1', ammo: 'is.ammo.mml-5-lrm', shots: 24 }, { binId: 'b2', ammo: 'is.ammo.mml-5-srm', shots: 1 }] },
  } as PendingDecision
  const s = { ...base, units: { ...base.units, [unitId]: { ...u, mounts, bins } }, pending } as unknown as GameState
  return { s, unitId }
}

describe('describe: ammunition names', () => {
  it('ammoLabel uses the record name with a shot count', () => {
    expect(ammoLabel(base, 'is.ammo.mml-5-lrm', 24)).toBe('MML 5 LRM ammo (24 shots)')
    expect(ammoLabel(base, 'is.ammo.srm-6', 1)).toBe('SRM 6 ammo (1 shot)')
    expect(ammoLabel(base, 'is.ammo.lrm-10')).toBe('LRM 10 ammo')
    expect(ammoLabel(base, 'no.such.ammo', 3)).toBe('no.such.ammo (3 shots)')
  })

  it('chooseAmmo decision lines and the answer read as names, not ids', () => {
    const { s, unitId } = withAmmoChoice()
    const d = text.decision(s, s.pending)
    expect(d.lines).toEqual(['MML 5 LRM ammo (24 shots)', 'MML 5 SRM ammo (1 shot)'])
    expect(d.prompt).toContain('MML 5')
    for (const line of [d.prompt, ...d.lines]) expect(line).not.toMatch(/is\.ammo\.|is\.w\./)
    const a: ChooseAmmoAction = { type: 'chooseAmmo', decisionId: 'd:99', player: s.pending.player, mountId: 'mml', binId: 'b2' }
    expect(text.action(s, a)).toBe(`${s.units[unitId]!.name} loads MML 5 SRM ammo into the MML 5`)
  })
})
