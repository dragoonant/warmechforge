// HUD view models (50 §17): dice renderers, prompt / fire sentences, move view, sheet view, feed, heat scale, physical panel,
// top bar and end screen. Headless: the views are pure; games are played through the client store at speed 0.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ROLL_PURPOSES, query, type GameEvent, type DiceRolled, type FirePlan, type GameState, type Loc, type PendingDecision, type SheetView } from '../../src/engine/index'
import { newGame, resetGameStore, useGameStore, legalFor } from '../../src/client/store/gameStore'
import { memoryStorage, setStorage } from '../../src/client/store/storage'
import { useSettingsStore } from '../../src/client/store/settingsStore'
import { createBotDriver, loadBotBrain } from '../../src/client/bot/botDriver'
beforeAll(async () => { await loadBotBrain() })
import { usePresentedStore } from '../../src/client/presentation/presentedStore'
import { setDirectorClock, setPaused } from '../../src/client/presentation/director'
import { groupReach, queryFirePreview, queryPhysicalOptions, queryReach, querySheet } from '../../src/client/contract'
import { PURPOSE_RENDERERS, keptFlags, rollTarget, viewRoll } from '../../src/client/dice/diceView'
import { modPhrases, heatParts, heatTotalText, heatRisk, heatEffectChips, tnClause, oddsWord } from '../../src/client/ui/format'
import { buildDoll, buildWeaponRows as buildSheetWeapons, buildCrits, buildMp, buildPilot, parseRanges, statusChips, armorPercent } from '../../src/client/ui/sheet/sheetView'
import { buildThresholds, buildSegments, heatTone } from '../../src/client/ui/heatView'
import { buildFeed } from '../../src/client/ui/feedView'
import { buildWeaponRows, fireSentence, heatLine, toggleShot, orderShots, setShotTarget } from '../../src/client/ui/fireView'
import { buildPhysicalRows, physicalSentence } from '../../src/client/ui/physicalView'
import { facingChoices, hexTones, modeButtons, psrFlags, resultStrip, standChoices, standSentence } from '../../src/client/ui/moveView'
import { buildPromptView, PANEL_KINDS } from '../../src/client/ui/promptView'
import { initiativeStrip, decisionLine, modeFor } from '../../src/client/ui/topbarView'
import { buildOver } from '../../src/client/ui/gameOverView'


const INTRO = { mission: 'mission.intro', turnLimit: 30 } as const

beforeEach(() => {
  setStorage(memoryStorage())
  setDirectorClock(null)
  useSettingsStore.getState().set({ speed: 0, narration: true })
  setPaused(false)
  resetGameStore()
})
afterEach(() => { setDirectorClock(null); setPaused(false) })

/** Bot-vs-bot until `stop` accepts the open decision; returns the state at that point (or null if the game ended first). */
function playUntil(seed: string, stop: (pd: PendingDecision, s: GameState) => boolean, max = 6000): GameState | null {
  expect(newGame({ ...INTRO, controllers: { A: 'bot', B: 'bot' }, seed })).toBeNull()
  const driver = createBotDriver({ thinkMs: 0 })
  for (let i = 0; i < max; i++) {
    const g = useGameStore.getState()
    if (!g.state || !g.pending || g.pending.kind === 'gameOver') return null
    if (stop(g.pending, g.state)) return g.state
    driver.tick()
  }
  return null
}

function playToEnd(seed: string): GameState {
  expect(newGame({ ...INTRO, controllers: { A: 'bot', B: 'bot' }, seed })).toBeNull()
  const driver = createBotDriver({ thinkMs: 0 })
  for (let i = 0; i < 8000 && useGameStore.getState().pending?.kind !== 'gameOver'; i++) driver.tick()
  return useGameStore.getState().state!
}

const sumMods = (mods: readonly { value: number; code: string }[]): number => mods.reduce((n, m) => n + m.value, 0)

describe('HUD dice tray', () => {
  it('DICE-001 every engine roll purpose has a renderer, and an unknown one still renders', () => {
    for (const p of ROLL_PURPOSES) expect(typeof PURPOSE_RENDERERS[p], p).toBe('function')
    const ev = { type: 'DiceRolled', rollId: 'r:1', purpose: 'mystery', dice: [3, 4], kept: [3, 4], total: 7 } as unknown as DiceRolled
    const v = viewRoll({ seq: 1, event: ev, label: 'Mystery' }, null, [])
    expect(v.verdict.word).toBe('7')
  })

  it('DICE-002 the target comes from the state when it holds the attack, else from the event', () => {
    const s = playUntil('dice-2', (pd, st) => pd.kind === 'declareFire' && (pd.context.targets?.length ?? 0) > 0)
    expect(s).not.toBeNull()
    const pd = s!.pending
    const sheet = querySheet(pd.unitId!)!
    const w = sheet.weapons.find((x) => !x.destroyed)!
    const t = pd.context.targets![0]!
    // fake a declaration into a copy of the state: the roll's own target is deliberately wrong
    const decl = { kind: 'ranged', attackId: 'a:9', attackerId: pd.unitId!, mountId: w.mountId, targetId: t, targetHex: { q: 0, r: 0 }, binId: null, ammoId: null, rapidShots: null, aimedAt: null, primary: true, tn: 7, mods: [], distance: 3, band: 'short', direction: 'front', table: 'standard', partialCover: false }
    const withDecl = { ...s!, declarations: [decl] } as unknown as GameState
    const ev = { type: 'DiceRolled', rollId: 'r:9', purpose: 'toHit', dice: [4, 5], kept: [4, 5], total: 9, target: 11, attackId: 'a:9' } as DiceRolled
    expect(rollTarget(withDecl, ev)).toBe(7)
    expect(rollTarget(s!, ev)).toBe(11)
    const view = viewRoll({ seq: 1, event: ev, label: 'To hit' }, withDecl, [])
    expect(view.target).toBe(7)
    expect(view.verdict.word).toBe('HIT')
  })

  it('DICE-003 verdict words for the spec table', () => {
    const mk = (purpose: string, total: number, target?: number, extra: Partial<DiceRolled> = {}): DiceRolled =>
      ({ type: 'DiceRolled', rollId: 'r:1', purpose, dice: [Math.ceil(total / 2), Math.floor(total / 2)], kept: [Math.ceil(total / 2), Math.floor(total / 2)], total, ...(target !== undefined ? { target } : {}), ...extra }) as DiceRolled
    const word = (ev: DiceRolled, feed: { seq: number; event: DiceRolled | import('../../src/engine/index').GameEvent }[] = []) => viewRoll({ seq: 1, event: ev, label: '' }, null, feed as never).verdict.word
    expect(word(mk('toHit', 9, 8))).toBe('HIT')
    expect(word(mk('toHit', 6, 8))).toBe('MISS')
    expect(word(mk('psr', 5, 7))).toBe('FAIL: falls')
    expect(word(mk('psr', 8, 7))).toBe('PASS')
    expect(word(mk('consciousness', 4, 5))).toBe('unconscious')
    expect(word(mk('shutdownAvoid', 8, 6))).toBe('avoided')
    expect(word(mk('startup', 3, 6))).toBe('stays down')
    expect(word(mk('ammoExplosionAvoid', 3, 4))).toBe('explodes')
    expect(word(mk('cluster', 7), [{ seq: 2, event: { type: 'ClusterResolved', attackId: 'a:1', rackSize: 10, roll: 7, modified: 7, hits: 6, groups: [5, 1] } as never }])).toBe('6 of 10 hit')
    expect(word(mk('hitLocation', 9, undefined, { unitId: 'B1' }), [{ seq: 2, event: { type: 'HitLocated', attackId: null, unitId: 'B1', group: 5, damage: 5, table: 'standard', direction: 'front', roll: 9, location: 'LT', side: 'front', tac: false } as never }])).toBe('LT')
    expect(word(mk('critCheck', 8, undefined, { unitId: 'B1' }), [{ seq: 2, event: { type: 'CritCheckRolled', unitId: 'B1', location: 'RT', roll: 8, crits: 1, blownOff: false, appliesTo: null, why: 'structure' } as never }])).toBe('1 crit')
    expect(keptFlags([1, 6, 3], [6, 3]).map((d) => d.kept)).toEqual([false, true, true])
  })

  it('DICE-004 every roll of a full game renders with a verdict', () => {
    playToEnd('dice-4')
    const log = usePresentedStore.getState().diceLog
    const feed = usePresentedStore.getState().feed
    expect(log.length).toBeGreaterThan(30)
    for (const r of log) {
      const v = viewRoll(r, usePresentedStore.getState().state, feed)
      expect(v.verdict.word.length, r.event.purpose).toBeGreaterThan(0)
      expect(v.dice.length).toBeGreaterThan(0)
    }
  })
})

describe('HUD formatting', () => {
  it('FMT-001 modifier phrases are in engine order, drop zeros, and the sentence parts add up to the TN', () => {
    const mods = [
      { code: 'gunnery', value: 4 }, { code: 'range', value: 2, detail: 'medium' }, { code: 'attackerMove', value: 1, detail: 'walk' },
      { code: 'tmm', value: 2 }, { code: 'woodsTarget', value: 1 }, { code: 'heat', value: 0 },
    ] as const
    expect(modPhrases(mods as never, { targetHexes: 5 })).toEqual(['Gunnery 4', 'medium range +2', 'you walked +1', 'target moved 5 hexes +2', "woods in the target's hex +1"])
    expect(tnClause(10, mods as never, { targetHexes: 5 })).toBe("TN 10 (Gunnery 4, medium range +2, you walked +1, target moved 5 hexes +2, woods in the target's hex +1)")
    expect(modPhrases([{ code: 'piloting', value: 5 }, { code: 'physicalBase', value: -1, detail: 'kick' }] as never)).toEqual(['Piloting 5', 'kick −1'])
    expect(oddsWord(0.72, 8, 'percent')).toBe('72%')
    expect(oddsWord(0.72, 8, 'tn')).toBe('TN 8')
  })

  it('FMT-002 heat line parts equal the engine projection', () => {
    const s = playUntil('fmt-2', (pd) => pd.kind === 'declareFire' && (pd.context.targets?.length ?? 0) > 0)!
    const pd = s.pending
    const sheet = querySheet(pd.unitId!)!
    const t = pd.context.targets![0]!
    const plan: FirePlan = { shots: sheet.weapons.filter((w) => !w.destroyed).map((w) => ({ mountId: w.mountId, targetId: t })) }
    const fire = queryFirePreview(pd.unitId!, plan)!
    const parts = heatParts(fire.heat)
    expect(parts.now + parts.moved + parts.weapons + parts.other - parts.sinks).toBe(Math.max(0, fire.heat.end))
    expect(parts.weapons).toBe(fire.weapons.filter((w) => w.legal).reduce((n, w) => n + w.heat, 0) || parts.weapons)
    expect(heatTotalText(parts)).toContain(`= ${fire.heat.end}`)
    expect(heatLine(fire).text).toBe(heatTotalText(parts))
    expect(['none', 'warn', 'danger']).toContain(heatRisk(fire.heat.effects))
    expect(Array.isArray(heatEffectChips(fire.heat.effects))).toBe(true)
  })
})

describe('HUD fire panel view', () => {
  it('FIRE-001 the sentence lists the engine mods in order and they sum to the TN; rows follow the sheet', () => {
    const s = playUntil('fire-1', (pd) => pd.kind === 'declareFire' && (pd.context.targets?.length ?? 0) > 0)!
    const pd = s.pending
    const uid = pd.unitId!
    const sheet = querySheet(uid)!
    const t = pd.context.targets![0]!
    const base = sheet.weapons.map((w) => query.attackPreview(s, { attackerId: uid, mountId: w.mountId, targetId: t }))
    const legal = base.filter((p) => p.legal)
    expect(legal.length).toBeGreaterThan(0)
    for (const p of legal) expect(sumMods(p.mods), p.mountId).toBe(p.tn)
    // one weapon
    const one = legal[0]!
    const fire1 = queryFirePreview(uid, { shots: [{ mountId: one.mountId, targetId: t }] })!
    const nameOf = (m: string) => sheet.weapons.find((w) => w.mountId === m)!.name
    const text = fireSentence(s, uid, fire1, nameOf, 'percent').text
    expect(text.startsWith(`Fire ${nameOf(one.mountId)} at ${s.units[t]!.name}? Target ${one.tn}`)).toBe(true)
    let at = 0
    for (const phrase of modPhrases(one.mods, { band: one.band })) { if (phrase.startsWith('target moved')) continue; const i = text.indexOf(phrase, at); expect(i, phrase).toBeGreaterThanOrEqual(at); at = i }
    expect(text).toContain(`+${fire1.heat.weapons} heat → ${fire1.heat.end} after sinks`)
    // rows: checked ones carry the plan preview, illegal ones carry a reason
    const rows = buildWeaponRows({ state: s, sheet, shots: [{ mountId: one.mountId, targetId: t }], base, plan: fire1.weapons, oddsMode: 'percent', primaryId: t })
    expect(rows).toHaveLength(sheet.weapons.length)
    expect(rows.find((r) => r.mountId === one.mountId)!.checked).toBe(true)
    for (const r of rows) { if (!r.legal) expect(r.disabledWhy, r.mountId).toBeTruthy(); else expect(r.line).toContain(`TN ${r.preview!.tn}`) }
    // several weapons
    if (legal.length > 1) {
      const fireN = queryFirePreview(uid, { shots: legal.map((p) => ({ mountId: p.mountId, targetId: t })) })!
      expect(fireSentence(s, uid, fireN, nameOf, 'percent').text.startsWith(`Fire ${legal.length} weapons at`)).toBe(true)
    }
    // hold fire
    const hold = queryFirePreview(uid, { shots: [] })!
    expect(fireSentence(s, uid, hold, nameOf, 'percent').text.startsWith(`Hold fire with ${s.units[uid]!.name}?`)).toBe(true)
  })

  it('FIRE-002 shot list editing keeps the primary target first and toggles', () => {
    let shots = toggleShot([], 'm1', 'B1', 'B1')
    shots = toggleShot(shots, 'm2', 'B2', 'B1')
    shots = toggleShot(shots, 'm3', 'B1', 'B1')
    expect(shots.map((s) => s.mountId)).toEqual(['m1', 'm3', 'm2'])
    expect(setShotTarget(shots, 'm2', 'B1', 'B1').map((s) => s.targetId)).toEqual(['B1', 'B1', 'B1'])
    expect(toggleShot(shots, 'm1', 'B1', 'B1').map((s) => s.mountId)).toEqual(['m3', 'm2'])
    expect(orderShots(shots, 'B2')[0]!.mountId).toBe('m2')
  })
})

describe('HUD move view', () => {
  it('MOVE-001 mode buttons show MP from the sheet; facing arrows are enabled only for listed facings; tones by mode', () => {
    const s = playUntil('move-1', (pd) => pd.kind === 'move' && !pd.context.entry)!
    const uid = s.pending.unitId!
    const reach = queryReach(uid)
    const sheet = querySheet(uid)!
    const modes = [...new Set(reach.map((e) => e.mode))]
    const buttons = modeButtons(modes, sheet)
    expect(buttons.find((b) => b.mode === 'walk')!.text).toBe(`Walk ${sheet.mp.walk}`)
    expect(buttons.find((b) => b.mode === 'run')!.text).toBe(`Run ${sheet.mp.run}`)
    const walk = groupReach(reach.filter((e) => e.mode === 'walk' && !e.physical))
    const g = [...walk.values()].find((x) => x.facings.length > 0)!
    const choices = facingChoices(g)
    for (const c of choices) expect(c.enabled).toBe(g.facings.includes(c.facing))
    const tones = hexTones(reach)
    expect([...tones.values()].every((t) => ['walk', 'run', 'jump'].includes(t))).toBe(true)
    const e = g.cheapest
    const strip = resultStrip(s, e, sheet)
    expect(strip).toContain(`${e.mpUsed}/${sheet.mp.walk} MP`)
    expect(strip).toContain(`${e.heat >= 0 ? '+' : '−'}${Math.abs(e.heat)} heat`)
    for (const f of psrFlags(reach.find((x) => x.psrs.length > 0) ?? e)) expect(f).toContain('TN')
  })

  it('MOVE-002 stand-up sentence names the roll, target and odds', () => {
    const txt = standSentence(null, 'A1', { tn: 4, mods: [{ code: 'piloting', value: 5 }, { code: 'stand', value: -1 }], p: 0.917, auto: false })
    expect(txt).toBe('A1 is prone. Stand up? PSR TN 4 (Piloting 5, standing up −1) = 92%. Fail: fall again.')
    const s = playUntil('phys-1', (pd) => pd.kind === 'standUp', 6000)
    expect(s).not.toBeNull()
    {
      const choices = standChoices(legalFor(s!))
      expect(choices.some((c) => c.attempt)).toBe(true)
      expect(choices.filter((c) => !c.attempt)).toHaveLength(1)
    }
  })
})

describe('HUD record sheet view', () => {
  const fresh = (): SheetView => {
    const s = playUntil('sheet-1', () => true)!
    return querySheet(s.unitOrder[0]!)!
  }

  it('SHEET-001 a fresh unit is all full; hits flip cells to damaged, exposed and destroyed', () => {
    const sheet = fresh()
    const doll = buildDoll(sheet)
    expect(doll.front).toHaveLength(8)
    expect(doll.rear.map((c) => c.loc)).toEqual(['LT', 'CT', 'RT'])
    expect(doll.front.every((c) => c.state === 'full' && c.armorFrac === 1)).toBe(true)
    const hurt: SheetView = JSON.parse(JSON.stringify(sheet))
    hurt.locations.LT.armor = Math.floor(hurt.locations.LT.maxArmor / 2)
    hurt.locations.RT.armor = 0
    hurt.locations.LA.armor = 0; hurt.locations.LA.structure = 0; hurt.locations.LA.destroyed = true
    const d = buildDoll(hurt)
    const by = (loc: Loc) => d.front.find((c) => c.loc === loc)!
    expect(by('LT').state).toBe('damaged')
    expect(by('RT').state).toBe('exposed')
    expect(by('LA').state).toBe('destroyed')
    expect(by('LA').destroyed).toBe(true)
    expect(by('LT').title).toBe(`LT ${hurt.locations.LT.armor}/${hurt.locations.LT.maxArmor} armor · ${hurt.locations.LT.structure}/${hurt.locations.LT.maxStructure} internal`)
    expect(armorPercent(hurt)).toBeLessThan(armorPercent(sheet))
  })

  it('SHEET-002 weapons, crit slots, MP, pilot and chips come straight from the sheet', () => {
    const sheet = fresh()
    const rows = buildSheetWeapons(sheet)
    expect(rows).toHaveLength(sheet.weapons.length)
    for (const r of rows) expect(r.short).not.toBe('-')
    expect(parseRanges('min 3, 3/6/9')).toEqual({ min: '3', short: '3', medium: '6', long: '9' })
    expect(parseRanges('-').short).toBe('-')
    const crits = buildCrits(sheet)
    expect(crits).toHaveLength(8)
    expect(crits.find((c) => c.loc === 'HD')!.slots).toHaveLength(6)
    expect(crits.find((c) => c.loc === 'CT')!.slots).toHaveLength(12)
    const hit: SheetView = JSON.parse(JSON.stringify(sheet))
    hit.slots.CT[0]!.hit = true; hit.slots.CT[0]!.destroyed = true
    expect(buildCrits(hit).find((c) => c.loc === 'CT')!.slots[0]!.hit).toBe(true)
    const mp = buildMp(sheet)
    expect(mp.map((m) => m.kind)).toEqual(['walk', 'run', 'jump'])
    const slow: SheetView = JSON.parse(JSON.stringify(sheet))
    slow.mp.walk = slow.mp.baseWalk - 1
    expect(buildMp(slow)[0]!.text).toBe(`${slow.mp.walk} (${slow.mp.baseWalk})`)
    expect(buildMp(slow)[0]!.reduced).toBe(true)
    const pilot = buildPilot({ ...sheet, pilot: { ...sheet.pilot, hits: 2 } })
    expect(pilot.boxes.filter((b) => b.hit)).toHaveLength(2)
    expect(pilot.boxes[0]!.tn).toBe(sheet.pilot.consciousnessTns[0])
    expect(pilot.boxes[5]!.tn).toBeNull()
    expect(statusChips({ ...sheet, status: { ...sheet.status, prone: true, twist: -1 } }, { status: 'active', crippled: false })).toEqual(['prone', 'twisted left'])
  })
})

describe('HUD heat scale view', () => {
  it('HEAT-V-001 thresholds come from the engine scale; the one in force and the projected one are marked', () => {
    const scale = query.heatScale()
    const thr = buildThresholds(scale, 0, null)
    expect(thr.length).toBeGreaterThan(3)
    expect(thr.every((t, i) => i === 0 || t.level > thr[i - 1]!.level)).toBe(true)
    const hot = buildThresholds(scale, 12, 20)
    expect(hot.filter((t) => t.active)).toHaveLength(1)
    expect(hot.find((t) => t.active)!.level).toBeLessThanOrEqual(12)
    expect(hot.find((t) => t.projected)!.level).toBeLessThanOrEqual(20)
    const segs = buildSegments(30, 7, 15)
    expect(segs.filter((x) => x.marker === 'current')).toHaveLength(1)
    expect(segs.find((x) => x.level === 7)!.marker).toBe('current')
    expect(segs.find((x) => x.level === 15)!.marker).toBe('projected')
    expect([heatTone(3), heatTone(5), heatTone(12), heatTone(25)]).toEqual(['grey', 'amber', 'orange', 'red'])
  })
})

describe('HUD event feed view', () => {
  it('FEED-001 a full game builds readable rows with breakdowns that add up', () => {
    const final = playToEnd('feed-1')
    const feed = usePresentedStore.getState().feed
    const rows = buildFeed(final, feed, { weaponName: (u, m) => querySheet(u)?.weapons.find((w) => w.mountId === m)?.name ?? null })
    expect(rows.length).toBeGreaterThan(40)
    expect(rows.every((r) => r.text.length > 0)).toBe(true)
    const seqs = rows.map((r) => r.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    const attacks = rows.filter((r) => / (TN \d+ rolled \d+|rolled \d+|automatic \w+) (HIT|MISS)/.test(r.text))
    expect(attacks.length).toBeGreaterThan(5)
    const hit = attacks.find((r) => r.tone !== 'miss' && r.text.includes('armor'))
    expect(hit, 'a hit row carries its armor before -> after').toBeTruthy()
    expect(hit!.text).toMatch(/\d+→\d+ armor/)
    for (const r of attacks) {
      const line = r.detail.find((d) => d.startsWith('To hit:'))
      expect(line, r.text).toBeTruthy()
    }
    expect(rows.some((r) => r.text.startsWith('Heat:'))).toBe(true)
    expect(rows.some((r) => /TN -?\d+ automatic|TN 0 /.test(r.text))).toBe(false)
  })

  it('FEED-002 move rows keep the hex and facing of the move, whatever the unit does later', () => {
    const final = playToEnd('feed-2')
    const feed = usePresentedStore.getState().feed
    const rows = buildFeed(final, feed)
    const moves = rows.filter((r) => / (walks|runs|jumps) to /.test(r.text))
    expect(moves.length).toBeGreaterThan(4)
    const moved = { ...final, units: Object.fromEntries(Object.entries(final.units).map(([k, u]) => [k, { ...u, pos: { q: 0, r: 0 }, facing: 3 }])) } as GameState
    expect(buildFeed(moved, feed).filter((r) => / (walks|runs|jumps) to /.test(r.text)).map((r) => r.text)).toEqual(moves.map((r) => r.text))
  })
})

describe('critSlot dice labels', () => {
  it('DICE-010 a rejected slot roll says the slot was already hit; the accepted roll names its slot', () => {
    const roll = (rollId: string, dice: number[]) => ({ type: 'DiceRolled', rollId, purpose: 'critSlot', dice, kept: dice, total: dice.reduce((a, b) => a + b, 0), unitId: 'u', reason: 'CT' }) as unknown as DiceRolled
    const r1 = roll('r:1', [4, 4]), r2 = roll('r:2', [1, 4])
    const hit = { type: 'CritSlotHit', unitId: 'u', location: 'CT', index: 3, token: 'gyro', itemName: 'Gyro', effect: 'gyro' } as unknown as GameEvent
    const feed = [{ seq: 2, event: r2 }, { seq: 3, event: hit }]
    const v1 = viewRoll({ seq: 1, event: r1, label: 'x' }, null, feed)
    expect(v1.verdict.word).toBe('lower half, slot 10 already hit, roll again')
    expect(v1.hideTotal).toBe(true)
    expect(viewRoll({ seq: 2, event: r2, label: 'x' }, null, feed).verdict.word).toBe('upper half, slot 4: Gyro')
  })
})

describe('HUD physical view', () => {
  it('PHYS-V-001 rows come from the engine options; the sentence names TN, odds, damage and risk', () => {
    const s = playUntil('phys-1', (pd) => pd.kind === 'declarePhysical' && (pd.context.targets?.length ?? 0) > 0, 8000)!
    expect(s).not.toBeNull()
    const pd = s.pending
    const uid = pd.unitId!
    const t = pd.context.targets![0]!
    const rows = buildPhysicalRows(s, t, queryPhysicalOptions(uid, t), legalFor(s), 'percent')
    expect(rows.length).toBeGreaterThanOrEqual(5)
    const legal = rows.filter((r) => r.legal)
    expect(legal.length).toBeGreaterThan(0)
    for (const r of legal) {
      const txt = physicalSentence(s, r, t, 'percent')
      expect(txt).toContain(`? TN ${r.previews[0]!.tn}`)
      expect(txt).toMatch(/= (\d+%|auto|impossible|<1%|>99%)/)
      expect(r.choice).toBeTruthy()
    }
    for (const r of rows.filter((x) => !x.legal)) expect(r.why).toBeTruthy()
  })
})

describe('HUD prompts and top bar', () => {
  it('PROMPT-001 selectUnit offers engine units; the title names the side, the count and the initiative', () => {
    const s = playUntil('prompt-1', (pd) => pd.kind === 'selectUnit' && (pd.context.eligible?.length ?? 0) > 1)!
    const view = buildPromptView(s, s.pending, legalFor(s))
    expect(view.title).toMatch(/pick \d of \d 'Mechs? to (move|fire|attack physically)/)
    expect(view.options.map((o) => o.id)).toEqual(s.pending.context.eligible)
    expect(view.options.every((o) => o.action.type === 'selectUnit')).toBe(true)
    expect(PANEL_KINDS.has('move')).toBe(true)
    expect(PANEL_KINDS.has('selectUnit')).toBe(false)
  })

  it('PROMPT-002 initiative ack and the strip', () => {
    expect(newGame({ ...INTRO, controllers: { A: 'human', B: 'human' }, seed: 'top-1' })).toBeNull()
    let s = useGameStore.getState().state!
    expect(s.pending.kind).toBe('initiativeAck')
    const view = buildPromptView(s, s.pending, legalFor(s))
    expect(view.options.map((o) => o.id)).toEqual(['ack'])
    expect(view.defaultId).toBe('ack')
    const strip = initiativeStrip(s)!
    expect(strip.sides).toHaveLength(2)
    expect(strip.sides.filter((x) => x.won)).toHaveLength(1)
    expect(strip.summary).toMatch(/won initiative \d+ to \d+ and acts last/)
    expect(decisionLine(s, { player: 'A', controller: 'human' }, 2)).toContain('your decision')
    expect(decisionLine(s, { player: 'B', controller: 'bot' }, 1)).toContain('(bot) is deciding')
    expect(modeFor('declareFire')).toBe('fire')
    expect(modeFor('declarePhysical')).toBe('physical')
    s = useGameStore.getState().state!
    expect(s.turn).toBeGreaterThan(0)
  })

  it('OVER-001 the end screen view carries cause, damage and losses per side', () => {
    const final = playToEnd('over-1')
    const result = final.result!
    const stats = useGameStore.getState().stats
    const v = buildOver(final, result, stats, useGameStore.getState().unitStats)
    expect(v.sides).toHaveLength(2)
    expect(v.sides[0]!.dealt).toBe(stats.A.damageDealt)
    expect(v.sides[1]!.taken).toBe(stats.B.damageTaken)
    expect(v.cause.length).toBeGreaterThan(5)
    expect(v.headline).toMatch(/wins|draw/i)
    const lost = v.sides.reduce((n, x) => n + x.destroyed, 0)
    expect(lost).toBe(Object.values(final.units).filter((u) => u.status === 'destroyed').length)
  })
})

