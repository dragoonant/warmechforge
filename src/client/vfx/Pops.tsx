// Floating damage / miss / heat pops over 'Mechs (DOM labels; the director owns their lifetime).
import { useEffect, useState, type ReactElement } from 'react'
import { WorldLabel } from '../figures/worldLabels'
import { useFrame, useThree } from '@react-three/fiber'
import { directorNow, useDamagePops, usePresentedState } from '../contract'
import { frameOf } from '../figures/unitFrame'
import { HEIGHT_BY_CLASS, weightClassOf } from '../figures/figureConstants'

const COLOURS: Record<string, string> = { damage: '#ff6b5a', hit: '#ff6b5a', miss: '#c8c8c8', crit: '#ffb02e', heat: '#e08a1e', pilot: '#e6a5ff', info: '#e8e6e1' }

export function Pops(): ReactElement | null {
  const pops = useDamagePops()
  const state = usePresentedState()
  const invalidate = useThree((s) => s.invalidate)
  const [, tick] = useState(0)
  useEffect(() => { if (pops.length) invalidate() }, [pops, invalidate])
  // rise and fade on every rendered frame while a pop is alive
  useFrame(() => { if (pops.length) { tick((n) => n + 1); invalidate() } })
  if (!state || !pops.length) return null
  const now = directorNow()
  return (
    <>
      {pops.map((p) => {
        const age = (now - p.startedAt) / Math.max(1, p.durationMs)
        const f = frameOf(state, p.unitId)
        const u = state.units[p.unitId]
        if (!f || !u || age > 1.2) return null
        const H = HEIGHT_BY_CLASS[weightClassOf(u.tonnage)]
        return (
          <WorldLabel key={p.id} position={[f.x, f.y + H + 0.3 + Math.max(0, age) * 0.6, f.z]} z={20}>
            <span data-testid={`pop-${p.id}`} style={{ color: COLOURS[p.kind] ?? '#fff', font: '700 15px system-ui', textShadow: '0 1px 3px #000', opacity: Math.max(0, 1 - Math.max(0, age - 0.6) * 2.5), whiteSpace: 'nowrap' }}>{p.text}</span>
          </WorldLabel>
        )
      })}
    </>
  )
}
