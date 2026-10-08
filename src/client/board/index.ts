// The hex board's public surface (50-client §4, §5). Figures, overlays, the HUD and the integration import from here.
//
//   <BoardCanvas><HexBoard map={state.board} />...figures and overlays...</BoardCanvas>
//
// Hex maths is the engine's, re-exported by hexWorld; hexToWorld / worldToHex accept a label or an axial hex.
export { HexBoard, BoardCanvas, themeOfMap, type HexBoardProps } from './HexBoard'
export {
  hexToWorld, worldToHex, hexSurfaceY, hexTopPoint, setActiveBoard, getActiveBoard,
  hexToLabel, labelToHex, distance, hexEq, hexKey, hexToOffset, offsetToHex, onBoard, ring, hexesWithin, neighbor, neighbors,
  LEVEL_HEIGHT, HEX_FLAT, COLUMN_STEP,
  type WorldPoint,
} from './hexWorld'
export { cameraActions, CameraRig, useCameraStore, TRANSITION_MS } from './Camera'
export { cameraPose, panClamp, fitDistance, type CameraPreset, type HomeEdge, type Pose } from './cameraPose'
export { THEMES, themeFor, DEFAULT_THEME, type BoardTheme, type BoardThemeId } from './boards'
export { layoutBoard, type BoardLayout, type TileInfo } from './layout'
export { useBoardView } from './boardStore'
export { markShadowsDirty, takeShadowsDirty, useAmbientFrames } from './frameRate'
export { useMatAlbedo } from './matShare'
export { TREE_MAX_H } from './props'
