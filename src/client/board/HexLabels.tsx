// XXYY hex labels: one canvas atlas, one instanced quad per label. Mode 'always' shows every hex; 'hover' shows only the hovered
// hex, a little larger; 'off' draws nothing. Labels lie flat at the north edge of the hex top.
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from 'react'
import { useThree } from '@react-three/fiber'
import {
  CanvasTexture, InstancedBufferAttribute, InstancedMesh, LinearFilter, Matrix4, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import type { HexLabel } from '../../engine/types'
import type { BoardTheme } from './boards'
import { type BoardLayout } from './layout'
import { visibleY } from './HexGrid'

export const ATLAS = { size: 2048, cellW: 128, cellH: 40 } as const
const COLS = ATLAS.size / ATLAS.cellW, ROWS = Math.floor(ATLAS.size / ATLAS.cellH)
export const LABEL_CAPACITY = COLS * ROWS

/** Atlas cell (col,row) of the i-th label. */
export const cellOf = (i: number): { col: number; row: number } => ({ col: i % COLS, row: Math.floor(i / COLS) })

function drawAtlas(labels: HexLabel[], gold: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = c.height = ATLAS.size
  const g = c.getContext('2d'); if (!g) return null
  g.font = '700 26px system-ui, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  labels.slice(0, LABEL_CAPACITY).forEach((l, i) => {
    const { col, row } = cellOf(i), x = col * ATLAS.cellW, y = row * ATLAS.cellH
    g.fillStyle = 'rgba(14,16,20,0.62)'
    g.beginPath(); g.roundRect(x + 14, y + 6, ATLAS.cellW - 28, ATLAS.cellH - 12, 9); g.fill()
    g.fillStyle = gold; g.fillText(l, x + ATLAS.cellW / 2, y + ATLAS.cellH / 2 + 1)
  })
  return c
}

export function HexLabels({ layout, theme, mode, hover }: { layout: BoardLayout; theme: BoardTheme; mode: 'hover' | 'always' | 'off'; hover: HexLabel | null }): ReactElement | null {
  const invalidate = useThree((s) => s.invalidate)
  const ref = useRef<InstancedMesh>(null)
  const labels = useMemo(() => layout.tiles.map((t) => t.label), [layout])
  const index = useMemo(() => new Map(labels.map((l, i) => [l, i])), [labels])
  const tex = useMemo(() => {
    const c = drawAtlas(labels, '#f2d98a'); if (!c) return null
    const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.minFilter = LinearFilter; t.generateMipmaps = false; t.anisotropy = 4
    return t
  }, [labels])
  const geo = useMemo(() => new PlaneGeometry(0.46, 0.145).rotateX(-Math.PI / 2), [])
  const count = mode === 'always' ? layout.tiles.length : mode === 'hover' ? 1 : 0
  const mat = useMemo(() => {
    if (!tex) return null
    const m = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
    m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
      sh.uniforms.uCell = { value: [1 / COLS, 1 / ROWS] }
      sh.vertexShader = 'attribute vec2 aCell;\nuniform vec2 uCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * uCell + aCell;\n#endif')
    }
    m.customProgramCacheKey = () => 'wmf-labels'
    return m
  }, [tex])
  useEffect(() => () => { tex?.dispose(); mat?.dispose(); geo.dispose() }, [tex, mat, geo])

  useLayoutEffect(() => {
    const m = ref.current; if (!m || !count) return
    const cell = new Float32Array(count * 2), mx = new Matrix4()
    const put = (slot: number, label: HexLabel, scale: number): void => {
      const t = layout.byLabel.get(label), i = index.get(label)
      if (!t || i === undefined) { mx.makeScale(0, 0, 0); m.setMatrixAt(slot, mx); return }
      const { col, row } = cellOf(i)
      cell[slot * 2] = col / COLS; cell[slot * 2 + 1] = 1 - (row + 1) / ROWS
      mx.makeScale(scale, 1, scale).setPosition(t.x, visibleY(t) + 0.006, t.z - 0.31 * scale)
      m.setMatrixAt(slot, mx)
    }
    if (mode === 'always') layout.tiles.forEach((t, i) => put(i, t.label, 1))
    else if (hover) put(0, hover, 1.3)
    else { mx.makeScale(0, 0, 0); m.setMatrixAt(0, mx) }
    m.geometry.setAttribute('aCell', new InstancedBufferAttribute(cell, 2))
    m.instanceMatrix.needsUpdate = true; m.count = count
    invalidate()
  }, [layout, index, mode, hover, count, invalidate, mat])

  if (!mat || !count) return null
  return <instancedMesh key={`${mode}-${count}`} ref={ref} name="hex-labels" args={[geo, mat, count]} frustumCulled={false} renderOrder={5} />
}
