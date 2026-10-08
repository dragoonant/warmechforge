// Dev route for the board: http://localhost:5173/src/client/board/dev.html?board=<mapId|slug>[&theme=desert|grasslands][&low=1][&labels=always]
// Draws the map from the data bundle with no game running; used for the Playwright quality loop (e2e-out/board-*.png).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loadBundle } from '../../data/index'
import { createGame, type BoardState } from '../../engine/index'
import { buildSetup } from '../store/setup'
import { BoardCanvas, HexBoard } from './index'
import { useSettingsStore } from '../store/settingsStore'

const q = new URLSearchParams(location.search)
const bundle = loadBundle()
const wanted = q.get('board') ?? 'map.test-canyons'
const mapId = Object.keys(bundle.maps).find((id) => id === wanted || id === `map.${wanted}`) ?? Object.keys(bundle.maps)[0]!

/** Build a BoardState through the engine (a throwaway game on the wanted map), the same normalisation the client gets. */
function boardFor(id: string): BoardState {
  const r = createGame(buildSetup({ mission: 'mission.intro', map: id }, { A: 'bot', B: 'bot' }), 'board-dev', bundle)
  if (r.rejection) throw new Error('createGame failed for ' + id + ': ' + r.rejection.message)
  return r.state.board
}

if (q.get('low') === '1') useSettingsStore.getState().set({ graphics: 'low' })
if (q.get('labels')) useSettingsStore.getState().set({ hexLabels: q.get('labels') as 'hover' | 'always' | 'off' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BoardCanvas style={{ width: '100vw', height: '100vh' }}>
      <HexBoard map={boardFor(mapId)} theme={(q.get('theme') as 'desert' | 'grasslands' | null) ?? undefined} />
    </BoardCanvas>
  </StrictMode>,
)
