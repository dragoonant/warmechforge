// Invisible DOM proxies for tests (50 section 16): one per 'Mech (data-testid="mech-<id>") and one per clickable highlighted hex
// (data-testid="hex-<XXYY>"). They carry state in data attributes and forward clicks to the same controllers the canvas uses, so
// E2E can read and click without canvas coordinates. Rendered from the PRESENTED state, outside the Canvas.
import { useMemo, type CSSProperties, type ReactElement } from 'react'
import type { Hex } from '../../engine/index'
import { groupReach, hexLabelOf, useMoveDraft, usePresentedUnits, usePrompt, useReach, useUiMode, useUnitIds } from '../contract'
import { deployZone, handleHexClick, handleUnitClick } from './controller'

const HIDDEN: CSSProperties = { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }

export function UnitProxies(): ReactElement {
  const ids = useUnitIds()
  const units = usePresentedUnits()
  return (
    <div data-testid="unit-proxies" aria-hidden="true" style={HIDDEN}>
      {ids.map((id) => {
        const u = units?.[id]
        if (!u) return null
        const label = u.pos ? hexLabelOf(u.pos) : null
        return (
          <div
            key={id} data-testid={`mech-${id}`} data-hex={label ?? ''} data-facing={u.facing} data-twist={u.attacks.twist}
            data-prone={u.prone ? 'true' : undefined} data-shutdown={u.shutdown ? 'true' : undefined} data-heat={u.heat}
            data-destroyed={u.status === 'destroyed' ? 'true' : undefined} data-owner={u.owner} onClick={() => handleUnitClick(id)}
          />
        )
      })}
    </div>
  )
}

/** Hexes the board currently highlights as clickable: the reach set of the open move (mode of the draft), or the deployment zone. */
export function useClickableHexes(): { hex: Hex; label: string }[] {
  const p = usePrompt()
  const mode = useUiMode()
  const draft = useMoveDraft()
  const unitId = p?.kind === 'move' ? p.unitId : null
  const entries = useReach(unitId)
  return useMemo(() => {
    if (mode !== 'move') return []
    if (p?.kind === 'deploy') return deployZone().map((h) => ({ hex: h, label: hexLabelOf(h) ?? `${h.q},${h.r}` }))
    if (p?.kind !== 'move') return []
    const g = groupReach(entries.filter((e) => e.mode === draft.mode && !e.physical))
    return [...g.values()].map((x) => ({ hex: x.hex, label: x.label ?? `${x.hex.q},${x.hex.r}` }))
  }, [mode, p?.kind, p?.id, entries, draft.mode])
}

export function HexProxies(): ReactElement {
  const hexes = useClickableHexes()
  return (
    <div data-testid="hex-proxies" aria-hidden="true" style={HIDDEN}>
      {hexes.map((h) => <div key={h.label} data-testid={`hex-${h.label}`} onClick={() => handleHexClick(h.hex)} />)}
    </div>
  )
}

/** Both proxy layers. Mount once beside the canvas (outside it). */
export function InteractionProxies(): ReactElement {
  return <><UnitProxies /><HexProxies /></>
}
