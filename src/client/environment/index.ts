// Game-shop surroundings (prototype). Mount <GameShop /> inside the board's <Canvas>; <EstablishingShot /> after the camera.
export { GameShop, SHOP_ZOOM_MAX, SHOP_FOG, SHOP_HDRI, type GameShopProps } from './GameShop'
export {
  EstablishingShot, EstablishingHint, useEstablishingActive, playEstablishingShot, SHOT_DURATION_S, type EstablishingShotProps,
} from './EstablishingShot'
export {
  useSurroundings, useEffectiveSurroundings, useSurroundingsForced, setSurroundings, resolveSurroundings, SURROUNDINGS_OPTIONS,
  SURROUNDINGS_KEY, type Surroundings,
} from './surroundings'
export { buildShop, tableSize, ROOM, FLOOR_Y, CEIL_Y, CM, type ShopGeometry } from './shopBuild'
/** Dev route helper: true when the page URL has ?shop. */
export const isShopRoute = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).has('shop')
export { ShopDev } from './dev/ShopDev'
