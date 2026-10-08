// Hex geometry (00 §3): axial coords, labels, neighbours, distance, bearing, arcs, attack direction, hex lines.
// Pure functions; no state. Hex lines are memoised.
import { COLUMN_STEP, HEX_DIRS } from './types'
import type { AttackDirection, BoardState, Edge, Facing, Hex, HexLabel } from './types'

export type BoardSize = Pick<BoardState, 'cols' | 'rows'>

// ---------- coordinates ----------
export const hexKey = (h: Hex): string => `${h.q},${h.r}`
export const hexEq = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r

/** 0-based (col,row) to axial (odd-q: odd columns sit lower). */
export const offsetToHex = (col: number, row: number): Hex => ({ q: col, r: row - (col - (col & 1)) / 2 })
export const hexToOffset = (h: Hex): { col: number; row: number } => ({ col: h.q, row: h.r + (h.q - (h.q & 1)) / 2 })

/** 'XXYY' to axial, or null if malformed. Does not check board size. */
export function labelToHex(label: HexLabel): Hex | null {
  if (!/^\d{4}$/.test(label)) return null
  const x = Number(label.slice(0, 2)), y = Number(label.slice(2))
  if (x < 1 || y < 1) return null
  return offsetToHex(x - 1, y - 1)
}
export function onBoard(board: BoardSize, h: Hex): boolean {
  const { col, row } = hexToOffset(h)
  return col >= 0 && col < board.cols && row >= 0 && row < board.rows
}
export function hexToLabel(board: BoardSize, h: Hex): HexLabel | null {
  if (!onBoard(board, h)) return null
  const { col, row } = hexToOffset(h)
  return String(col + 1).padStart(2, '0') + String(row + 1).padStart(2, '0')
}

// ---------- facing and neighbours ----------
const ALL_FACINGS: Facing[] = [0, 1, 2, 3, 4, 5]
export const neighbor = (h: Hex, f: Facing): Hex => ({ q: h.q + HEX_DIRS[f].q, r: h.r + HEX_DIRS[f].r })
export const neighbors = (h: Hex): Hex[] => ALL_FACINGS.map((f) => neighbor(h, f))
export function directionTo(a: Hex, b: Hex): Facing | null {
  for (const f of ALL_FACINGS) if (hexEq(neighbor(a, f), b)) return f
  return null
}
export const turnCost = (f1: Facing, f2: Facing): number => { const d = Math.abs(f1 - f2); return Math.min(d, 6 - d) }
export const turnLeft = (f: Facing): Facing => ((f + 5) % 6) as Facing
export const turnRight = (f: Facing): Facing => ((f + 1) % 6) as Facing
export const opposite = (f: Facing): Facing => ((f + 3) % 6) as Facing
/** Torso facing = feet facing + twist. */
export const torsoFacing = (feet: Facing, twist: number): Facing => (((feet + twist) % 6 + 6) % 6) as Facing

// ---------- distance and areas ----------
export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q, dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}
/** Hexes at exactly distance n, starting at the facing-4 corner, walking clockwise. */
export function ring(c: Hex, n: number): Hex[] {
  if (n === 0) return [{ q: c.q, r: c.r }]
  const out: Hex[] = []
  let h: Hex = { q: c.q + HEX_DIRS[4].q * n, r: c.r + HEX_DIRS[4].r * n }
  for (const f of ALL_FACINGS) {
    for (let i = 0; i < n; i++) { out.push(h); h = neighbor(h, f) }
  }
  return out
}
export function hexesWithin(c: Hex, n: number): Hex[] {
  const out: Hex[] = []
  for (let k = 0; k <= n; k++) out.push(...ring(c, k))
  return out
}

// ---------- bearing, arcs, attack direction ----------
const EPS = 1e-6
const mod360 = (x: number): number => { const m = ((x % 360) + 360) % 360; return m > 360 - 1e-9 ? 0 : m }
/** Degrees clockwise from north, [0,360). Same hex returns 0 (callers handle it first). */
export function bearing(a: Hex, b: Hex): number {
  const dx = 1.5 * (b.q - a.q)
  const dy = Math.sqrt(3) * ((b.r - a.r) + (b.q - a.q) / 2)
  if (dx === 0 && dy === 0) return 0
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI
  const snapped = Math.round(deg * 2) / 2
  return mod360(Math.abs(snapped - deg) < 1e-9 ? snapped : deg)
}
/** Bearing relative to a facing, clockwise from straight ahead (HEX-007). */
export const rel = (a: Hex, b: Hex, f: Facing): number => mod360(bearing(a, b) - 60 * f)

export type FiringArc = 'forward' | 'right' | 'rear' | 'left'
export function arcOfRel(r: number): FiringArc {
  if (r <= 60 + EPS || r >= 300 - EPS) return 'forward'
  if (r <= 120 + EPS) return 'right'
  if (r < 240 - EPS) return 'rear'
  return 'left'
}
/** ARC-001. The same hex counts as forward. */
export function firingArc(attacker: Hex, arcFacing: Facing, target: Hex): FiringArc {
  if (hexEq(attacker, target)) return 'forward'
  return arcOfRel(rel(attacker, target, arcFacing))
}

export type MountArc = 'torso' | 'rightArm' | 'leftArm' | 'rear' | 'leg' | 'legRear'
/** ARC-003: can a mount of this kind fire into the arc? Arms cover forward plus their side (rear if flipped). */
export function mountCoversArc(mount: MountArc, arc: FiringArc, opts: { flipped?: boolean } = {}): boolean {
  switch (mount) {
    case 'torso': case 'leg': return arc === 'forward'
    case 'rear': case 'legRear': return arc === 'rear'
    case 'rightArm': return opts.flipped ? arc === 'rear' : arc === 'forward' || arc === 'right'
    case 'leftArm': return opts.flipped ? arc === 'rear' : arc === 'forward' || arc === 'left'
  }
}
/** ARC-004: legs use feet facing, everything else torso facing (after twist). */
export function mountFacing(mount: MountArc, feet: Facing, twist: number): Facing {
  return mount === 'leg' || mount === 'legRear' ? feet : torsoFacing(feet, twist)
}
export function canFire(attacker: Hex, feet: Facing, twist: number, mount: MountArc, target: Hex, opts: { flipped?: boolean } = {}): boolean {
  return mountCoversArc(mount, firingArc(attacker, mountFacing(mount, feet, twist), target), opts)
}

export type DirectionResult = AttackDirection | { tie: [AttackDirection, AttackDirection] }
/** ARC-020/021: side of the target the attack comes from, or a tie at hex corners (30/150/210/330). */
export function attackDirection(target: Hex, targetFeetFacing: Facing, attacker: Hex): DirectionResult {
  const r = rel(target, attacker, targetFeetFacing)
  const near = (v: number): boolean => Math.abs(r - v) < EPS
  if (near(30)) return { tie: ['front', 'right'] }
  if (near(150)) return { tie: ['right', 'rear'] }
  if (near(210)) return { tie: ['rear', 'left'] }
  if (near(330)) return { tie: ['left', 'front'] }
  if (r > 330 || r < 30) return 'front'
  if (r < 150) return 'right'
  if (r < 210) return 'rear'
  return 'left'
}

// ---------- hex line (LOS-001/002) ----------
const worldX = (h: Hex): number => h.q * COLUMN_STEP
const worldY = (h: Hex): number => h.r + h.q / 2
function cubeRound(fq: number, fr: number): Hex {
  const fs = -fq - fr
  let q = Math.round(fq), r = Math.round(fr)
  const s = Math.round(fs)
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs)
  if (dq > dr && dq > ds) q = -r - s
  else if (dr > ds) r = -q - s
  return { q: q + 0, r: r + 0 }
}
export interface HexLine { plus: Hex[]; minus: Hex[]; divided: boolean }
const lineCache = new Map<string, HexLine>()
export function hexLine(a: Hex, b: Hex): HexLine {
  const key = `${a.q},${a.r}|${b.q},${b.r}`
  const hit = lineCache.get(key)
  if (hit) return hit
  const N = distance(a, b)
  let result: HexLine
  if (N === 0) result = { plus: [{ q: a.q, r: a.r }], minus: [{ q: a.q, r: a.r }], divided: false }
  else {
    const ax = worldX(a), ay = worldY(a)
    const dx = worldX(b) - ax, dy = worldY(b) - ay
    const len = Math.hypot(dx, dy)
    const nx = -dy / len, ny = dx / len
    const build = (sign: number): Hex[] => {
      const out: Hex[] = []
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const X = ax + t * dx + sign * EPS * nx
        const Y = ay + t * dy + sign * EPS * ny
        const fq = (X * 2) / Math.sqrt(3)
        const h = cubeRound(fq, Y - fq / 2)
        const last = out[out.length - 1]
        if (!last || !hexEq(last, h)) out.push(h)
      }
      return out
    }
    const plus = build(1), minus = build(-1)
    plus[0] = { q: a.q, r: a.r }; minus[0] = { q: a.q, r: a.r }
    plus[plus.length - 1] = { q: b.q, r: b.r }; minus[minus.length - 1] = { q: b.q, r: b.r }
    const divided = plus.length !== minus.length || plus.some((h, i) => !hexEq(h, minus[i]!))
    result = { plus, minus, divided }
  }
  lineCache.set(key, result)
  return result
}

// ---------- world mapping ----------
export function hexToWorld(board: BoardState, h: Hex): { x: number; z: number } {
  return { x: h.q * COLUMN_STEP - board.centre.x, z: h.r + h.q / 2 - board.centre.z }
}
export function worldToHex(board: BoardState, p: { x: number; z: number }): Hex {
  const X = p.x + board.centre.x, Y = p.z + board.centre.z
  const fq = X / COLUMN_STEP
  return cubeRound(fq, Y - fq / 2)
}

/** Hexes along a board edge. */
export function edgeHexes(board: BoardSize, edge: Edge): Hex[] {
  const out: Hex[] = []
  if (edge === 'north' || edge === 'south') {
    const row = edge === 'north' ? 0 : board.rows - 1
    for (let c = 0; c < board.cols; c++) out.push(offsetToHex(c, row))
  } else {
    const col = edge === 'west' ? 0 : board.cols - 1
    for (let r = 0; r < board.rows; r++) out.push(offsetToHex(col, r))
  }
  return out
}
