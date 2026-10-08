import { describe, expect, it } from 'vitest'
import { arcOfRel, attackDirection, canFire, firingArc, labelToHex, neighbor } from '../../src/engine/hex'
import type { Facing } from '../../src/engine/types'

const O = { q: 0, r: 0 }
describe('arcs', () => {
  it('ARC-001 firing arcs by rel', () => {
    for (const r of [0, 60, 300]) expect(arcOfRel(r)).toBe('forward')
    for (const r of [61, 120]) expect(arcOfRel(r)).toBe('right')
    for (const r of [121, 180, 239]) expect(arcOfRel(r)).toBe('rear')
    for (const r of [240, 299]) expect(arcOfRel(r)).toBe('left')
    expect(firingArc(labelToHex('0505')!, 0, labelToHex('0605')!)).toBe('right')
  })
  it('ARC-002 adjacent hexes for facing 0', () => {
    const exp = ['forward', 'forward', 'right', 'rear', 'left', 'forward']
    for (let d = 0; d < 6; d++) expect(firingArc(O, 0, neighbor(O, d as Facing))).toBe(exp[d])
  })
  it('ARC-003 mounts by arc', () => {
    const t90 = { q: 1, r: 0 } // bearing 120, rel 120 for facing 0 -> right side
    expect(canFire(O, 0, 0, 'torso', t90)).toBe(false)
    expect(canFire(O, 0, 0, 'rightArm', t90)).toBe(true)
    expect(canFire(O, 0, 0, 'leftArm', t90)).toBe(false)
    expect(canFire(O, 0, 0, 'rear', { q: 0, r: 4 })).toBe(true)
    expect(canFire(O, 0, 0, 'rear', { q: 0, r: -4 })).toBe(false)
  })
  it('ARC-004 twist moves torso arcs, not leg arcs', () => {
    const t = { q: 1, r: -1 } // rel 60 from facing 0 (forward); with right twist rel -> 0
    const far = { q: 1, r: 0 } // right side at facing 0
    expect(canFire(O, 0, 0, 'torso', far)).toBe(false)
    expect(canFire(O, 0, 1, 'torso', far)).toBe(true) // twisted right: far is now rel 60 forward
    expect(canFire(O, 0, 1, 'leg', far)).toBe(false) // legs keep feet facing
    expect(canFire(O, 0, 0, 'torso', t)).toBe(true)
  })
  it('ARC-020 attack direction', () => {
    const T = { q: 0, r: 0 }
    expect(attackDirection(T, 0, { q: 0, r: -4 })).toBe('front')
    expect(attackDirection(T, 0, { q: 1, r: -1 })).toBe('right') // rel 60
    expect(attackDirection(T, 0, { q: 0, r: 4 })).toBe('rear')
    expect(attackDirection(T, 0, { q: -1, r: 1 })).toBe('left') // rel 240
  })
  it('ARC-021 corner lines tie', () => {
    // far hex on a corner line: bearing 30 from target
    const r = attackDirection({ q: 0, r: 0 }, 0, { q: 2, r: -2 + 1 * 0 })
    expect(typeof r).toBe('string') // 60 degrees: a side line, no tie
    const tie = attackDirection({ q: 0, r: 0 }, 0, { q: 1, r: -2 })
    expect(tie).toEqual({ tie: ['front', 'right'] })
  })
})
