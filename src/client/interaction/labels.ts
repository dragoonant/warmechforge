// Local re-exports so the pure view models do not import the contract (which pulls in the whole store graph): theme colours
// (mirrors contract THEME) and the label tables, taken from the presentation layer.
export { LOS_REASON_LABELS, PSR_REASON_LABELS } from '../presentation/labels'
export const THEME_COLOURS = {
  accent: '#c9a227', heat: '#d0402b', hazard: '#e08a1e', reachWalk: '#3fae5a', reachRun: '#d99a1e', reachJump: '#3d7fd9',
  arcSide: '#6f86a6', arcRear: '#d0402b', ring: '#e8e6e1',
} as const
