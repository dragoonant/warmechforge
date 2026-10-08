// Theme table per map theme (70-maps: `theme` = desert | grasslands): ground mat paths, cliff rock, light, fog and prop colours.
// Mat files live in public/assets/terrain/boards/<folder>/{albedo,normal,rough}.jpg (art/board-textures/gen.py).
export type BoardThemeId = 'desert' | 'grasslands'

export interface MatFiles { albedo: string; normal: string; rough: string }
export interface BoardTheme {
  id: BoardThemeId
  name: string
  /** Ground mat, sampled in world x/z across the whole board. */
  ground: MatFiles
  /** World size (units) one ground mat image covers. The mat is de-tiled, so a repeat at a bigger board does not show. */
  matSize: number
  /** Cliff rock, sampled on the terrace sides. */
  cliff: MatFiles
  /** Flat colours used until / unless the mat images load. */
  fallback: { ground: string; cliff: string }
  light: { key: string; keyIntensity: number; sky: string; groundBounce: string; hemiIntensity: number; fill: string }
  /** Scene background = fog colour (the off-board surround blends into it). */
  fog: { color: string; near: number; far: number }
  surround: string
  grid: string
  gridHover: string
  props: { rock: string; trunk: string; foliageLight: string; foliageHeavy: string; floorLight: [number, number, number]; floorHeavy: [number, number, number]; roughFloor: [number, number, number]; pavement: [number, number, number] }
  water: { shallow: string; deep: string; bed: [number, number, number]; shore: string }
}

const mat = (folder: string): MatFiles => ({ albedo: `boards/${folder}/albedo.jpg`, normal: `boards/${folder}/normal.jpg`, rough: `boards/${folder}/rough.jpg` })

export const THEMES: Record<BoardThemeId, BoardTheme> = {
  desert: {
    id: 'desert', name: 'Desert', ground: mat('desert'), matSize: 24, cliff: mat('cliff-desert'),
    fallback: { ground: '#b98e58', cliff: '#8f6a4a' },
    light: { key: '#ffe3b8', keyIntensity: 2.9, sky: '#dfe6f2', groundBounce: '#7a5f43', hemiIntensity: 1.25, fill: '#7f9bc4' },
    fog: { color: '#23211f', near: 30, far: 82 },
    surround: '#17191c', grid: '#e9d9a8', gridHover: '#ffd75e',
    props: {
      rock: '#8d7b68', trunk: '#4b3a2a', foliageLight: '#8c9158', foliageHeavy: '#5b6c42',
      floorLight: [0.80, 0.84, 0.66], floorHeavy: [0.60, 0.70, 0.50], roughFloor: [0.84, 0.80, 0.76], pavement: [0.62, 0.62, 0.64],
    },
    water: { shallow: '#4fb0b8', deep: '#14566a', bed: [0.42, 0.55, 0.55], shore: '#bfe6df' },
  },
  grasslands: {
    id: 'grasslands', name: 'Grasslands', ground: mat('grasslands'), matSize: 24, cliff: mat('cliff-grasslands'),
    fallback: { ground: '#6f8a48', cliff: '#7a6f60' },
    light: { key: '#fff1d6', keyIntensity: 2.7, sky: '#d9e6f5', groundBounce: '#566b3d', hemiIntensity: 1.3, fill: '#86a6cc' },
    fog: { color: '#1b201d', near: 30, far: 82 },
    surround: '#15191a', grid: '#e4eecb', gridHover: '#ffd75e',
    props: {
      rock: '#8b877e', trunk: '#4a3b2a', foliageLight: '#527f38', foliageHeavy: '#33592c',
      floorLight: [0.74, 0.84, 0.64], floorHeavy: [0.54, 0.70, 0.48], roughFloor: [0.86, 0.84, 0.80], pavement: [0.64, 0.64, 0.66],
    },
    water: { shallow: '#58aeb0', deep: '#16505c', bed: [0.42, 0.55, 0.52], shore: '#c4e8de' },
  },
}
export const DEFAULT_THEME: BoardTheme = THEMES.desert

export function themeFor(id: string | null | undefined): BoardTheme {
  return id && id in THEMES ? THEMES[id as BoardThemeId] : DEFAULT_THEME
}
