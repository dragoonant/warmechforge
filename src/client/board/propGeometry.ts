// Low-poly geometry for the terrain props. Trees are unit height (y 0..1) so an instance scale sets the height; vertex colours
// carry trunk and foliage so one InstancedMesh draws a whole kind of woods.
import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hash32 } from './hash'

function paint(g: BufferGeometry, colour: Color): BufferGeometry {
  const n = g.getAttribute('position').count, a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = colour.r; a[i * 3 + 1] = colour.g; a[i * 3 + 2] = colour.b }
  g.setAttribute('color', new Float32BufferAttribute(a, 3))
  return g
}
const flat = (g: BufferGeometry): BufferGeometry => { const f = g.index ? g.toNonIndexed() : g; f.computeVertexNormals(); return f }

/** Conifer-ish tree: trunk plus stacked cones (one cone and a stub on Low graphics). Radius ~0.34 of its height at the base. */
export function buildTreeGeometry(foliage: string, trunk: string, low: boolean): BufferGeometry {
  const fol = new Color(foliage), tr = new Color(trunk)
  const seg = low ? 5 : 7
  const parts: BufferGeometry[] = []
  const t = new CylinderGeometry(0.03, 0.045, 0.30, 5); t.translate(0, 0.15, 0); parts.push(paint(flat(t), tr))
  const cone = (r: number, h: number, y: number, shade: number): void => {
    const c = new ConeGeometry(r, h, seg, 1); c.translate(0, y + h / 2, 0)
    parts.push(paint(flat(c), fol.clone().multiplyScalar(shade)))
  }
  if (low) cone(0.34, 0.85, 0.2, 1)
  else { cone(0.36, 0.52, 0.17, 0.82); cone(0.27, 0.46, 0.42, 0.94); cone(0.17, 0.36, 0.64, 1.08) }
  const out = mergeGeometries(parts, false)!
  out.computeBoundingSphere()
  return out
}

/** A squat, faceted rock of unit radius; vertex positions are pushed around by a hash so no two rocks of a kind look alike. */
export function buildRockGeometry(detail = 1): BufferGeometry {
  const g = new IcosahedronGeometry(1, detail)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const h = (hash32(`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`) % 1000) / 1000
    const k = 0.78 + h * 0.4
    p.setXYZ(i, x * k, y * k * 0.62, z * k)
  }
  const f = flat(g)
  paint(f, new Color('#ffffff'))
  f.computeBoundingSphere()
  return f
}
