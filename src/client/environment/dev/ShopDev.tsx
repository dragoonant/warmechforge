// ?shop dev route: mounts <GameShop/> with a placeholder board-sized plane so the surroundings can be tuned without the real board.
// Dev server: /src/client/environment/dev/shop.html?view=wide|mid|play|est|top  (&cam=x,y,z&tgt=x,y,z  &plain=1  &noenv=1)
// The app shell can also mount <ShopDev /> when isShopRoute() is true.
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { GameShop } from '../GameShop'
import { EstablishingShot, EstablishingHint } from '../EstablishingShot'
import { setSurroundings } from '../surroundings'
import { useSettingsStore } from '../../store/settingsStore'

const VIEWS: Record<string, { cam: [number, number, number]; tgt: [number, number, number] }> = {
  play: { cam: [0, 24, 20], tgt: [0, 0, 0] },
  top: { cam: [0.01, 46, 0], tgt: [0, 0, 0] },
  mid: { cam: [40, 24, 52], tgt: [0, 0, -8] },
  wide: { cam: [70, 40, 96], tgt: [-6, 8, -70] },
  est: { cam: [0, 24, 20], tgt: [0, 0, 0] },
}
const v3 = (s: string | null): [number, number, number] | null => {
  if (!s) return null
  const p = s.split(',').map(Number)
  return p.length === 3 && p.every(Number.isFinite) ? (p as [number, number, number]) : null
}

function Placeholder({ w, d }: { w: number; d: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256
    const x = c.getContext('2d')!
    x.fillStyle = '#6f7f5a'; x.fillRect(0, 0, 256, 256)
    x.strokeStyle = '#2a3322'; x.lineWidth = 2
    for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) {
      const cx = q * 48 + (r % 2) * 24 + 10, cy = r * 32 + 16
      x.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; x.lineTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18) } x.closePath(); x.stroke()
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 4); return t
  }, [])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
        <planeGeometry args={[w, d]} /><meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {[[-3, -4, '#8a2f2a'], [2, 1, '#2e5a7a'], [4, -2, '#8a2f2a'], [-2, 5, '#2e5a7a']].map(([x, z, c], i) => (
        <mesh key={i} position={[x as number, 1, z as number]} castShadow><boxGeometry args={[0.7, 2, 0.7]} /><meshStandardMaterial color={c as string} /></mesh>
      ))}
    </group>
  )
}

export function ShopDev() {
  const q = useMemo(() => new URLSearchParams(location.search), [])
  const view = VIEWS[q.get('view') ?? 'play'] ?? VIEWS.play
  const cam = v3(q.get('cam')) ?? view.cam, tgt = v3(q.get('tgt')) ?? view.tgt
  useEffect(() => {
    setSurroundings(q.has('plain') ? 'plain' : 'shop')
    useSettingsStore.getState().set({ graphics: q.has('low') ? 'low' : 'high', speed: q.get('view') === 'est' ? 1 : 0 })
  }, [q])
  return (
    <>
      <Canvas shadows dpr={1} camera={{ position: cam, fov: 40, near: 0.1, far: 900 }} gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => { (window as unknown as { __shopReady: boolean }).__shopReady = false; setTimeout(() => { (window as unknown as { __shopReady: boolean }).__shopReady = true }, 2500); void gl }}>
        <color attach="background" args={['#14161a']} />
        <OrbitControls makeDefault target={tgt} maxDistance={30} />
        <Placeholder w={14.2} d={17.5} />
        <GameShop noEnvironment={q.has('noenv')} />
        {q.get('view') === 'est' && <EstablishingShot />}
      </Canvas>
      <EstablishingHint />
    </>
  )
}
