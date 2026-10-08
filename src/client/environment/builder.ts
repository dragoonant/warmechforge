// Tiny static-geometry builder for the game shop: boxes and cylinders with vertex colours and atlas UV rects,
// merged into one BufferGeometry per material. Pure maths (three only), so it runs under node for the budget test.
import * as THREE from 'three'

/** UV rectangle [u0, v0, u1, v1] (v up). */
export type Rect = readonly [number, number, number, number]
export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

export interface BoxOpts {
  /** Bottom-centre of the box in the current local frame. */
  at: readonly [number, number, number]
  size: readonly [number, number, number]
  /** Tint for faces without a texture rect (linear conversion handled here). */
  color?: THREE.ColorRepresentation
  ry?: number
  rz?: number
  rx?: number
  /** Atlas rectangles by face; faces without one sample the white texel and take `color`. */
  faces?: Partial<Record<Face, Rect>>
  /** One rectangle on all six faces. */
  all?: Rect
  /** Tint on textured faces (default white). */
  tint?: THREE.ColorRepresentation
}

export interface CylOpts {
  at: readonly [number, number, number]
  r: number
  /** Top radius (default r). 0 makes a cone. */
  r2?: number
  h: number
  seg?: number
  color?: THREE.ColorRepresentation
  /** Close the top / bottom (default true / true). */
  capTop?: boolean
  capBottom?: boolean
  ry?: number
  rz?: number
  rx?: number
  /** Face the sides inward too (lamp shades): emits both windings. */
  doubleSided?: boolean
}

export interface BuilderOutput {
  position: Float32Array
  normal: Float32Array
  uv: Float32Array
  color: Float32Array
  triangles: number
}

const ZERO_RECT: Rect = [0, 0, 0, 0]
const tmpColor = new THREE.Color()

export class Builder {
  private pos: number[] = []
  private nor: number[] = []
  private uvs: number[] = []
  private col: number[] = []
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]
  triangles = 0
  /** @param white  atlas rect of a pure white texel (solid faces sample it). Zero rect for untextured materials. */
  constructor(private readonly white: Rect = ZERO_RECT) {}

  /** Enter a local frame (translate then rotate about Y). Pair with pop(). */
  push(x: number, y: number, z: number, ry = 0): this {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1))
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m))
    return this
  }
  pop(): this { if (this.stack.length > 1) this.stack.pop(); return this }
  /** Run fn inside a local frame. */
  frame(x: number, y: number, z: number, ry: number, fn: () => void): this { this.push(x, y, z, ry); fn(); return this.pop() }

  private cur(): THREE.Matrix4 { return this.stack[this.stack.length - 1] }

  private tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3,
    ua: readonly [number, number], ub: readonly [number, number], uc: readonly [number, number], rgb: readonly [number, number, number]): void {
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]] as const) {
      this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uvs.push(u[0], u[1]); this.col.push(rgb[0], rgb[1], rgb[2])
    }
    this.triangles++
  }

  private rgb(c: THREE.ColorRepresentation | undefined): [number, number, number] {
    tmpColor.set(c ?? '#ffffff'); return [tmpColor.r, tmpColor.g, tmpColor.b]
  }

  private localMatrix(at: readonly [number, number, number], ry = 0, rz = 0, rx = 0): THREE.Matrix4 {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'))
    return this.cur().clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(at[0], at[1], at[2]), q, new THREE.Vector3(1, 1, 1)))
  }

  box(o: BoxOpts): this {
    const [w, h, d] = o.size
    const hx = w / 2, hz = d / 2
    const m = this.localMatrix(o.at, o.ry, o.rz, o.rx)
    const nm = new THREE.Matrix3().getNormalMatrix(m)
    const plain = this.rgb(o.color), tinted = this.rgb(o.tint)
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m)
    // y runs 0..h from the bottom-centre origin.
    const faces: Array<[Face, number[][], [number, number, number]]> = [
      ['front', [[-hx, 0, hz], [hx, 0, hz], [hx, h, hz], [-hx, h, hz]], [0, 0, 1]],
      ['back', [[hx, 0, -hz], [-hx, 0, -hz], [-hx, h, -hz], [hx, h, -hz]], [0, 0, -1]],
      ['right', [[hx, 0, hz], [hx, 0, -hz], [hx, h, -hz], [hx, h, hz]], [1, 0, 0]],
      ['left', [[-hx, 0, -hz], [-hx, 0, hz], [-hx, h, hz], [-hx, h, -hz]], [-1, 0, 0]],
      ['top', [[-hx, h, hz], [hx, h, hz], [hx, h, -hz], [-hx, h, -hz]], [0, 1, 0]],
      ['bottom', [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]], [0, -1, 0]],
    ]
    for (const [name, c, n] of faces) {
      const rect = o.faces?.[name] ?? o.all
      const r = rect ?? this.white
      const rgb = rect ? tinted : plain
      const nv = new THREE.Vector3(n[0], n[1], n[2]).applyMatrix3(nm).normalize()
      const [p0, p1, p2, p3] = c.map((q) => V(q[0], q[1], q[2]))
      const uBL: [number, number] = [r[0], r[1]], uBR: [number, number] = [r[2], r[1]], uTR: [number, number] = [r[2], r[3]], uTL: [number, number] = [r[0], r[3]]
      this.tri(p0, p1, p2, nv, uBL, uBR, uTR, rgb)
      this.tri(p0, p2, p3, nv, uBL, uTR, uTL, rgb)
    }
    return this
  }

  cyl(o: CylOpts): this {
    const seg = o.seg ?? 8
    const r2 = o.r2 ?? o.r
    const m = this.localMatrix(o.at, o.ry, o.rz, o.rx)
    const nm = new THREE.Matrix3().getNormalMatrix(m)
    const rgb = this.rgb(o.color)
    const uvc: [number, number] = [(this.white[0] + this.white[2]) / 2, (this.white[1] + this.white[3]) / 2]
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m)
    const slope = (o.r - r2) / Math.max(1e-6, o.h)
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2
      const am = (a0 + a1) / 2
      const n = new THREE.Vector3(Math.sin(am), slope, Math.cos(am)).applyMatrix3(nm).normalize()
      const b0 = V(Math.sin(a0) * o.r, 0, Math.cos(a0) * o.r), b1 = V(Math.sin(a1) * o.r, 0, Math.cos(a1) * o.r)
      const t0 = V(Math.sin(a0) * r2, o.h, Math.cos(a0) * r2), t1 = V(Math.sin(a1) * r2, o.h, Math.cos(a1) * r2)
      this.tri(b0, t1, b1, n, uvc, uvc, uvc, rgb) // CCW seen from outside
      if (r2 > 1e-6) this.tri(b0, t0, t1, n, uvc, uvc, uvc, rgb)
      if (o.doubleSided) {
        const ni = n.clone().multiplyScalar(-1)
        this.tri(b0, b1, t1, ni, uvc, uvc, uvc, rgb)
        if (r2 > 1e-6) this.tri(b0, t1, t0, ni, uvc, uvc, uvc, rgb)
      }
      if (o.capTop !== false && r2 > 1e-6) {
        const c = V(0, o.h, 0); const nt = new THREE.Vector3(0, 1, 0).applyMatrix3(nm).normalize()
        this.tri(c, t1, t0, nt, uvc, uvc, uvc, rgb)
      }
      if (o.capBottom !== false) {
        const c = V(0, 0, 0); const nb = new THREE.Vector3(0, -1, 0).applyMatrix3(nm).normalize()
        this.tri(c, b0, b1, nb, uvc, uvc, uvc, rgb)
      }
    }
    return this
  }

  /** A flat quad with per-corner colours (window glow gradient etc.), BL BR TR TL, facing the way the winding says. */
  quad(p: readonly [number, number, number][], colours: THREE.ColorRepresentation[], rect: Rect = this.white): this {
    const m = this.cur()
    const nm = new THREE.Matrix3().getNormalMatrix(m)
    const pts = p.map((q) => new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(m))
    const n = new THREE.Vector3().crossVectors(pts[1].clone().sub(pts[0]), pts[2].clone().sub(pts[0])).normalize()
    void nm
    const cs = colours.map((c) => this.rgb(c))
    const uv: [number, number][] = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]]
    this.pushTri(pts[0], pts[1], pts[2], n, [uv[0], uv[1], uv[2]], [cs[0], cs[1], cs[2]])
    this.pushTri(pts[0], pts[2], pts[3], n, [uv[0], uv[2], uv[3]], [cs[0], cs[2], cs[3]])
    return this
  }

  private pushTri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3, uv: [number, number][], cs: [number, number, number][]): void {
    ;[a, b, c].forEach((p, i) => {
      this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uvs.push(uv[i][0], uv[i][1]); this.col.push(cs[i][0], cs[i][1], cs[i][2])
    })
    this.triangles++
  }

  output(): BuilderOutput {
    return {
      position: new Float32Array(this.pos), normal: new Float32Array(this.nor), uv: new Float32Array(this.uvs),
      color: new Float32Array(this.col), triangles: this.triangles,
    }
  }
}

export function toGeometry(o: BuilderOutput): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(o.uv, 2))
  g.setAttribute('color', new THREE.BufferAttribute(o.color, 3))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

/** Seeded RNG (mulberry32) so the shop is identical every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
