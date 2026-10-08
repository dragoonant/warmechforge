// Which top-level screen is showing (start screen or the game). A tiny store so any game UI (GameOver "Back to start",
// a menu button) can leave the game without prop drilling; App owns the rendering. The game itself is kept in memory.
import { create } from 'zustand'

export type Screen = 'start' | 'game'

interface ScreenStore { screen: Screen; toStart(): void; toGame(): void }

export const useScreenStore = create<ScreenStore>((set) => ({
  screen: 'start',
  toStart: () => set({ screen: 'start' }),
  toGame: () => set({ screen: 'game' }),
}))

/** Leave the game for the start screen (the game stays in memory; Start screen offers Continue). */
export const goToStart = (): void => useScreenStore.getState().toStart()
