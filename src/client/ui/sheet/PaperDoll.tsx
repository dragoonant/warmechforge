import type { Loc } from '../../../engine/index'
import { useDamagePops } from '../../contract'
import { buildDoll, type CellState, type DollCell } from './sheetView'
import type { SheetView } from '../../../engine/index'

// Our own silhouette: head over a three-wide torso, arms outside it, legs under it, rear armor as a strip below.
const FRONT: Record<Loc, { x: number; y: number; w: number; h: number }> = {
  HD: { x: 80, y: 4, w: 40, h: 28 },
  LA: { x: 2, y: 38, w: 36, h: 70 },
  LT: { x: 42, y: 38, w: 38, h: 60 },
  CT: { x: 81, y: 38, w: 38, h: 60 },
  RT: { x: 120, y: 38, w: 38, h: 60 },
  RA: { x: 162, y: 38, w: 36, h: 70 },
  LL: { x: 50, y: 104, w: 46, h: 56 },
  RL: { x: 104, y: 104, w: 46, h: 56 },
}
const REAR: Record<'LT' | 'CT' | 'RT', { x: number; y: number; w: number; h: number }> = {
  LT: { x: 42, y: 176, w: 38, h: 28 }, CT: { x: 81, y: 176, w: 38, h: 28 }, RT: { x: 120, y: 176, w: 38, h: 28 },
}

const RING: Record<CellState, string> = { full: '#6f8fa6', damaged: '#e0a030', exposed: '#d0402b', destroyed: '#000000' }
const FILL: Record<CellState, string> = { full: '#4d6577', damaged: '#8a6a2a', exposed: '#a8322a', destroyed: '#000000' }

function Cell({ cell, box, flash }: { cell: DollCell; box: { x: number; y: number; w: number; h: number }; flash: boolean }) {
  const { x, y, w, h } = box
  const pad = 5
  const innerH = h - pad * 2
  const fillH = innerH * cell.internalFrac
  const testid = cell.rear ? `sheet-rear-${cell.loc}` : `sheet-loc-${cell.loc}`
  return (
    <g
      className={`doll-cell doll-${cell.state}${flash ? ' doll-flash' : ''}`} data-testid={testid} data-armor={cell.armor} data-internal={cell.internal}
      data-destroyed={cell.destroyed ? 'true' : 'false'} data-state={cell.state}
    >
      <title>{cell.title}</title>
      <rect x={x} y={y} width={w} height={h} rx={4} fill="#101216" stroke={RING[cell.state]} strokeWidth={4} strokeOpacity={cell.destroyed ? 1 : Math.max(0.35, cell.armorFrac)} />
      <rect x={x + pad} y={y + pad} width={w - pad * 2} height={innerH} rx={2} fill="#0b0c0f" />
      {fillH > 0 && <rect x={x + pad} y={y + pad + innerH - fillH} width={w - pad * 2} height={fillH} rx={2} fill={FILL[cell.state]} />}
      <text x={x + w / 2} y={y + h / 2 - 2} textAnchor="middle" className="doll-label">{cell.label}</text>
      <text x={x + w / 2} y={y + h / 2 + 9} textAnchor="middle" className="doll-num">{cell.destroyed ? '' : `${cell.armor}/${cell.internal}`}</text>
      {cell.destroyed && <path d={`M${x + 6} ${y + 6} L${x + w - 6} ${y + h - 6} M${x + w - 6} ${y + 6} L${x + 6} ${y + h - 6}`} stroke="#d0402b" strokeWidth={2.5} />}
    </g>
  )
}

/** Armor ring + internal fill per location, front and a separate rear strip. Numbers are armor/internal; hover for the full line. */
export function PaperDoll({ sheet, unitId }: { sheet: SheetView; unitId: string }) {
  const { front, rear } = buildDoll(sheet)
  const pops = useDamagePops()
  const flashing = new Set(pops.filter((p) => p.unitId === unitId && p.location && (p.kind === 'damage' || p.kind === 'crit')).map((p) => p.location))
  return (
    <svg className="doll" viewBox="0 0 200 210" role="img" aria-label="Armor and internal structure by location" data-testid="sheet-doll">
      {front.map((c) => <Cell key={c.loc} cell={c} box={FRONT[c.loc]} flash={flashing.has(c.loc)} />)}
      <text x={100} y={171} textAnchor="middle" className="doll-cap">rear armor</text>
      {rear.map((c) => <Cell key={`r${c.loc}`} cell={c} box={REAR[c.loc as 'LT' | 'CT' | 'RT']} flash={false} />)}
    </svg>
  )
}
