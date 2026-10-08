// <GameShop />: the cosy local game shop around the board. Mount it inside the <Canvas>; the board is centred at the origin
// with its surface at y = 0. Renders nothing when Surroundings is Plain or graphics is Low.
import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { toGeometry } from './builder'
import { buildShop, CEIL_Y, FLOOR_Y, KEY_LIGHT_Y, ROOM, DEFAULT_BOARD, type ShopGeometry } from './shopBuild'
import { drawArtAtlas, drawPaperAtlas, drawPlanks, drawTableWood, toTexture } from './atlas'
import { useEffectiveSurroundings } from './surroundings'

/** How far the player may zoom out while the shop is mounted (the board-only limit is 30). */
export const SHOP_ZOOM_MAX = 150
export const SHOP_FOG = { color: '#1b1511', near: 120, far: 420 } as const
export const SHOP_HDRI = 'assets/environment/shop-interior-1k.hdr'

export interface GameShopProps {
  /** Map footprint in hexes (width along x, depth along z). Sizes the table. */
  boardWidth?: number
  boardDepth?: number
  /** Skip the reflections HDRI (tests, very low-end). */
  noEnvironment?: boolean
  /** Brightness of the warm pendant key light over the table. */
  keyIntensity?: number
  /** Leave the camera zoom limit alone. */
  keepCameraLimits?: boolean
}

const assetUrl = (p: string): string => `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}${p}`

interface Disposables { dispose(): void }

function useShopAssets(geo: ShopGeometry) {
  return useMemo(() => {
    const art = toTexture(drawArtAtlas()), paper = toTexture(drawPaperAtlas()), wood = toTexture(drawTableWood())
    const planks = toTexture(drawPlanks(), { repeat: [252 / 37.6, 315 / 37.6] })
    const std = (m: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...m })
    const mats = {
      solid: std({ roughness: 0.85 }),
      art: std({ map: art, roughness: 0.6 }),
      paper: std({ map: paper, roughness: 0.75 }),
      wood: std({ map: wood, roughness: 0.55 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      glass: std({ transparent: true, opacity: 0.2, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }),
      floor: new THREE.MeshStandardMaterial({ map: planks, roughness: 0.55 }),
    }
    const g = (o: Parameters<typeof toGeometry>[0]) => toGeometry(o)
    const geos = {
      nearSolid: g(geo.near.solid), nearArt: g(geo.near.art), nearPaper: g(geo.near.paper), nearWood: g(geo.near.wood),
      roomSolid: g(geo.room.solid), roomArt: g(geo.room.art), roomPaper: g(geo.room.paper), glow: g(geo.glow), glass: g(geo.glass),
    }
    const all: Disposables[] = [art, paper, wood, planks, ...Object.values(mats), ...Object.values(geos)]
    return { mats, geos, dispose: () => all.forEach((d) => d.dispose()) }
  }, [geo])
}

/** Soft additive pool of warm light on a table or the floor (fake bounce under the non-key pendants). */
function usePoolTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,214,150,0.55)'); g.addColorStop(0.5, 'rgba(255,190,120,0.18)'); g.addColorStop(1, 'rgba(255,170,100,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
  }, [])
}

function ShopScene({ geo, noEnvironment, keyIntensity, keepCameraLimits }: { geo: ShopGeometry; noEnvironment: boolean; keyIntensity: number; keepCameraLimits: boolean }) {
  const { scene, gl, camera, invalidate } = useThree()
  const controls = useThree((s) => s.controls) as (THREE.EventDispatcher & { maxDistance?: number; maxPolarAngle?: number; update?: () => void }) | null
  const a = useShopAssets(geo)
  const pool = usePoolTexture()
  useEffect(() => () => a.dispose(), [a])
  useEffect(() => () => pool.dispose(), [pool])

  // scene look: fog and background (restored on unmount), shadows on
  useEffect(() => {
    const prevFog = scene.fog, prevBg = scene.background
    scene.fog = new THREE.Fog(SHOP_FOG.color, SHOP_FOG.near, SHOP_FOG.far)
    scene.background = new THREE.Color(SHOP_FOG.color)
    gl.shadowMap.enabled = true
    invalidate()
    return () => { scene.fog = prevFog; scene.background = prevBg; invalidate() }
  }, [scene, gl, invalidate])

  // reflections: CC0 interior HDRI (Poly Haven), low intensity, optional
  useEffect(() => {
    if (noEnvironment) return
    let dead = false
    let tex: THREE.Texture | null = null
    const prev = scene.environment, prevI = scene.environmentIntensity
    new HDRLoader().load(assetUrl(SHOP_HDRI), (hdr) => {
      if (dead) { hdr.dispose(); return }
      const pm = new THREE.PMREMGenerator(gl)
      tex = pm.fromEquirectangular(hdr).texture
      hdr.dispose(); pm.dispose()
      scene.environment = tex; scene.environmentIntensity = 0.3
      invalidate()
    }, undefined, () => { /* missing HDRI: lights alone are fine */ })
    return () => { dead = true; scene.environment = prev; scene.environmentIntensity = prevI; tex?.dispose(); invalidate() }
  }, [scene, gl, invalidate, noEnvironment])

  // pull-back limit
  useEffect(() => {
    if (keepCameraLimits) return
    const cam = camera as THREE.PerspectiveCamera
    const prev = { far: cam.far, maxD: controls?.maxDistance, maxP: controls?.maxPolarAngle }
    cam.far = Math.max(cam.far, 800); cam.updateProjectionMatrix()
    if (controls) { controls.maxDistance = Math.max(controls.maxDistance ?? 0, SHOP_ZOOM_MAX); controls.maxPolarAngle = Math.max(controls.maxPolarAngle ?? 0, Math.PI * 0.49); controls.update?.() }
    return () => {
      cam.far = prev.far; cam.updateProjectionMatrix()
      if (controls) { if (prev.maxD !== undefined) controls.maxDistance = prev.maxD; if (prev.maxP !== undefined) controls.maxPolarAngle = prev.maxP }
    }
  }, [camera, controls, keepCameraLimits])

  const { mats: m, geos: g } = a
  const midZ = (ROOM.z0 + ROOM.z1) / 2
  return (
    <group name="game-shop">
      {/* lighting: warm pendant key (the only shadow caster), soft room fill, window glow */}
      <hemisphereLight args={['#ffe6c0', '#5a4636', 0.8]} />
      <ambientLight color="#ffd7a8" intensity={0.22} />
      <spotLight position={[0, KEY_LIGHT_Y - 3, 0]} angle={0.74} penumbra={0.9} intensity={keyIntensity} decay={0} color="#ffd9a6"
        castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-camera-near={12} shadow-camera-far={90} />
      <pointLight position={[ROOM.x1 - 14, FLOOR_Y + 40, -8]} intensity={1.6} distance={160} decay={1} color="#ffb070" />
      <pointLight position={[-70, 30, -40]} intensity={0.9} distance={200} decay={1} color="#ffd9a6" />
      <pointLight position={[40, 30, 70]} intensity={1.2} distance={200} decay={1} color="#ffd9a6" />

      <mesh geometry={g.nearSolid} material={m.solid} castShadow receiveShadow />
      <mesh geometry={g.nearArt} material={m.art} castShadow receiveShadow />
      <mesh geometry={g.nearPaper} material={m.paper} castShadow receiveShadow />
      <mesh geometry={g.nearWood} material={m.wood} castShadow receiveShadow />
      <mesh geometry={g.roomSolid} material={m.solid} receiveShadow />
      <mesh geometry={g.roomArt} material={m.art} />
      <mesh geometry={g.roomPaper} material={m.paper} />
      <mesh geometry={g.glow} material={m.glow} />
      <mesh geometry={g.glass} material={m.glass} renderOrder={5} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, midZ]} material={m.floor} receiveShadow>
        <planeGeometry args={[ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0]} />
      </mesh>
      {geo.lamps.filter((l) => !l.key).map((l, i) => (
        <group key={i}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[l.x, 0.12, l.z]} renderOrder={3}>
            <planeGeometry args={[l.radius * 2.4, l.radius * 1.8]} />
            <meshBasicMaterial map={pool} transparent blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export function GameShop({ boardWidth = DEFAULT_BOARD.boardWidth, boardDepth = DEFAULT_BOARD.boardDepth, noEnvironment = false, keyIntensity = 2.4, keepCameraLimits = false }: GameShopProps) {
  const mode = useEffectiveSurroundings()
  const geo = useMemo(() => (mode === 'shop' ? buildShop({ boardWidth, boardDepth }) : null), [mode, boardWidth, boardDepth])
  if (!geo) return null
  return <ShopScene geo={geo} noEnvironment={noEnvironment} keyIntensity={keyIntensity} keepCameraLimits={keepCameraLimits} />
}

export { CEIL_Y }
