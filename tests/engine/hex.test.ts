import { describe, expect, it } from 'vitest'
import { bearing, distance, hexLine, hexToLabel, labelToHex, neighbors, offsetToHex, rel } from '../../src/engine/hex'
import { floorLevel, losLevel } from '../../src/engine/terrain'
import type { BoardHex, Facing } from '../../src/engine/types'

const sheet = { cols: 16, rows: 17 }
const L = (s: string) => labelToHex(s)!
const bh = (level: number, depth = 0): BoardHex => ({ label: '0101', hex: { q: 0, r: 0 }, level, woods: 'none', depth, rough: false, rubble: false, pavement: false, road: [] })

describe('hex', () => {
  it('HEX-003 labels round trip and worked examples', () => {
    for (let c = 0; c < 16; c++) for (let r = 0; r < 17; r++) {
      const h = offsetToHex(c, r)
      expect(labelToHex(hexToLabel(sheet, h)!)).toEqual(h)
    }
    expect(hexToLabel(sheet, { q: 0, r: 0 })).toBe('0101')
    expect(hexToLabel(sheet, { q: 1, r: 0 })).toBe('0201')
    expect(hexToLabel(sheet, { q: 6, r: 4 })).toBe('0708')
    expect(hexToLabel(sheet, { q: 7, r: 3 })).toBe('0807')
    expect(hexToLabel(sheet, { q: 8, r: 3 })).toBe('0908')
    expect(L('0505')).toEqual({ q: 4, r: 2 })
    expect(L('0605')).toEqual({ q: 5, r: 2 })
    expect(hexToLabel(sheet, { q: -1, r: 0 })).toBeNull()
  })
  it('HEX-004 neighbours in facing order', () => {
    expect(neighbors({ q: 6, r: 4 })).toEqual([{ q: 6, r: 3 }, { q: 7, r: 3 }, { q: 7, r: 4 }, { q: 6, r: 5 }, { q: 5, r: 5 }, { q: 5, r: 4 }])
    expect(neighbors(L('0505')).map((h) => hexToLabel(sheet, h))).toEqual(['0504', '0604', '0605', '0506', '0405', '0404'])
    expect(neighbors(L('0605')).map((h) => hexToLabel(sheet, h))).toEqual(['0604', '0705', '0706', '0606', '0506', '0505'])
    expect(neighbors(L('0201')).map((h) => hexToLabel(sheet, h))).toEqual([null, '0301', '0302', '0202', '0102', '0101'])
  })
  it('HEX-005 distance', () => {
    expect(distance({ q: 6, r: 6 }, { q: 6, r: 2 })).toBe(4)
    expect(distance({ q: 6, r: 4 }, { q: 8, r: 3 })).toBe(2)
    expect(distance(L('0101'), L('1617'))).toBe(24)
  })
  it('HEX-006 bearings', () => {
    expect(bearing({ q: 6, r: 6 }, { q: 6, r: 2 })).toBe(0)
    expect(bearing({ q: 6, r: 4 }, { q: 8, r: 3 })).toBe(90)
    expect(bearing({ q: 6, r: 5 }, { q: 7, r: 5 })).toBe(120)
    expect(bearing({ q: 6, r: 2 }, { q: 6, r: 6 })).toBe(180)
    expect(bearing(L('0101'), L('0201'))).toBe(120)
  })
  it('HEX-007 relative bearing', () => {
    const a = { q: 0, r: 0 }
    expect(rel(a, { q: 0, r: 5 }, 5 as Facing)).toBe(240)
    expect(rel(a, { q: 0, r: -5 }, 0)).toBe(0)
    expect(rel(a, { q: -3, r: 0 }, 5)).toBe(0)
  })
  it('HEX-008/009 floors and LOS levels', () => {
    expect(floorLevel(bh(0, 2))).toBe(-2)
    expect(floorLevel(bh(1))).toBe(1)
    expect(losLevel(bh(1), false)).toBe(3)
    expect(losLevel(bh(1), true)).toBe(2)
    expect(losLevel(bh(0, 1), false)).toBe(1)
  })
  it('LOS-002 hex lines: divided and single', () => {
    const d = hexLine({ q: 6, r: 4 }, { q: 8, r: 3 })
    expect(d.divided).toBe(true)
    expect([d.plus[1], d.minus[1]]).toContainEqual({ q: 7, r: 3 })
    expect([d.plus[1], d.minus[1]]).toContainEqual({ q: 7, r: 4 })
    const s = hexLine({ q: 6, r: 6 }, { q: 6, r: 2 })
    expect(s.divided).toBe(false)
    expect(s.plus).toEqual([{ q: 6, r: 6 }, { q: 6, r: 5 }, { q: 6, r: 4 }, { q: 6, r: 3 }, { q: 6, r: 2 }])
    const a = hexLine(L('0101'), L('0103'))
    expect(a.divided).toBe(false)
    expect(a.plus.map((h) => hexToLabel(sheet, h))).toEqual(['0101', '0102', '0103'])
    expect(hexLine(L('0101'), L('0202')).divided).toBe(true)
  })
})
