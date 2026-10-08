import { describe, expect, it } from 'vitest'
import type { DeployAction, MoveAction } from '../../src/engine/actions'
import { applyDeploy, facingTowardCentre, legalDeployActions, validateDeploy } from '../../src/engine/deploy'
import { entryFacings, executeMove, reachable, validateMove } from '../../src/engine/movement'
import { hexEq } from '../../src/engine/hex'
import type { DataBundle, GameState, StepOp } from '../../src/engine/types'
import { H, mkState, mkUnit } from './move.fixture'

const bundle = (dep: unknown): DataBundle => ({ missions: { m: { id: 'm', sides: [{ id: 'a', deployment: dep }, { id: 'b', deployment: { mode: 'edgeEntry' } }] } } }) as unknown as DataBundle
const placed = (): GameState => {
  const s = mkState([mkUnit({ id: 'A1', status: 'offBoard', pos: null }), mkUnit({ id: 'A2', status: 'offBoard', pos: null })])
  return { ...s, sides: { ...s.sides, A: { ...s.sides.A, deployment: 'edgePlace' } } }
}
const dep = (hex: { q: number; r: number }, unitId = 'A1', facing = 0): DeployAction => ({ type: 'deploy', decisionId: 'd:1', player: 'A', unitId, hex, facing: facing as DeployAction['facing'] })

describe('placed deployment (11 section 4.2-4.3)', () => {
  it('SCN-001 a placed unit starts on its hex and facing; zone, taken and off-board hexes are rejected', () => {
    const s = placed(), d = bundle({ mode: 'edgePlace', depth: 2 })
    const r = applyDeploy(s, dep(H(3, 7), 'A1', 4), d)
    expect(r.rejection).toBeUndefined()
    expect(r.state.units.A1).toMatchObject({ status: 'active', facing: 4, pos: H(3, 7) })
    expect(r.events[0]).toMatchObject({ type: 'UnitDeployed', unitId: 'A1' })
    expect(validateDeploy(s, dep(H(3, 4)), d)?.code).toBe('E_PROHIBITED_HEX')
    expect(validateDeploy(s, dep(H(3, -1)), d)?.code).toBe('E_OFF_BOARD')
    expect(validateDeploy(r.state, dep(H(3, 7), 'A2'), d)?.code).toBe('E_OCCUPIED')
    expect(validateDeploy(r.state, dep(H(2, 7), 'A1'), d)?.code).toBe('E_NOT_ELIGIBLE')
  })
  it('SCN-001 hexes mode accepts only the listed hexes, and legalActions faces the board centre', () => {
    const s = placed()
    const d = bundle({ mode: 'hexes', hexes: ['0108', '0208'] })
    expect(validateDeploy(s, dep(H(0, 7)), d)).toBeNull()
    expect(validateDeploy(s, dep(H(5, 7)), d)?.code).toBe('E_PROHIBITED_HEX')
    const legal = legalDeployActions(s, 'd:1', 'A', d)
    expect(legal).toHaveLength(4)
    expect(legal.every((a) => validateDeploy(s, a, d) === null)).toBe(true)
    expect(facingTowardCentre(s, H(4, 8))).toBe(0)
    expect(facingTowardCentre(s, H(4, 0))).toBe(3)
  })
})

describe('edge entry (11 section 4.1, 10 SCN-002)', () => {
  const entering = () => mkState([mkUnit({ id: 'A1', status: 'offBoard', pos: null })], { '0509': { woods: 'heavy' } })
  const virt = H(4, 9) // one row below the south edge, facing north onto the edge hex (4,8)
  const enter = (steps: StepOp[], over: Partial<MoveAction> = {}): MoveAction => ({
    type: 'move', decisionId: 'd:1', player: 'A', unitId: 'A1', mode: 'walk', facing: 0, entry: { hex: virt, facing: 0 },
    steps: steps.map((op) => ({ op })), ...over,
  }) as MoveAction
  it('SCN-002 the first step pays the edge hex cost, counts for TMM, and the unit ends on the board', () => {
    const s = entering()
    const r = executeMove(s, enter(['forward', 'forward', 'forward']))
    if ('rejection' in r) throw new Error(r.rejection.message)
    const u = r.state.units.A1!
    expect(u).toMatchObject({ status: 'active', pos: H(4, 6) })
    expect(u.move).toMatchObject({ mpSpent: 5, hexesMoved: 3, mode: 'walk' }) // heavy woods 3, then 1 + 1
    expect(r.events.some((e) => e.type === 'UnitEntered')).toBe(true)
  })
  it('SCN-002 no jump on the entry turn, no stopping off board, no non-home entry', () => {
    const s = entering()
    expect(validateMove(s, enter([], { mode: 'jump', jumpTo: H(4, 7) }))?.code).toBe('E_BAD_MODE')
    expect(validateMove(s, enter([]))?.code).toBe('E_BAD_ENTRY')
    expect(validateMove(s, enter(['forward'], { entry: { hex: H(4, 7), facing: 0 } }))?.code).toBe('E_BAD_ENTRY')
    expect(validateMove(s, enter(['forward'], { entry: { hex: virt, facing: 3 } }))?.code).toBe('E_BAD_ENTRY')
    expect(validateMove(s, enter(['turnLeft', 'forward']))?.code).toBe('E_BAD_ENTRY')
  })
  it('SCN-002 reachable lists entering moves whose actions all validate', () => {
    const s = entering()
    const list = reachable(s, 'A1')
    expect(list.length).toBeGreaterThan(20)
    expect(list.every((e) => e.action.entry && e.mode !== 'jump' && validateMove(s, e.action) === null)).toBe(true)
    expect(list.some((e) => hexEq(e.hex, H(4, 8)))).toBe(true)
    expect(entryFacings('west')).toEqual([1, 2])
  })
})
