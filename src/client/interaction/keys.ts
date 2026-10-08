// Board keyboard (50 section 13): Enter confirm, Esc cancel, Q/E facing, , and . twist, M L T R G tools, Tab / Shift+Tab cycle
// units, [ and ] rails, Space skip a beat. Camera keys (1 2 3 0, WASD) belong to the camera rig. Keys are ignored while typing and
// never answer a decision on their own beyond the move / deployment / twist confirmation the board owns.
import { useEffect } from 'react'
import { uiActions } from '../contract'
import { useUiStore } from '../store/uiStore'
import { usePresentedStore } from '../presentation/presentedStore'
import { currentPrompt } from './adapter'
import { cancelOrDeselect, confirmDraft, confirmTwist, cycleUnit, draftReady, fallbackMode, nudgeTwist, rotateFacing, skipBeat, toggleGrid, toggleRail } from './controller'

export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }

/** Handle one key press; true when the board consumed it (the caller then calls preventDefault). */
export function onBoardKey(e: KeyLike): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  switch (k) {
    case 'm': uiActions.toggleTool('measure', fallbackMode()); return true
    case 'l': uiActions.toggleTool('los', fallbackMode()); return true
    case 't': uiActions.toggleThreat(); return true
    case 'r': uiActions.toggleRanges(); return true
    case 'g': toggleGrid(); return true
    case '[': toggleRail('left'); return true
    case ']': toggleRail('right'); return true
    case 'q': rotateFacing(-1); return currentPrompt()?.kind === 'move' || currentPrompt()?.kind === 'deploy'
    case 'e': rotateFacing(1); return currentPrompt()?.kind === 'move' || currentPrompt()?.kind === 'deploy'
    case ',': nudgeTwist(-1); return currentPrompt()?.kind === 'torsoTwist'
    case '.': nudgeTwist(1); return currentPrompt()?.kind === 'torsoTwist'
    case 'Tab': cycleUnit(!!e.shiftKey); return true
    case 'Backspace': { if (!useUiStore.getState().move.hex) return false; uiActions.resetMoveDraft(); return true }
    case 'Escape': return cancelOrDeselect()
    case ' ': if (!usePresentedStore.getState().idle) { skipBeat(); return true } return false
    case 'Enter': {
      const p = currentPrompt()
      if (p?.kind === 'torsoTwist') { confirmTwist(); return true }
      if ((p?.kind === 'move' || p?.kind === 'deploy') && draftReady()) { confirmDraft(); return true }
      return false // leave Enter to the prompt UI
    }
    default: return false
  }
}

export function useBoardKeys(): void {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      // Tab only cycles units when nothing else holds focus (keyboard users keep normal focus order); a focused button keeps Enter / Space
      if (e.key === 'Tab' && t && t !== document.body && t.tagName !== 'CANVAS') return
      if ((e.key === 'Enter' || e.key === ' ') && t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return
      if (onBoardKey(e)) e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
