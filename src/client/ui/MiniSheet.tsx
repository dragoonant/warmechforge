import type { UnitResult } from './gameOverView'
import type { Loc } from '../../engine/index'
import { LOC_SHORT } from '../contract'

// Same silhouette as the record sheet's paper doll, smaller. Each box is shaded by how much of that location was lost, and
// carries the damage taken there.
const BOX: Record<Loc, { x: number; y: number; w: number; h: number }> = {
  HD: { x: 40, y: 2, w: 24, h: 18 },
  LA: { x: 2, y: 24, w: 22, h: 40 },
  LT: { x: 26, y: 24, w: 24, h: 36 },
  CT: { x: 52, y: 24, w: 24, h: 36 },
  RT: { x: 78, y: 24, w: 24, h: 36 },
  RA: { x: 104, y: 24, w: 22, h: 40 },
  LL: { x: 30, y: 64, w: 30, h: 34 },
  RL: { x: 68, y: 64, w: 30, h: 34 },
}

const shade = (frac: number, destroyed: boolean): string => {
  if (destroyed) return '#1a0b0b'
  if (frac <= 0) return '#2a3340'
  // dark steel -> amber -> red as the share lost climbs
  const a = Math.min(1, frac * 1.6)
  const r = Math.round(60 + 160 * a), g = Math.round(70 + 40 * (1 - Math.abs(a - 0.5) * 2)), b = Math.round(80 * (1 - a))
  return `rgb(${r},${g},${b})`
}

/** One 'Mech after the battle: damage taken per location, kills, heat peak. */
export function MiniSheet({ u }: { u: UnitResult }) {
  return (
    <figure className={`mini mini-${u.fate}`} data-testid={`end-mini-${u.id}`} data-fate={u.fate}>
      <figcaption>
        <b className="mini-name">{u.name}</b>
        <span className={`mini-fate mini-fate-${u.fate}`}>{u.status}</span>
      </figcaption>
      <svg viewBox="0 0 128 100" className="mini-doll" role="img" aria-label={`Damage taken by location for ${u.name}`}>
        {u.cells.map((c) => {
          const b = BOX[c.loc]
          return (
            <g key={c.loc} data-loc={c.loc} data-damage={c.damage}>
              <title>{`${LOC_SHORT[c.loc]}: ${c.damage} damage taken${c.destroyed ? ', destroyed' : ''}`}</title>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={shade(c.frac, c.destroyed)} stroke={c.destroyed ? '#d0402b' : '#556070'} strokeWidth={c.destroyed ? 1.6 : 1} />
              <text x={b.x + b.w / 2} y={b.y + b.h / 2 - 1} textAnchor="middle" className="mini-loc">{LOC_SHORT[c.loc]}</text>
              <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 9} textAnchor="middle" className="mini-dmg">{c.damage}</text>
              {c.destroyed && <path d={`M${b.x + 3} ${b.y + 3} L${b.x + b.w - 3} ${b.y + b.h - 3} M${b.x + b.w - 3} ${b.y + 3} L${b.x + 3} ${b.y + b.h - 3}`} stroke="#d0402b" strokeWidth={1.4} />}
            </g>
          )
        })}
      </svg>
      <dl className="mini-stats">
        <div><dt>Taken</dt><dd data-testid={`end-mini-taken-${u.id}`}>{u.taken}</dd></div>
        <div><dt>Dealt</dt><dd>{u.dealt}</dd></div>
        <div><dt>Kills</dt><dd data-testid={`end-mini-kills-${u.id}`}>{u.kills}</dd></div>
        <div><dt>Peak heat</dt><dd data-testid={`end-mini-heat-${u.id}`}>{u.heatPeak}</dd></div>
      </dl>
    </figure>
  )
}
