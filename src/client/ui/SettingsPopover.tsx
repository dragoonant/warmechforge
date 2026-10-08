import { useEffect, useRef } from 'react'
import { FAN_NOTICE, SPEED_PRESETS, settings, uiActions, usePanel, useSettings, type Settings } from '../contract'
import { SoundSettings } from '../audio/SoundSettings'
import { SURROUNDINGS_OPTIONS, setSurroundings, useSurroundings, useSurroundingsForced } from '../environment/surroundings'
import './hud.css'

function Seg<T extends string | number | boolean>({ label, value, options, onPick, testid }: { label: string; value: T; options: { v: T; text: string }[]; onPick: (v: T) => void; testid: string }) {
  return (
    <div className="set-group">
      <div className="set-label">{label}</div>
      <div className="set-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" className={value === o.v ? 'on' : ''} data-testid={`${testid}-${String(o.v)}`} aria-pressed={value === o.v} onClick={() => onPick(o.v)}>{o.text}</button>
        ))}
      </div>
    </div>
  )
}

/** Gear button and popover: animation speed, graphics, narration, tips, hex labels, grid, odds format, and the fan notice. */
export function SettingsButton() {
  const open = usePanel() === 'settings'
  const s = useSettings()
  const root = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) uiActions.openPanel(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') uiActions.openPanel(null) }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  const speedKey = (Object.keys(SPEED_PRESETS) as (keyof typeof SPEED_PRESETS)[]).find((k) => SPEED_PRESETS[k] === s.speed) ?? 'normal'
  const set = (patch: Partial<Settings>) => settings.set(patch)
  const surroundings = useSurroundings()
  const surroundForced = useSurroundingsForced()
  return (
    <div className="set-wrap" ref={root}>
      <button type="button" className="hud-btn hud-btn-sm set-gear" data-testid="topbar-settings" aria-expanded={open} title="Settings" onClick={() => uiActions.openPanel(open ? null : 'settings')}>Settings</button>
      {open && (
        <div className="hud-card set-pop" data-testid="settings-popover" role="dialog" aria-label="Settings">
          <Seg label="Animation speed" value={speedKey} testid="set-speed" onPick={(k) => set({ speed: SPEED_PRESETS[k] })}
            options={[{ v: 'slow', text: '0.5x' }, { v: 'normal', text: '1x' }, { v: 'fast', text: '2x' }, { v: 'faster', text: '4x' }, { v: 'instant', text: 'Instant' }]} />
          <Seg label="Graphics" value={s.graphics} testid="set-graphics" onPick={(v) => set({ graphics: v })} options={[{ v: 'low', text: 'Low' }, { v: 'high', text: 'High' }]} />
          <Seg label={surroundForced ? 'Surroundings (Plain on Low graphics)' : 'Surroundings'} value={surroundForced ? 'plain' : surroundings} testid="set-surroundings" onPick={(v) => setSurroundings(v)}
            options={SURROUNDINGS_OPTIONS.map((o) => ({ v: o.value, text: o.label }))} />
          <Seg label="Hex labels" value={s.hexLabels} testid="set-labels" onPick={(v) => set({ hexLabels: v })} options={[{ v: 'hover', text: 'Hover' }, { v: 'always', text: 'Always' }, { v: 'off', text: 'Off' }]} />
          <Seg label="Odds shown as" value={s.odds} testid="set-odds" onPick={(v) => set({ odds: v })} options={[{ v: 'percent', text: 'Percent' }, { v: 'tn', text: 'Target number' }]} />
          <label className="set-row set-check"><input type="checkbox" data-testid="set-narration" checked={s.narration} onChange={(e) => set({ narration: e.target.checked })} /> Narration lines</label>
          <label className="set-row set-check"><input type="checkbox" data-testid="set-tips" checked={s.tips} onChange={(e) => set({ tips: e.target.checked })} /> Tips</label>
          <label className="set-row set-check"><input type="checkbox" data-testid="set-follow" checked={s.followAction} onChange={(e) => set({ followAction: e.target.checked })} /> Follow action (camera frames bot moves and shots)</label>
          <label className="set-row set-check"><input type="checkbox" data-testid="set-grid" checked={s.grid} onChange={(e) => set({ grid: e.target.checked })} /> Hex grid lines</label>
          <SoundSettings />
          <p className="hud-dim over-note" data-testid="fan-notice">{FAN_NOTICE}</p>
        </div>
      )}
    </div>
  )
}
