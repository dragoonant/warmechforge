// Dev harness (not shipped): the board + units + interaction + HUD with a real game, for reviewing figures, overlays and VFX
// without the final GameScreen. ?control=human,bot&seed=..&speed=..  Served only by a local dev server (see tools notes).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BoardCanvas, HexBoard } from '../board'
import { bootClient, game, queryReach, uiActions, usePresentedState } from '../contract'
import { Hud } from '../ui'
import { InteractionProxies } from '../interaction'
import { UnitsLayer } from './UnitsLayer'

const q = new URLSearchParams(location.search)
bootClient({ testHooks: true })
const w = window as unknown as Record<string, unknown>
w.__ui = uiActions; w.__reach = queryReach; w.__gm = game
const ctl = (q.get('control') ?? 'human,bot').split(',')
game.newGame({ mission: 'mission.intro', controllers: { A: ctl[0] === 'bot' ? 'bot' : 'human', B: ctl[1] === 'human' ? 'human' : 'bot' }, seed: q.get('seed') ?? 'u1' })

function Scene() {
  const state = usePresentedState()
  if (!state) return null
  return (
    <>
      <BoardCanvas style={{ position: 'fixed', inset: 0 }}>
        <HexBoard map={state.board} />
        <UnitsLayer />
      </BoardCanvas>
      <InteractionProxies />
      <Hud />
    </>
  )
}
createRoot(document.getElementById('root')!).render(<StrictMode><Scene /></StrictMode>)
