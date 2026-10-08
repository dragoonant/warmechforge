// Code hooks (00 §11.4, 60-testing §7): every hook named in data is registered, collectHooks binds it, and core calls it.
import { afterEach, describe, expect, it, vi } from 'vitest'

const FORCED = vi.hoisted(() => ({ map: new Map<number, number[]>(), strict: { on: false } }))
vi.mock('../../src/engine/rng', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/rng')>()
  const { forcedRoll } = await import('../fixtures/forced-dice')
  return { ...real, roll: forcedRoll(real, FORCED) }
})

import { expectAllForcedUsed, force, nextRollSeq } from '../fixtures/forced-dice'
import { loadBundle } from '../../src/data/index'
import { createGame, collectHooks, registeredHooks, HOOK_POINTS } from '../../src/engine/index'
import { critCheck } from '../../src/engine/crits'
import type { GameState } from '../../src/engine/types'
import { introSetup } from '../../tools/sim'

afterEach(() => expectAllForcedUsed(FORCED))

const bundle = loadBundle()
function introState(): GameState {
  force(FORCED, 1, [6, 1], [1, 1]) // initiative: A 7, B 2
  const r = createGame(introSetup(bundle, 'mission.intro', 30), 'hooks', bundle)
  expect(r.rejection).toBeUndefined()
  return r.state
}

describe('code hooks', () => {
  it('HOOK-001 every hook named in data is registered with valid points', () => {
    const named = new Set<string>()
    for (const group of [bundle.weapons, bundle.ammo, bundle.equipment] as Record<string, { code?: string[] }>[]) {
      for (const r of Object.values(group)) for (const c of r.code ?? []) named.add(c)
    }
    for (const s of Object.values(bundle.spas) as { hook: string }[]) named.add(s.hook.startsWith('spa.') ? s.hook : `spa.${s.hook}`)
    expect(named.size).toBeGreaterThan(0)
    for (const n of named) {
      const h = registeredHooks()[n]
      expect(h, n).toBeDefined()
      for (const p of h!.points) expect(HOOK_POINTS).toContain(p)
    }
  })

  it('HOOK-002 collectHooks binds the CASE II mounts of the Eris at the crit point only', () => {
    const s = introState()
    const eris = s.unitOrder.find((id) => s.units[id]!.mechId === 'mech.eris.ers-2n')!
    const bound = collectHooks(s, eris, 'crit')
    expect(bound.map((b) => [b.hook.name, b.mountId])).toEqual([['caseIIProtect', 'case2-lt'], ['caseIIProtect', 'case2-rt']])
    expect(collectHooks(s, eris, 'toHit')).toEqual([])
    // a destroyed mount carries no hook
    const u = s.units[eris]!
    const s2 = { ...s, units: { ...s.units, [eris]: { ...u, mounts: { ...u.mounts, 'case2-lt': { ...u.mounts['case2-lt']!, destroyed: true } } } } }
    expect(collectHooks(s2, eris, 'crit').map((b) => b.mountId)).toEqual(['case2-rt'])
  })

  it('AMMO-012 caseIIProtect fires in play: a crit on the CASE II slot reaches its crit hook', () => {
    const s = introState()
    const eris = s.unitOrder.find((id) => s.units[id]!.mechId === 'mech.eris.ers-2n')!
    const idx = s.units[eris]!.slots.LT.findIndex((sl) => sl.token === '#case2-lt')
    expect(idx).toBe(11)
    const spy = vi.spyOn(registeredHooks().caseIIProtect!, 'crit')
    // crit check 9 (CASE II: -1 → 8, one crit); slot roll [4, 6]: lower block, slot 6 = index 11
    force(FORCED, nextRollSeq(s), [5, 4], [4, 6])
    const r = critCheck(s, { unitId: eris, location: 'LT', why: 'structure' }, bundle)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toMatchObject({ point: 'crit', unitId: eris, mountId: 'case2-lt', location: 'LT' })
    // not handled: the CASE II item is simply destroyed
    expect(r.state.units[eris]!.mounts['case2-lt']!.destroyed).toBe(true)
    expect(r.events.some((e) => e.type === 'ComponentDestroyed' && e.mountId === 'case2-lt')).toBe(true)
    spy.mockRestore()
  })

  it('EQUIP-011 ultraRapid is registered as a no-op that never rolls', () => {
    const s = introState()
    const h = registeredHooks().ultraRapid!
    expect(h.points).toEqual(['attackRolled'])
    const before = s.rollSeq
    const res = h.attackRolled!({ state: s, point: 'attackRolled', unitId: 'A1', sourceId: 'x' })
    expect(res.state).toBe(s)
    expect(res.events).toEqual([])
    expect(res.state.rollSeq).toBe(before)
  })
})
