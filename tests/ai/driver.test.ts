// Bot driver with the AI worker client (40-ai §14): answers come back asynchronously through a (fake) worker; a worker that
// fails or times out makes the driver answer with the random bot instead (never a stall, never an illegal answer).
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Action } from '../../src/engine/index'
import { newGame, resetGameStore, useGameStore } from '../../src/client/store/gameStore'
import { memoryStorage, setStorage } from '../../src/client/store/storage'
import { useSettingsStore } from '../../src/client/store/settingsStore'
import { setDirectorClock, setPaused } from '../../src/client/presentation/director'
import { createBotDriver, loadBotBrain } from '../../src/client/bot/botDriver'
import { createAiWorkerClient, type WorkerLike } from '../../src/client/bot/aiWorkerClient'
import { handleWorkerMessage, type WorkerRequest, type WorkerResponse } from '../../src/ai/worker'

beforeAll(async () => { await loadBotBrain() })
beforeEach(() => {
  setStorage(memoryStorage())
  setDirectorClock(null)
  useSettingsStore.getState().set({ speed: 0, narration: false })
  setPaused(false)
  resetGameStore()
})
afterEach(() => { setDirectorClock(null) })

/** A worker that runs the real handler in-process, answering on a microtask (or failing every request). */
function fakeWorker(mode: 'ok' | 'fail'): WorkerLike & { decisions: number } {
  const w: WorkerLike & { decisions: number } = {
    decisions: 0,
    onmessage: null,
    onerror: null,
    postMessage(m: WorkerRequest) {
      if (m.type === 'decide') w.decisions++
      queueMicrotask(() => {
        const reply = (r: WorkerResponse): void => { w.onmessage?.({ data: r } as MessageEvent<WorkerResponse>) }
        if (mode === 'fail' && m.type === 'decide') reply({ type: 'error', id: m.id, message: 'boom' })
        else handleWorkerMessage(structuredClone(m), reply)
      })
    },
    terminate() {},
  }
  return w
}

async function play(mode: 'ok' | 'fail', decisions: number): Promise<{ worker: ReturnType<typeof fakeWorker>; fallbacks: number; answered: Action[] }> {
  expect(newGame({ mission: 'mission.intro', turnLimit: 30, controllers: { A: 'bot', B: 'bot' }, seed: `drv-${mode}`, bot: { tier: 'normal' } })).toBeNull()
  const worker = fakeWorker(mode)
  const client = createAiWorkerClient({ worker, timeoutMs: 1000 })!
  const driver = createBotDriver({ thinkMs: 0, worker: client })
  const answered: Action[] = []
  const unsub = useGameStore.subscribe((s, prev) => { if (s.state && prev.state && s.state.log.length > prev.state.log.length) answered.push(s.state.log[s.state.log.length - 1]!) })
  for (let i = 0; i < decisions * 4 && answered.length < decisions; i++) {
    driver.tick()
    await new Promise((r) => setTimeout(r, 0))
  }
  unsub()
  return { worker, fallbacks: driver.fallbacks, answered }
}

describe('bot driver with the AI worker', () => {
  it('AI-016 answers through the worker asynchronously, every answer accepted', async () => {
    const { worker, fallbacks, answered } = await play('ok', 30)
    expect(answered.length).toBeGreaterThanOrEqual(30)
    expect(worker.decisions).toBeGreaterThan(10)
    expect(fallbacks).toBe(0)
    expect(useGameStore.getState().lastRejection).toBeNull()
  }, 60_000)

  it('falls back to the random bot when the worker fails, and the game keeps going', async () => {
    const { fallbacks, answered } = await play('fail', 30)
    expect(answered.length).toBeGreaterThanOrEqual(30)
    expect(fallbacks).toBeGreaterThan(10)
    expect(useGameStore.getState().lastRejection).toBeNull()
  }, 60_000)
})
