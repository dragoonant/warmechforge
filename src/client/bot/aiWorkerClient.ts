// Main-thread side of the AI worker (40-ai §14): one module worker, the data bundle posted once per version, one request per
// decision and a 3 s timeout. Resolves null (the caller falls back to the random bot) when the worker is unavailable,
// fails or times out; logs `AiFallback {kind, ms}` to the console when that happens. Every request asks for the decision trace,
// which goes to the trace store (ui/AiTrace.tsx) and never back into play.
import type { Action, GameState } from '../../engine/index'
import { bundleFor, view } from '../../engine/index'
import type { UtilityTier } from '../../ai/tiers'
import type { WorkerRequest, WorkerResponse } from '../../ai/worker'
import type { AiTrace } from '../../ai/decider'
import { publishTrace } from './traceStore'

export const AI_TIMEOUT_MS = 3000

export interface AiWorkerClient {
  decide(state: GameState, legal: Action[], tier: UtilityTier, seed?: string): Promise<Action | null>
  readonly broken: boolean
  dispose(): void
}

/** Minimal Worker surface (lets tests pass a fake). */
export interface WorkerLike {
  postMessage(m: WorkerRequest): void
  terminate(): void
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null
  onerror: ((ev: ErrorEvent) => void) | null
}

function spawn(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('../../ai/worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
  } catch {
    return null
  }
}

export function createAiWorkerClient(opts: { timeoutMs?: number; worker?: WorkerLike | null } = {}): AiWorkerClient | null {
  const worker = opts.worker === undefined ? spawn() : opts.worker
  if (!worker) return null
  const timeoutMs = opts.timeoutMs ?? AI_TIMEOUT_MS
  let seq = 0
  let broken = false
  const versions = new Set<string>()
  const waiting = new Map<number, (a: Action | null, trace?: AiTrace) => void>()
  const fail = (why: string, kind: string, ms: number): void => { console.warn('[ai worker] AiFallback', { kind, ms: Math.round(ms), why }) }
  worker.onmessage = (ev) => {
    const m = ev.data
    if (m.type === 'ready') return
    if (m.type === 'error' && m.id === null) { console.warn('[ai worker]', m.message); return }
    if (m.id === null) return
    const done = waiting.get(m.id)
    if (!done) return
    waiting.delete(m.id)
    if (m.type === 'action') done(m.action, m.trace as AiTrace | undefined)
    else { console.warn('[ai worker]', m.message); done(null) }
  }
  worker.onerror = (e) => {
    console.warn('[ai worker] failed; the random bot answers instead', e?.message)
    broken = true
    for (const done of waiting.values()) done(null)
    waiting.clear()
  }
  return {
    get broken() { return broken },
    decide(state, legal, tier, seed) {
      if (broken) return Promise.resolve(null)
      const id = ++seq
      const t0 = Date.now()
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (waiting.delete(id)) { fail('timeout', state.pending.kind, Date.now() - t0); resolve(null) }
        }, timeoutMs)
        const meta = { seed: state.seed, turn: state.turn, phase: state.phase, player: state.pending.player }
        waiting.set(id, (a, trace) => {
          clearTimeout(timer)
          if (!a) fail('error', state.pending.kind, Date.now() - t0)
          else publishTrace(trace, meta)
          resolve(a)
        })
        try {
          const bundle = bundleFor(state)
          if (!versions.has(bundle.version)) {
            worker.postMessage({ type: 'init', bundle, tier, side: state.pending.player, gameSeed: state.seed } satisfies WorkerRequest)
            versions.add(bundle.version)
          }
          worker.postMessage({
            type: 'decide', id, view: view(state, state.pending.player), pending: state.pending, legal, decisionSeq: state.decisionSeq, tier,
            ...(seed ? { seed } : {}), trace: true,
          } satisfies WorkerRequest)
        } catch (e) {
          waiting.delete(id); clearTimeout(timer)
          fail(e instanceof Error ? e.message : String(e), state.pending.kind, Date.now() - t0)
          resolve(null)
        }
      })
    },
    dispose() { worker.terminate(); broken = true; for (const d of waiting.values()) d(null); waiting.clear() },
  }
}
