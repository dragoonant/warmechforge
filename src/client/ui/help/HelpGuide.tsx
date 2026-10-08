// How to Play: tabbed, skimmable overlay. Reachable from the start screen, the ? button / key, and the coach line.
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { FAN_NOTICE } from '../../contract'
import { HELP_TABS, type HelpBlock } from './helpContent'
import './help.css'

interface HelpStore { open: boolean; tab: string; show(tab?: string): void; hide(): void; toggle(): void; setTab(tab: string): void }

export const useHelpStore = create<HelpStore>((set, get) => ({
  open: false,
  tab: HELP_TABS[0]!.id,
  show: (tab) => set({ open: true, ...(tab && HELP_TABS.some((t) => t.id === tab) ? { tab } : {}) }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
  setTab: (tab) => set({ tab }),
}))

export const openHelp = (tab?: string): void => useHelpStore.getState().show(tab)

function Block({ b }: { b: HelpBlock }) {
  switch (b.kind) {
    case 'p': return <p>{b.text}</p>
    case 'h': return <h4>{b.text}</h4>
    case 'list': return <ul>{b.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    case 'steps': return <ol>{b.items.map((t, i) => <li key={i}>{t}</li>)}</ol>
    case 'tip': return <div className="help-tip"><strong>Tip</strong> {b.text}</div>
    case 'keys': return (
      <table className="help-keys"><tbody>{b.rows.map(([k, d]) => <tr key={k}><th><kbd>{k}</kbd></th><td>{d}</td></tr>)}</tbody></table>
    )
    case 'table': return (
      <div className="help-table-wrap">
        <table className="help-table">
          <thead><tr>{b.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
        </table>
      </div>
    )
  }
}

/** The "?" button for play. */
export function HelpButton({ className }: { className?: string }) {
  return (
    <button type="button" className={`help-fab ${className ?? ''}`} data-testid="help-button" aria-label="How to play" title="How to play (?)" onClick={() => useHelpStore.getState().toggle()}>?</button>
  )
}

/** Mount once near the app root: the overlay plus the ? / F1 hotkey. */
export function HelpOverlay() {
  const open = useHelpStore((s) => s.open)
  const tab = useHelpStore((s) => s.tab)
  const hide = useHelpStore((s) => s.hide)
  const setTab = useHelpStore((s) => s.setTab)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === 'Escape' && useHelpStore.getState().open) { e.preventDefault(); e.stopPropagation(); hide(); return }
      if (typing) return
      if (e.key === '?' || e.key === 'F1') { e.preventDefault(); useHelpStore.getState().toggle() }
      else if (useHelpStore.getState().open && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const i = HELP_TABS.findIndex((x) => x.id === useHelpStore.getState().tab)
        const n = (i + (e.key === 'ArrowRight' ? 1 : HELP_TABS.length - 1)) % HELP_TABS.length
        setTab(HELP_TABS[n]!.id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hide, setTab])

  useEffect(() => { body.current?.scrollTo({ top: 0 }) }, [tab])

  if (!open) return null
  const cur = HELP_TABS.find((t) => t.id === tab) ?? HELP_TABS[0]!
  const idx = HELP_TABS.indexOf(cur)
  return (
    <div className="help-backdrop" data-testid="help-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) hide() }}>
      <div className="help-panel" role="dialog" aria-modal="true" aria-label="How to play">
        <header className="help-head">
          <h2>How to Play</h2>
          <button type="button" className="help-close" data-testid="help-close" aria-label="Close guide" onClick={hide}>Close</button>
        </header>
        <nav className="help-tabs" role="tablist" aria-label="Guide sections">
          {HELP_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === cur.id} data-testid={`help-tab-${t.id}`}
              className={t.id === cur.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.title}</button>
          ))}
        </nav>
        <div className="help-body" ref={body} role="tabpanel">
          <h3>{cur.title}</h3>
          <p className="help-blurb">{cur.blurb}</p>
          {cur.blocks.map((b, i) => <Block key={i} b={b} />)}
        </div>
        <footer className="help-foot">
          <button type="button" disabled={idx === 0} onClick={() => setTab(HELP_TABS[idx - 1]!.id)}>Back</button>
          <span>{idx + 1} / {HELP_TABS.length}</span>
          <button type="button" disabled={idx === HELP_TABS.length - 1} onClick={() => setTab(HELP_TABS[idx + 1]!.id)}>Next</button>
        </footer>
        <p className="help-legal">{FAN_NOTICE}</p>
      </div>
    </div>
  )
}
