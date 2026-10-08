// Routes start screen <-> game. The game chunk (three.js, board, HUD) is code-split with React.lazy so the start
// screen loads without it. URL hooks: ?test=1 (window.__game), ?scenario=... (skip the start screen), ?gallery (figures),
// ?fps (frame meter, drawn by the game screen), ?speed=.
import { Suspense, lazy, useEffect } from 'react'
import { bootClient, game, setupFromUrl, startFromUrl, useHasGame, usePresentedPhase, type NewGameOptions } from './contract'
import { audio, initAudio } from './audio'
import { CoachLine } from './ui/help/CoachLine'
import { HelpButton, HelpOverlay } from './ui/help/HelpGuide'
import { StartScreen } from './ui/start/StartScreen'
import { useScreenStore } from './ui/start/screenStore'
import './ui/start/start.css'

const GameView = lazy(() => import('./GameScreen'))
// ?gallery: every figure on a turntable for review, in its own chunk.
const GalleryView = lazy(() => import('./figures/Gallery'))

const params = (): URLSearchParams => new URLSearchParams(typeof location !== 'undefined' ? location.search : '')

export function App() {
  if (params().has('gallery')) return <Suspense fallback={<Loading />}><GalleryView /></Suspense>
  return <GameApp />
}

// StrictMode runs effects twice in dev: start the URL game once.
let urlStarted = false

function GameApp() {
  const hasGame = useHasGame()
  const screen = useScreenStore((s) => s.screen)
  const toGame = useScreenStore((s) => s.toGame)
  const toStart = useScreenStore((s) => s.toStart)
  const phase = usePresentedPhase()
  const ongoing = hasGame && phase !== 'ended'
  // audio unlocks on the first pointer down; the title theme plays on the start screen, battle loops in the game
  useEffect(() => { initAudio() }, [])
  const inBattle = screen === 'game' && hasGame
  useEffect(() => { audio.setMusicScene(inBattle ? 'battle' : 'title') }, [inBattle])

  useEffect(() => {
    const off = bootClient({ testHooks: params().get('test') === '1' })
    if (!urlStarted && setupFromUrl()) {
      urlStarted = true
      if (startFromUrl()) toGame()
    }
    return off
  }, [toGame])

  const start = (opts: NewGameOptions): string | null => {
    const rej = game.newGame(opts)
    if (rej) return rej.text
    toGame()
    return null
  }

  // Continue: the game still in memory (unless it ended), else the autosave from an earlier visit.
  const continueLabel = ongoing ? 'Continue game' : game.hasAutosave() ? 'Continue saved game' : null
  const resume = (): string | null => {
    if (!ongoing) {
      const rej = game.continueGame()
      if (rej) return rej.text
    }
    toGame()
    return null
  }

  const playing = screen === 'game' && hasGame
  return (
    <>
      {playing ? (
        <div style={{ position: 'fixed', inset: 0, background: '#14161a' }}>
          <Suspense fallback={<Loading />}><GameView onExit={toStart} /></Suspense>
          <button type="button" className="menu-fab" data-testid="menu-button" title="Back to the start screen (the game is kept)" onClick={toStart}>Menu</button>
          <HelpButton />
          <CoachLine />
        </div>
      ) : (
        <StartScreen onStart={start} onContinue={resume} continueLabel={continueLabel} />
      )}
      <HelpOverlay />
    </>
  )
}

function Loading() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#c9a227', font: '600 18px system-ui' }}>
      Setting up the table...
    </div>
  )
}
