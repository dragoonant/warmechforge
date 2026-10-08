// The data bundles the engine has seen, keyed by version (00 §2). step(state, action) takes no bundle, so rules modules read
// the bundle for state.dataVersion from here. index.ts re-exports registerBundle / bundleFor (the public names).
// This module has no engine imports beyond types, so any module can use it without an import cycle through index.ts.
import type { DataBundle, GameState } from './types'
import { EngineInvariantError } from './types'

const BUNDLES = new Map<string, DataBundle>()
/** Makes a bundle available to step/validate/legalActions/query for states built from it. createGame/replay/load call it. */
export function registerBundle(bundle: DataBundle): void { BUNDLES.set(bundle.version, bundle) }
/** The bundle registered for state.dataVersion. Missing → EngineInvariantError. */
export function bundleFor(state: GameState): DataBundle {
  const b = BUNDLES.get(state.dataVersion)
  if (!b) throw new EngineInvariantError(`no data bundle registered for version ${state.dataVersion}`)
  return b
}
