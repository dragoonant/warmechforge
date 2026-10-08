// M8 client: skirmish options (turn limit, forced withdrawal, AI force picker), special-equipment view models, and the
// playtest fixes kept honest (twist outcomes, heat scale life support, feed from events).
import { describe, expect, it } from 'vitest'
import {
  FORCE_PICK_TOLERANCE, TURN_LIMITS, aiPickForce, buildStartOptions, catalogue, defaultForm, evenSide, sideTotal, withMission,
} from '../../src/client/ui/start/startOptions'
import { buildSetup } from '../../src/client/store/setup'
import { capacitorOf, chargeSentence, equipmentChips, mascLines, mascOf, podOf, podSentence, rapidModesOf, toggleCharge, toggleRapid } from '../../src/client/ui/equipView'
import { buildWeaponRows, twistOutcomes, weaponLine } from '../../src/client/ui/fireView'
import { heatEffectChips } from '../../src/client/ui/format'
import { query, createGame } from '../../src/engine/index'
import type { FireShot } from '../../src/engine/index'
import { bundle } from '../../src/client/store/setup'

const cat = catalogue()
const skirmish = () => withMission(defaultForm(cat), cat, 'mission.skirmish')

describe('skirmish options', () => {
  it('SKM-001 turn limit and forced withdrawal flow into the engine setup', () => {
    expect(TURN_LIMITS.map((t) => t.value)).toEqual([null, 8, 12, 16])
    const f = { ...skirmish(), turnLimit: 12, forcedWithdrawal: true }
    const o = buildStartOptions(f, cat)
    expect(o.turnLimit).toBe(12)
    expect(o.forcedWithdrawal).toBe(true)
    const setup = buildSetup(o, { A: 'human', B: 'bot' })
    expect(setup.turnLimit).toBe(12)
    expect(setup.forcedWithdrawal).toBe(true)
    const none = buildSetup(buildStartOptions(skirmish(), cat), { A: 'human', B: 'bot' })
    expect(none.turnLimit).toBeNull()
    expect(none.forcedWithdrawal).toBe(false)
  })

  it('SKM-002 non-skirmish missions leave the mission defaults alone', () => {
    const o = buildStartOptions(defaultForm(cat), cat)
    expect(o.turnLimit).toBeUndefined()
    expect(o.forcedWithdrawal).toBeUndefined()
  })

  it('SKM-003 AI picks a force: the enemy side lands within 10% of yours, deterministic by seed', () => {
    for (const seed of ['', 'alpha', 'bravo', '7']) {
      for (const mine of [[{ mech: 'mech.regent.a', gunnery: 4, piloting: 5 }], skirmish().picks[0]]) {
        const base = { ...skirmish(), seed, picks: [mine, skirmish().picks[1]] as [typeof mine, typeof mine] }
        const side = evenSide(base)
        const a = aiPickForce(base, cat)
        const target = sideTotal(cat, mine).bv
        const got = sideTotal(cat, a.picks[side === 'A' ? 0 : 1]).bv
        expect(Math.abs(got - target)).toBeLessThanOrEqual(target * FORCE_PICK_TOLERANCE)
        expect(a.picks[side === 'A' ? 0 : 1].length).toBeGreaterThanOrEqual(1)
        expect(a.picks[side === 'A' ? 0 : 1].length).toBeLessThanOrEqual(4)
        // the other side is untouched
        expect(a.picks[side === 'A' ? 1 : 0]).toEqual(base.picks[side === 'A' ? 1 : 0])
        // same seed, same press: same force
        expect(aiPickForce(base, cat).picks).toEqual(a.picks)
      }
    }
  })

  it('SKM-004 pressing again (or another seed) rolls a different force', () => {
    const base = { ...skirmish(), seed: 'alpha' }
    const once = aiPickForce(base, cat)
    const twice = aiPickForce(once, cat)
    const key = (f: typeof once) => JSON.stringify(f.picks[1])
    expect(once.pickRoll).toBe(1)
    expect(twice.pickRoll).toBe(2)
    const keys = new Set([key(once), key(twice), key(aiPickForce({ ...base, seed: 'zulu' }, cat)), key(aiPickForce({ ...base, seed: 'yankee' }, cat))])
    expect(keys.size).toBeGreaterThan(1)
  })
})

describe('special equipment view models', () => {
  const start = () => {
    const form = {
      ...skirmish(), picks: [
        [{ mech: 'mech.regent.a', gunnery: 4, piloting: 5 }, { mech: 'mech.solitaire.2', gunnery: 4, piloting: 5 }, { mech: 'mech.vulture-mk-iv.a', gunnery: 4, piloting: 5 }],
        [{ mech: 'mech.eris.ers-2h', gunnery: 4, piloting: 5 }],
      ] as [ReturnType<typeof skirmish>['picks'][0], ReturnType<typeof skirmish>['picks'][1]],
    }
    const setup = buildSetup(buildStartOptions(form, cat), { A: 'human', B: 'bot' })
    const r = createGame(setup, 'm8-equip', bundle())
    return r.state
  }

  it('EQV-001 a PPC finds its capacitor, a Vulture finds its Ultra AC double tap, a pod and MASC are found on the sheet', () => {
    const s = start()
    const ids = s.unitOrder
    const regent = ids.find((i) => s.units[i]!.name.startsWith('Regent'))!
    const sol = ids.find((i) => s.units[i]!.name.startsWith('Solitaire'))!
    const vul = ids.find((i) => s.units[i]!.name.startsWith('Vulture'))!
    const rs = query.sheet(s, regent)
    const ppcs = rs.weapons.filter((w) => /PPC/.test(w.name))
    expect(ppcs.length).toBe(3)
    for (const w of ppcs) expect(capacitorOf(s, rs, regent, w.mountId)?.state).toBe('ready')
    expect(capacitorOf(s, rs, regent, rs.weapons.find((w) => !/PPC/.test(w.name))?.mountId ?? 'x')).toBeNull()
    expect(podOf(rs)?.state).toBe('ready')
    expect(mascOf(query.sheet(s, sol))?.state).toBe('ready')
    expect(mascOf(rs)).toBeNull()
    const vs = query.sheet(s, vul)
    const uac = vs.weapons.find((w) => /Ultra/.test(w.name))!
    expect(rapidModesOf(s, vul, uac.mountId)).toEqual([2])
    expect(rapidModesOf(s, vul, vs.weapons.find((w) => !/Ultra/.test(w.name))!.mountId)).toEqual([])
  })

  it('EQV-002 charge and pod previews come from the engine: charge adds 5 heat, the pod lowers the end heat', () => {
    const s = start()
    const regent = s.unitOrder.find((i) => s.units[i]!.name.startsWith('Regent'))!
    const sheet = query.sheet(s, regent)
    const ppc = sheet.weapons.find((w) => /PPC/.test(w.name))!.mountId
    const none = query.firePreview(s, regent, { shots: [] })
    const charged = query.firePreview(s, regent, { shots: [], charge: [ppc] })
    expect(charged.heat.generated - none.heat.generated).toBe(5)
    const pod = podOf(sheet)!.mountId
    const hot = query.firePreview(s, regent, { shots: [], charge: [ppc], coolantPod: pod })
    expect(hot.heat.dissipation).toBeGreaterThan(charged.heat.dissipation)
    expect(hot.heat.end).toBeLessThanOrEqual(charged.heat.end)
    expect(podSentence(10, 4, false)).toContain('4 heat instead of 10')
    expect(podSentence(0, 0, true)).toContain('would not change')
    expect(chargeSentence(['ER PPC (LT)'])).toMatch(/\+5 damage next turn, \+5 heat now, cannot fire this turn/)
  })

  it('EQV-003 shot toggles: rapid adds the shot, then turns off while it stays picked; charging drops the PPC shot', () => {
    let shots: FireShot[] = []
    shots = toggleRapid(shots, 'uac', 'enemy')
    expect(shots).toEqual([{ mountId: 'uac', targetId: 'enemy', rapidShots: 2 }])
    shots = toggleRapid(shots, 'uac', 'enemy')
    expect(shots).toEqual([{ mountId: 'uac', targetId: 'enemy' }])
    const r = toggleCharge([], [{ mountId: 'ppc', targetId: 'enemy' }, { mountId: 'ml', targetId: 'enemy' }], 'ppc')
    expect(r.charge).toEqual(['ppc'])
    expect(r.shots.map((x) => x.mountId)).toEqual(['ml'])
    expect(toggleCharge(r.charge, r.shots, 'ppc').charge).toEqual([])
  })

  it('EQV-004 rows: a charging PPC is disabled and a double tap line says how many of the two hit', () => {
    const s = start()
    const vul = s.unitOrder.find((i) => s.units[i]!.name.startsWith('Vulture'))!
    const sheet = query.sheet(s, vul)
    const uac = sheet.weapons.find((w) => /Ultra/.test(w.name))!
    const enemy = s.unitOrder.find((i) => s.units[i]!.owner !== s.units[vul]!.owner)!
    const pv1 = query.attackPreview(s, { attackerId: vul, mountId: uac.mountId, targetId: enemy })
    const pv2 = query.attackPreview(s, { attackerId: vul, mountId: uac.mountId, targetId: enemy, rapidShots: 2 })
    expect(pv2.heat).toBe(pv1.heat * 2)
    const legal2 = { ...pv2, legal: true, tn: 6, damage: 10, band: 'short' as const, cluster: { rackSize: 2, expectedHits: 1.4 } }
    expect(weaponLine(s, uac.name, uac.location, false, legal2, 'tn', 2)).toMatch(/10 per shot, about 1.4 of 2 hit/)
    expect(weaponLine(s, uac.name, uac.location, false, { ...legal2, cluster: null }, 'tn', 1)).not.toMatch(/of 2 hit/)
    const rows = buildWeaponRows({ state: s, sheet, shots: [], base: [], plan: [], oddsMode: 'tn', primaryId: enemy, charging: [uac.mountId] })
    expect(rows.find((r) => r.mountId === uac.mountId)!.disabledWhy).toBe('charging its capacitor')
  })

  it('EQV-005 MASC lines give the avoid number and the extra MP; the record sheet lists every state', () => {
    const s = start()
    const sol = s.unitOrder.find((i) => s.units[i]!.name.startsWith('Solitaire'))!
    const sheet = query.sheet(s, sol)
    const m = mascOf(sheet)!
    const lines = mascLines(sheet, m)
    expect(lines.label).toBe(`MASC: +${(m.mascRun ?? 0) - sheet.mp.run} MP`)
    expect(lines.note).toContain(`${m.avoidTn}+`)
    expect(lines.note).toContain(`${m.mascRun} MP instead of ${sheet.mp.run}`)
    expect(lines.risk).toMatch(/wrecked/)
    expect(equipmentChips(sheet).some((c) => c.text.includes(`avoid ${m.avoidTn}+`))).toBe(true)
    const regent = s.unitOrder.find((i) => s.units[i]!.name.startsWith('Regent'))!
    const chips = equipmentChips(query.sheet(s, regent))
    expect(chips.filter((c) => /capacitor/i.test(c.text)).length).toBe(3)
    expect(chips.some((c) => /coolant pod: ready/i.test(c.text))).toBe(true)
    const jam = { ...sheet, equipment: [{ mountId: 'x', name: 'Ultra AC/10', location: 'RA' as const, kind: 'rapidFire' as const, state: 'jammed' as const }] }
    expect(equipmentChips(jam)[0]).toMatchObject({ text: 'Ultra AC/10: jammed', tone: 'bad' })
  })
})

describe('M7 playtest majors stay fixed', () => {
  it('PLAY-001 heat effect chips mention the life-support pilot hit only for a damaged life support (HEAT-025)', () => {
    const hot = query.heatEffects(26)
    expect(hot.lifeSupportPilotHits).toBeGreaterThan(0)
    expect(heatEffectChips(hot).some((c) => /pilot/.test(c))).toBe(false)
    expect(heatEffectChips(hot, true).some((c) => /pilot takes \d+ hit/.test(c))).toBe(true)
  })

  it('PLAY-002 twist outcomes name the enemies each choice brings into arc, and say so when nobody is', () => {
    const s = (() => {
      const form = { ...skirmish(), picks: [[{ mech: 'mech.regent.a', gunnery: 4, piloting: 5 }], [{ mech: 'mech.eris.ers-2h', gunnery: 4, piloting: 5 }]] as ReturnType<typeof skirmish>['picks'] }
      return createGame(buildSetup(buildStartOptions(form, cat), { A: 'human', B: 'bot' }), 'play-2', bundle()).state
    })()
    const me = s.unitOrder[0]!, foe = s.unitOrder[1]!
    const placed = { ...s, units: { ...s.units, [me]: { ...s.units[me]!, pos: { q: 5, r: 5 }, status: 'active' as const }, [foe]: { ...s.units[foe]!, pos: { q: 5, r: 3 }, status: 'active' as const } } }
    const sheet = query.sheet(placed, me)
    const arcs = (front: boolean) => ({ front: front ? [{ q: 5, r: 3 }] : [], left: [], right: [], rear: [], mountArcs: Object.fromEntries(sheet.weapons.map((w) => [w.mountId, ['front' as const]])) })
    const out = twistOutcomes(placed, me, [-1, 0, 1], (t) => arcs(t === 0), sheet)
    expect(out.find((o) => o.twist === 0)!.targets.map((t) => t.id)).toEqual([foe])
    expect(out.find((o) => o.twist === 0)!.text).toMatch(/in arc \(\d+ weapons?\)/)
    expect(out.find((o) => o.twist === -1)!.text).toBe('no enemy in any arc')
  })
})
