// Start screen view model, How to Play content and the coach line (pure logic, no DOM).
import { describe, expect, it } from 'vitest'
import { FAN_NOTICE } from '../../src/client/contract'
import {
  buildStartOptions, catalogue, cleanSeed, defaultForm, forceHeading, forceView, mechTitle, sideOrder, swapSides, withControl, withForce, withMission,
} from '../../src/client/ui/start/startOptions'
import { HELP_TABS, tabText } from '../../src/client/ui/help/helpContent'
import { coachKey, coachTip, dismissKey, parseCoach, shouldCoach } from '../../src/client/ui/help/coachText'
import type { DecisionKind } from '../../src/engine/index'

const cat = catalogue()

describe('start screen model', () => {
  it('lists the ready missions with Intro first and defaults to the mission forces', () => {
    expect(cat.missions[0]!.id).toBe('mission.intro')
    const f = defaultForm(cat)
    expect(f.mission).toBe('mission.intro')
    expect(f.forces).toEqual(['force.intro-a', 'force.intro-b'])
    expect(f.controllers).toEqual({ A: 'human', B: 'bot' })
    expect(forceHeading(f, 'A')).toBe('Your force')
    expect(forceHeading(f, 'B')).toBe('Enemy force')
  })

  it('rosters carry name, variant, tonnage, BV and the stock flag from the data', () => {
    const rows = cat.forces.flatMap((x) => forceView(x).rows)
    expect(rows.length).toBeGreaterThanOrEqual(4)
    for (const r of rows) {
      expect(r.tonnage).toBeGreaterThan(0)
      expect(r.bv).toBeGreaterThan(0)
      expect(r.variant).not.toBe('')
    }
    const stock = rows.filter((r) => r.stock)
    expect(stock.length).toBeGreaterThan(0)
    for (const r of stock) expect(mechTitle(r)).toMatch(/\(stock\)$/)
    for (const r of rows.filter((x) => !x.stock)) expect(mechTitle(r)).not.toMatch(/stock/)
    const v = forceView(cat.forces[0]!)
    expect(v.bv).toBe(v.rows.reduce((a, r) => a + r.bv, 0))
  })

  it('builds NewGameOptions: controllers, forces, bot tier and a clean seed', () => {
    const f = { ...defaultForm(cat), seed: '  abc  ' }
    const o = buildStartOptions(f)
    expect(o.mission).toBe('mission.intro')
    expect(o.forces).toEqual(['force.intro-a', 'force.intro-b'])
    expect(o.controllers).toEqual({ A: 'human', B: 'bot' })
    expect(o.bot).toEqual({ tier: 'normal' })
    expect(o.seed).toBe('abc')
    expect(buildStartOptions(defaultForm(cat)).seed).toBeUndefined()
    expect(cleanSeed('x'.repeat(80))).toHaveLength(40)
  })

  it('swapping sides makes B the human and puts it first', () => {
    const f = swapSides(defaultForm(cat))
    expect(buildStartOptions(f).controllers).toEqual({ A: 'bot', B: 'human' })
    expect(sideOrder(f)).toEqual(['B', 'A'])
    expect(forceHeading(f, 'B')).toBe('Your force')
    const watch = withControl(withControl(f, 'A', 'bot'), 'B', 'bot')
    expect(forceHeading(watch, 'A')).toBe('Force A')
  })

  it('skirmish lets the player pick forces and never puts the same force on both sides', () => {
    const f = withMission(defaultForm(cat), cat, 'mission.skirmish')
    expect(f.mission).toBe('mission.skirmish')
    expect(f.forces[0]).not.toBe(f.forces[1])
    const g = withForce(f, cat, 'A', f.forces[1])
    expect(g.forces[0]).toBe(f.forces[1])
    expect(g.forces[1]).not.toBe(g.forces[0])
    // a fixed mission keeps its forces when the player tries to change a side
    const intro = defaultForm(cat)
    expect(withForce(intro, cat, 'A', 'force.intro-b').forces[1]).toBe('force.intro-b')
  })
})

describe('How to Play', () => {
  const required = ['Goal', 'Your \'Mech', 'Turn sequence', 'Moving', 'Shooting', 'Damage', 'Heat', 'Piloting rolls & falls', 'Physical attacks', 'Equipment', 'Controls', 'Your first turn', 'Skirmish']
  it('has every required tab with real content', () => {
    expect(HELP_TABS.map((t) => t.title)).toEqual(required)
    expect(new Set(HELP_TABS.map((t) => t.id)).size).toBe(HELP_TABS.length)
    for (const t of HELP_TABS) {
      expect(t.blocks.length).toBeGreaterThanOrEqual(2)
      expect(tabText(t).length).toBeGreaterThan(300)
    }
  })

  it('covers the named topics', () => {
    const all = HELP_TABS.map(tabText).join('\n').toLowerCase()
    for (const w of ['initiative', 'torso twist', 'line of sight', 'target movement modifier', 'prone', 'crit', 'ammo', 'shutdown', 'seatbelt', 'charge', 'skip', 'crippled', 'gunnery', 'piloting', 'heat sink', 'cluster', 'lb-x', 'ultra', 'gauss', 'capacitor', 'masc', 'ecm', 'artemis', 'targeting computer', 'ferro-lamellor', 'picker', 'even bv']) {
      expect(all, w).toContain(w)
    }
  })

  it('keeps to our own words: no logo mention, no Alpha Strike or video-game terms', () => {
    const all = HELP_TABS.map(tabText).join('\n')
    expect(all).not.toMatch(/ghost heat|stability|evasion|alpha strike|weapon attack phase/i)
    expect(FAN_NOTICE).toMatch(/Unofficial fan project/)
    expect(FAN_NOTICE).toMatch(/Catalyst Game Labs, Topps or Microsoft/)
  })
})

describe('coach line', () => {
  const kinds: DecisionKind[] = ['deploy', 'initiativeAck', 'selectUnit', 'move', 'standUp', 'torsoTwist', 'declareFire', 'chooseAmmo', 'declarePhysical', 'powerChoice', 'choice', 'gameOver']
  it('has a sentence for every decision kind', () => {
    for (const kind of kinds) {
      const tip = coachTip({ kind, phase: 'movement', context: {} })
      expect(tip, kind).toBeTruthy()
    }
  })

  it('is contextual: phase, mp left, edge entry and engine numbers', () => {
    expect(coachTip({ kind: 'selectUnit', phase: 'movement', context: {} })).toMatch(/moves next/)
    expect(coachTip({ kind: 'selectUnit', phase: 'rangedAttack', context: {} })).toMatch(/shots/)
    expect(coachTip({ kind: 'selectUnit', phase: 'physicalAttack', context: {} })).toMatch(/physical/)
    expect(coachTip({ kind: 'move', phase: 'movement', context: { mpLeft: 3 } })).toMatch(/3 movement points/)
    expect(coachTip({ kind: 'move', phase: 'movement', context: { entry: { edge: 'south', hexes: [], facings: [] } } })).toMatch(/enters/)
    expect(coachTip({ kind: 'standUp', phase: 'movement', context: { psr: { tn: 4, mods: [], p: 0.9, auto: false } } })).toMatch(/4 or more/)
    expect(coachTip({ kind: 'choice', phase: 'rangedAttack', context: { code: 'dividedLos' } })).toMatch(/line of sight/)
  })

  it('is dismissible per kind, remembered in storage, and can be switched off', () => {
    const move = { kind: 'move' as const, phase: 'movement' as const, context: {} }
    const fire = { kind: 'declareFire' as const, phase: 'rangedAttack' as const, context: {} }
    let mem = parseCoach(null)
    expect(shouldCoach(mem, move)).toBe(true)
    mem = dismissKey(mem, coachKey(move)!)
    expect(shouldCoach(mem, move)).toBe(false)
    expect(shouldCoach(mem, fire)).toBe(true)
    // round-trips through JSON as localStorage would
    const back = parseCoach(JSON.stringify(mem))
    expect(shouldCoach(back, move)).toBe(false)
    expect(shouldCoach({ ...back, off: true }, fire)).toBe(false)
    // corrupt storage falls back to "show tips"
    expect(parseCoach('{nope')).toEqual({ off: false, seen: [] })
    expect(parseCoach('{"seen":[1,"move"]}').seen).toEqual(['move'])
    // pick-a-unit tips are remembered per phase
    expect(coachKey({ kind: 'selectUnit', phase: 'movement', context: {} })).not.toBe(coachKey({ kind: 'selectUnit', phase: 'rangedAttack', context: {} }))
  })
})
