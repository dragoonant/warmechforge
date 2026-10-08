// AI Web Worker entry (40-ai §14). The main thread posts the data bundle once (init) and then each bot decision; the worker
// answers with an action, so a slow decision never blocks a frame. The worker chunk holds the engine and the AI, not the data.
// Messages: init {bundle, tier?, side?, gameSeed?} → ready; decide {id, view, pending, legal, decisionSeq, tier, seed?, trace?}
// → action {id, action, ms, trace?}; any thrown error → error {id, message}.
import type { Action, DataBundle, PendingDecision, PlayerId, PlayerView } from '../engine/index'
import { registerBundle } from '../engine/index'
import { decideAi } from './decider'
import type { UtilityTier } from './tiers'

export type WorkerRequest =
  | { type: 'init'; bundle: DataBundle; tier?: UtilityTier; side?: PlayerId; gameSeed?: string }
  | { type: 'decide'; id: number; view: PlayerView; pending: PendingDecision; legal: Action[]; decisionSeq: number; tier: UtilityTier; seed?: string; trace?: boolean }
export type WorkerResponse =
  | { type: 'ready'; version: string }
  | { type: 'action'; id: number; action: Action; ms: number; trace?: unknown }
  | { type: 'error'; id: number | null; message: string }

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Message handler (exported so tests can drive the protocol with a fake postMessage, AI-016). */
export function handleWorkerMessage(msg: WorkerRequest, post: (m: WorkerResponse) => void): void {
  if (msg.type === 'init') {
    try {
      registerBundle(msg.bundle)
      post({ type: 'ready', version: msg.bundle.version })
    } catch (e) {
      post({ type: 'error', id: null, message: e instanceof Error ? e.message : String(e) })
    }
    return
  }
  if (msg.type !== 'decide') return
  const t0 = now()
  try {
    const d = decideAi(msg.view, msg.pending, msg.legal, { tier: msg.tier, ...(msg.seed ? { seed: msg.seed } : {}), ...(msg.trace ? { trace: true } : {}) })
    post({ type: 'action', id: msg.id, action: d.action, ms: now() - t0, ...(d.trace ? { trace: d.trace } : {}) })
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) })
  }
}

// wire up only inside a worker (WorkerGlobalScope exists there, not in node or on the main thread)
declare const WorkerGlobalScope: unknown
if (typeof WorkerGlobalScope !== 'undefined') {
  const scope = self as unknown as { onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null; postMessage(m: WorkerResponse): void }
  scope.onmessage = (ev) => handleWorkerMessage(ev.data, (m) => scope.postMessage(m))
}
