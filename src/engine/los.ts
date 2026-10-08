// Line of sight (10 §4): levels, hills, woods points, water line, partial cover, divided lines.
// Pure: takes the board and two endpoints. Units never block LOS (LOS-004), so no unit list is needed.
import { distance, hexLine, hexEq, onBoard } from './hex'
import { floorLevel, hexAt, isSubmerged, losLevel, obstacleLevel, woodsPointsOf } from './terrain'
import type { LosReason, LosVerdict } from './index'
import type { BoardState, Hex } from './types'

export interface LosEnd { hex: Hex; prone?: boolean }
export interface LosOpts {
  /** Stored LOS-005 choice for this pair this turn; overrides the default pick when LOS is divided. */
  choice?: '+' | '-' | null
}

interface SeqEval {
  blocked: boolean
  blockers: { hex: Hex; reason: 'hill' | 'woods' }[]
  woodsPoints: number
  hillCover: boolean
  reasons: LosReason[]
}

export function computeLos(board: BoardState, from: LosEnd, to: LosEnd, opts: LosOpts = {}): LosVerdict {
  const empty = (reasons: LosReason[], visible: boolean): LosVerdict => ({
    visible, attackAllowed: visible, divided: false, chosen: null, hexes: [from.hex, to.hex], alt: null,
    blockers: [], woodsPoints: 0, partialCover: false, reasons,
  })
  if (!onBoard(board, from.hex) || !onBoard(board, to.hex)) return empty([{ code: 'offBoard' }], false)
  if (hexEq(from.hex, to.hex)) return { ...empty([{ code: 'sameHex' }], true), hexes: [from.hex] }

  const bhA = hexAt(board, from.hex)!, bhB = hexAt(board, to.hex)!
  const fromProne = !!from.prone, toProne = !!to.prone
  const lvlA = losLevel(bhA, fromProne), lvlB = losLevel(bhB, toProne)
  const dist = distance(from.hex, to.hex)

  const evalSeq = (seq: Hex[]): SeqEval => {
    const ev: SeqEval = { blocked: false, blockers: [], woodsPoints: 0, hillCover: false, reasons: [] }
    const intervenes = (o: number, h: Hex): boolean =>
      (o >= lvlA && o >= lvlB) || (o >= lvlA && distance(h, from.hex) === 1) || (o >= lvlB && distance(h, to.hex) === 1)
    for (let i = 1; i < seq.length - 1; i++) {
      const h = seq[i]!
      const bh = hexAt(board, h)
      if (!bh) continue
      if (intervenes(bh.level, h)) {
        ev.blocked = true
        ev.blockers.push({ hex: h, reason: 'hill' })
        ev.reasons.push({ code: 'hill', hex: h, value: bh.level })
      } else if (bh.woods !== 'none' && intervenes(obstacleLevel(bh), h)) {
        const pts = woodsPointsOf(bh)
        ev.woodsPoints += pts
        ev.reasons.push({ code: 'woods', hex: h, value: pts })
      }
    }
    if (ev.woodsPoints >= 3) {
      ev.blocked = true
      const wood = ev.reasons.filter((r) => r.code === 'woods')
      for (const r of wood) ev.blockers.push({ hex: r.hex!, reason: 'woods' })
      ev.reasons.push({ code: 'woodsBlock', value: ev.woodsPoints })
    }
    // LOS-030: hill next to the target, exactly one level above its floor, not blocking, attacker not above the target.
    if (!ev.blocked && !toProne && seq.length >= 3 && lvlA <= lvlB) {
      const h = seq[seq.length - 2]!
      const bh = hexAt(board, h)
      if (bh && bh.woods === 'none' && bh.level === floorLevel(bhB) + 1) {
        ev.hillCover = true
        ev.reasons.push({ code: 'partialCoverHill', hex: h })
      }
    }
    return ev
  }

  const line = hexLine(from.hex, to.hex)
  const evPlus = evalSeq(line.plus)
  let ev = evPlus
  let chosen: '+' | '-' | null = null
  let hexes = line.plus
  let alt: Hex[] | null = null
  if (line.divided) {
    const evMinus = evalSeq(line.minus)
    const score = (e: SeqEval): number => e.woodsPoints + (e.hillCover ? 1 : 0)
    let pick: '+' | '-'
    if (opts.choice) pick = opts.choice
    else if (evPlus.blocked !== evMinus.blocked) pick = evPlus.blocked ? '+' : '-' // blocked beats open
    else if (!evPlus.blocked && score(evMinus) > score(evPlus)) pick = '-'
    else pick = '+'
    chosen = pick
    ev = pick === '+' ? evPlus : evMinus
    hexes = pick === '+' ? line.plus : line.minus
    alt = pick === '+' ? line.minus : line.plus
  }

  // LOS-031: standing in depth 1 always has water cover; LOS-015: water never blocks.
  const waterCover = !ev.blocked && !toProne && bhB.depth === 1
  const reasons: LosReason[] = []
  if (dist === 1) reasons.push({ code: 'adjacent' })
  if (line.divided) reasons.push({ code: 'divided' })
  reasons.push(...ev.reasons)
  if (waterCover) reasons.push({ code: 'partialCoverWater', hex: to.hex })
  const waterLine = isSubmerged(bhA, fromProne) !== isSubmerged(bhB, toProne)
  if (waterLine) reasons.push({ code: 'waterLine' })
  if (!ev.blocked && ev.woodsPoints === 0 && !ev.hillCover && !waterCover && !waterLine && dist > 1) reasons.push({ code: 'clear' })

  const visible = !ev.blocked
  return {
    visible,
    attackAllowed: visible && !waterLine,
    divided: line.divided,
    chosen,
    hexes,
    alt,
    blockers: ev.blockers,
    woodsPoints: ev.woodsPoints,
    partialCover: ev.hillCover || waterCover,
    reasons,
  }
}

/** LOS-034: attacker's leg weapons are unusable if a hill on the line gives the attacker cover, or it stands in depth 1. */
export function legWeaponsBlocked(board: BoardState, attacker: LosEnd, target: LosEnd, opts: LosOpts = {}): boolean {
  const bh = hexAt(board, attacker.hex)
  if (!bh) return false
  if (!attacker.prone && bh.depth === 1) return true
  const rev = computeLos(board, target, attacker, opts)
  return rev.reasons.some((r) => r.code === 'partialCoverHill')
}
