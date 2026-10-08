// Polish pass (WP-CLIENT): auto-camera framing maths, per-'Mech end-screen tallies, hover-tooltip content, the Follow action setting.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { newGame, resetGameStore, useGameStore } from '../../src/client/store/gameStore'
import { memoryStorage, setStorage } from '../../src/client/store/storage'
import { DEFAULT_SETTINGS, SETTINGS_KEY, useSettingsStore } from '../../src/client/store/settingsStore'
import { createBotDriver, loadBotBrain } from '../../src/client/bot/botDriver'
import { setDirectorClock, setPaused } from '../../src/client/presentation/director'
import { querySheet } from '../../src/client/contract'
import { cameraPose, framePoints, MAX_DISTANCE, type PoseBounds } from '../../src/client/board/cameraPose'
import { buildOver, MINI_LOCS } from '../../src/client/ui/gameOverView'
import { buildCrits, buildWeaponRows, critTip, weaponTip } from '../../src/client/ui/sheet/sheetView'
import { buildThresholds, thresholdTip } from '../../src/client/ui/heatView'
import { query } from '../../src/engine/index'
import { overlaysPresent } from '../../src/client/optionalOverlays'

beforeAll(async () => { await loadBotBrain() })
beforeEach(() => {
  setStorage(memoryStorage())
  setDirectorClock(null)
  useSettingsStore.getState().set({ speed: 0 })
  setPaused(false)
  resetGameStore()
})
afterEach(() => { setDirectorClock(null); setPaused(false) })

function playToEnd(seed: string) {
  expect(newGame({ mission: 'mission.intro', turnLimit: 30, controllers: { A: 'bot', B: 'bot' }, seed })).toBeNull()
  const driver = createBotDriver({ thinkMs: 0 })
  for (let i = 0; i < 8000 && useGameStore.getState().pending?.kind !== 'gameOver'; i++) driver.tick()
  return useGameStore.getState().state!
}

const B: PoseBounds = { minX: -8, maxX: 8, minZ: -8, maxZ: 8, w: 16, d: 16 }

describe('auto-camera framing', () => {
  it('CAM-AUTO-001 one point gets the close follow distance, centred on it', () => {
    const f = framePoints([{ x: 3, y: 0.5, z: -2 }])
    expect(f.focus).toEqual({ x: 3, y: 0.5, z: -2 })
    expect(f.distance).toBeGreaterThanOrEqual(10)
    expect(f.distance).toBeLessThan(13)
  })
  it('CAM-AUTO-002 an acting unit and a far target are both framed: centre between, pulled back, never past the limit', () => {
    const near = framePoints([{ x: 0, z: 0 }, { x: 2, z: 0 }])
    const far = framePoints([{ x: -6, z: -5 }, { x: 6, z: 5 }])
    expect(far.focus.x).toBe(0)
    expect(far.focus.z).toBe(0)
    expect(far.distance).toBeGreaterThan(near.distance)
    expect(far.distance).toBeLessThanOrEqual(MAX_DISTANCE)
    expect(framePoints([]).distance).toBe(11)
  })
  it('CAM-AUTO-003 the frame preset honours focus, distance and the angles it is given', () => {
    const p = cameraPose('frame', B, { focus: { x: 1, y: 0, z: 2 }, distance: 14, azimuth: 0.5, polar: 1 })
    expect(p.target).toEqual([1, 0, 2])
    expect(p.distance).toBe(14)
    expect(p.azimuth).toBe(0.5)
    expect(p.polar).toBe(1)
  })
  it('CAM-AUTO-004 Follow action is a setting, on by default, persisted and sanitised', () => {
    expect(DEFAULT_SETTINGS.followAction).toBe(true)
    useSettingsStore.getState().set({ followAction: false })
    expect(useSettingsStore.getState().followAction).toBe(false)
    useSettingsStore.getState().reload()
    expect(useSettingsStore.getState().followAction).toBe(false)
    expect(SETTINGS_KEY).toBe('wmf.settings')
    useSettingsStore.getState().set({ followAction: 'yes' as unknown as boolean })
    expect(typeof useSettingsStore.getState().followAction).toBe('boolean')
  })
})

describe('end screen tallies', () => {
  it('OVER-002 every location of every Mech has a tally that sums to what it took, kills and heat peaks are tracked', () => {
    const final = playToEnd('polish-1')
    const g = useGameStore.getState()
    const v = buildOver(final, final.result!, g.stats, g.unitStats, querySheet)
    const units = v.sides.flatMap((s) => s.units)
    expect(units.length).toBe(Object.keys(final.units).length)
    for (const u of units) {
      expect(u.cells.map((c) => c.loc)).toEqual(MINI_LOCS)
      expect(u.cells.reduce((n, c) => n + c.damage, 0)).toBe(u.taken)
      for (const c of u.cells) { expect(c.frac).toBeGreaterThanOrEqual(0); expect(c.frac).toBeLessThanOrEqual(1) }
    }
    // damage a Mech took is damage the other side dealt, plus self-inflicted (falls, explosions)
    const taken = units.reduce((n, u) => n + u.taken, 0)
    expect(taken).toBe(g.stats.A.damageTaken + g.stats.B.damageTaken)
    // a kill is credited only to someone on the other side, and never more kills than wrecks
    const destroyed = units.filter((u) => u.fate === 'destroyed').length
    const kills = units.reduce((n, u) => n + u.kills, 0)
    expect(kills).toBeLessThanOrEqual(destroyed)
    for (const s of v.sides) expect(s.heatPeak).toBe(Math.max(...s.units.map((u) => u.heatPeak), 0))
    expect(v.cause.length).toBeGreaterThan(5)
  })
  it('OVER-003 tallies reset with a new game', () => {
    playToEnd('polish-2')
    expect(Object.keys(useGameStore.getState().unitStats).length).toBeGreaterThan(0)
    expect(newGame({ mission: 'mission.intro', controllers: { A: 'bot', B: 'bot' }, seed: 'again' })).toBeNull()
    expect(useGameStore.getState().unitStats).toEqual({})
  })
})

describe('record-sheet hover tooltips', () => {
  it('TIP-001 weapon, crit slot and heat row tips carry the sheet numbers', () => {
    expect(newGame({ mission: 'mission.intro', controllers: { A: 'human', B: 'bot' }, seed: 'tips' })).toBeNull()
    const s = useGameStore.getState().state!
    const id = s.unitOrder[0]!
    const sheet = querySheet(id)!
    const rows = buildWeaponRows(sheet)
    expect(rows.length).toBeGreaterThan(0)
    const w = rows[0]!
    const tip = weaponTip(sheet, w)
    expect(tip.title).toContain(w.name)
    expect(tip.lines.join('\n')).toContain(`Damage ${w.damage}`)
    expect(tip.lines.join('\n')).toContain(`heat ${w.heat}`)
    if (w.short !== '-') expect(tip.lines.join('\n')).toContain(`up to ${w.long}`)
    const loc = buildCrits(sheet)[0]!
    for (const slot of loc.slots) {
      const t = critTip(loc.loc, slot)
      expect((t.title ?? "").length).toBeGreaterThan(0)
      expect(t.lines[0]).toContain(`slot ${slot.index + 1}`)
    }
    const thr = buildThresholds(query.heatScale(), 0, null)
    expect(thr.length).toBeGreaterThan(1)
    const first = thresholdTip(thr[0]!, thr[1])
    expect(first.title).toMatch(/^At heat \d+ to \d+$/)
    expect(thresholdTip(thr[thr.length - 1]!, undefined).title).toMatch(/and above$/)
  })
})

describe('AI package overlays', () => {
  it('OPT-001 ThreatOverlay and AiTrace are mounted through absence-tolerant lazy imports', () => {
    expect(typeof overlaysPresent.threat).toBe('boolean')
    expect(typeof overlaysPresent.trace).toBe('boolean')
  })
})
