import { describe, expect, it } from 'vitest'
import { hexToLabel, offsetToHex } from '../../src/engine/hex'
import { computeLos, legWeaponsBlocked } from '../../src/engine/los'
import type { BoardHex, BoardState, Woods } from '../../src/engine/types'

type Spec = { level?: number; woods?: Woods; depth?: number }
// 16 x 17 board of flat level-0 hexes; overrides keyed by `${q},${r}`
function board(over: Record<string, Spec> = {}): BoardState {
  const hexes: Record<string, BoardHex> = {}
  for (let c = 0; c < 16; c++) for (let r = 0; r < 17; r++) {
    const hex = offsetToHex(c, r)
    const label = hexToLabel({ cols: 16, rows: 17 }, hex)!
    const o = over[`${hex.q},${hex.r}`] ?? {}
    hexes[label] = { label, hex, level: o.level ?? 0, woods: o.woods ?? 'none', depth: o.depth ?? 0, rough: false, rubble: false, pavement: false, road: [] }
  }
  return { mapId: 't', cols: 16, rows: 17, hexes, centre: { x: 0, z: 0 } }
}
const H = (q: number, r: number) => ({ q, r })
// straight line along q = 6: attacker (6,8), target (6,3); intervening (6,7)..(6,4)
const A = H(6, 8), T = H(6, 3)

describe('los', () => {
  it('LOS-001/LOS-020 endpoints included, verdict shape', () => {
    const v = computeLos(board(), { hex: A }, { hex: T })
    expect(v.hexes[0]).toEqual(A)
    expect(v.hexes[v.hexes.length - 1]).toEqual(T)
    expect(v).toMatchObject({ visible: true, attackAllowed: true, divided: false, chosen: null, alt: null, woodsPoints: 0, partialCover: false })
    expect(v.blockers).toEqual([])
  })
  it('LOS-003 mutual, adjacent always visible', () => {
    const b = board({ '6,5': { woods: 'heavy' }, '6,6': { woods: 'heavy' } })
    expect(computeLos(b, { hex: A }, { hex: T }).visible).toBe(computeLos(b, { hex: T }, { hex: A }).visible)
    expect(computeLos(b, { hex: H(6, 5) }, { hex: H(6, 6) }).visible).toBe(true)
  })
  it('LOS-005 divided: blocked branch is the default pick; stored choice wins', () => {
    const b = board({ '7,3': { level: 3 } })
    const v = computeLos(b, { hex: H(6, 4) }, { hex: H(8, 3) })
    expect(v.divided).toBe(true)
    expect(v.visible).toBe(false)
    expect(v.alt).not.toBeNull()
    const forced = computeLos(b, { hex: H(6, 4) }, { hex: H(8, 3) }, { choice: v.chosen === '+' ? '-' : '+' })
    expect(forced.visible).toBe(true)
  })
  it('LOS-011/012 hill mid-line blocks; low hill by attacker does not', () => {
    const mid = computeLos(board({ '6,5': { level: 2 } }), { hex: A }, { hex: T })
    expect(mid.visible).toBe(false)
    expect(mid.blockers[0]).toEqual({ hex: H(6, 5), reason: 'hill' })
    expect(computeLos(board({ '6,7': { level: 1 } }), { hex: A }, { hex: T }).visible).toBe(true)
  })
  it('LOS-013 woods points: light 1, heavy 2, light+heavy and 3 light block', () => {
    expect(computeLos(board({ '6,5': { woods: 'light' } }), { hex: A }, { hex: T }).woodsPoints).toBe(1)
    expect(computeLos(board({ '6,5': { woods: 'heavy' } }), { hex: A }, { hex: T }).woodsPoints).toBe(2)
    expect(computeLos(board({ '6,5': { woods: 'light' }, '6,6': { woods: 'heavy' } }), { hex: A }, { hex: T }).visible).toBe(false)
    expect(computeLos(board({ '6,4': { woods: 'light' }, '6,5': { woods: 'light' }, '6,6': { woods: 'light' } }), { hex: A }, { hex: T }).visible).toBe(false)
  })
  it('LOS-014 woods in the target or attacker hex add no points', () => {
    const v = computeLos(board({ '6,3': { woods: 'heavy' }, '6,8': { woods: 'heavy' } }), { hex: A }, { hex: T })
    expect(v.woodsPoints).toBe(0)
    expect(v.visible).toBe(true)
  })
  it('LOS-015 deep water never blocks', () => {
    expect(computeLos(board({ '6,5': { depth: 2 }, '6,6': { depth: 2 } }), { hex: A }, { hex: T }).visible).toBe(true)
  })
  it('LOS-016 prone target behind adjacent level-1 hill is blocked', () => {
    const b = board({ '6,4': { level: 1 } })
    expect(computeLos(b, { hex: A }, { hex: T }).visible).toBe(true)
    expect(computeLos(b, { hex: A }, { hex: T, prone: true }).visible).toBe(false)
  })
  it('LOS-030 hill partial cover; higher attacker none; level-2 hill blocks', () => {
    expect(computeLos(board({ '6,4': { level: 1 } }), { hex: A }, { hex: T }).partialCover).toBe(true)
    expect(computeLos(board({ '6,4': { level: 1 }, '6,8': { level: 1 } }), { hex: A }, { hex: T }).partialCover).toBe(false)
    const blk = computeLos(board({ '6,4': { level: 2 } }), { hex: A }, { hex: T })
    expect(blk.visible).toBe(false)
    expect(blk.partialCover).toBe(false)
  })
  it('LOS-031 standing in depth 1 has cover even from a high attacker', () => {
    const b = board({ '6,3': { depth: 1 }, '6,8': { level: 3 } })
    expect(computeLos(b, { hex: A }, { hex: T }).partialCover).toBe(true)
    expect(computeLos(b, { hex: A }, { hex: T, prone: true }).partialCover).toBe(false)
  })
  it('LOS-034 leg weapons blocked by attacker cover or depth 1', () => {
    expect(legWeaponsBlocked(board({ '6,7': { level: 1 } }), { hex: A }, { hex: T })).toBe(true)
    expect(legWeaponsBlocked(board({ '6,8': { depth: 1 } }), { hex: A }, { hex: T })).toBe(true)
    expect(legWeaponsBlocked(board(), { hex: A }, { hex: T })).toBe(false)
  })
  it('LOS-040 water line forbids attacks; both submerged allowed', () => {
    const b = board({ '6,3': { depth: 1 }, '6,2': { depth: 1 } })
    const dry = computeLos(b, { hex: H(6, 4) }, { hex: T, prone: true })
    expect(dry.visible).toBe(true)
    expect(dry.attackAllowed).toBe(false)
    expect(computeLos(b, { hex: H(6, 2), prone: true }, { hex: T, prone: true }).attackAllowed).toBe(true)
  })
})
