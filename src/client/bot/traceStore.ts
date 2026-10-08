// Last bot decision traces for the AI trace panel (ui/AiTrace.tsx). The worker client and the main-thread fallback publish the
// decider's trace here; nothing in the game reads it back, so it never changes play. Keeps the last few decisions, newest first.
import { create } from 'zustand'
import type { PlayerId } from '../../engine/index'
import type { AiTrace } from '../../ai/decider'

export interface AiTraceEntry {
  /** Monotonic id (React key). */
  seq: number
  /** Game seed (a new game hides the old game's traces). */
  seed: string
  turn: number
  phase: string
  player: PlayerId
  trace: AiTrace
}

export const TRACE_KEEP = 6

interface TraceStore { entries: AiTraceEntry[]; seq: number }
export const useAiTraceStore = create<TraceStore>(() => ({ entries: [], seq: 0 }))

/** Record one decision's trace (ignored when the trace is missing). */
export function publishTrace(trace: AiTrace | undefined | null, meta: { seed: string; turn: number; phase: string; player: PlayerId }): void {
  if (!trace) return
  useAiTraceStore.setState((s) => {
    const seq = s.seq + 1
    return { seq, entries: [{ seq, ...meta, trace }, ...s.entries].slice(0, TRACE_KEEP) }
  })
}

export function clearTraces(): void { useAiTraceStore.setState({ entries: [], seq: 0 }) }

/** The latest trace of this game with scored options (skips one-option decisions such as initiative acknowledgements). */
export const useLastTrace = (seed: string | null | undefined): AiTraceEntry | null =>
  useAiTraceStore((s) => {
    const mine = s.entries.filter((e) => e.seed === seed)
    return mine.find((e) => (e.trace.options?.length ?? 0) > 1) ?? mine[0] ?? null
  })
