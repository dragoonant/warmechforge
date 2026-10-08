// Lightweight pooled sprite particles (30-figures section 6: "all particles are pooled"; copied from Whirr Machine). Two fixed-size pools
// (additive for sparks and glows, normal blend for smoke), each one draw call. No per-particle objects: typed arrays
// reused as a ring buffer. Nothing here touches the rules.
import { AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial } from 'three'

export interface ParticleSpec {
  x: number; y: number; z: number
  vx?: number; vy?: number; vz?: number
  /** Seconds to live. */
  life: number
  size0: number
  size1?: number
  /** Linear 0..1 colour. */
  r: number; g: number; b: number
  alpha?: number
  /** Added to vy each second (negative falls, positive rises like smoke). */
  gravity?: number
  /** Velocity kept per second (1 = no drag). */
  drag?: number
}

export class ParticlePool {
  readonly capacity: number
  readonly geometry = new BufferGeometry()
  readonly points: Points
  readonly material: ShaderMaterial
  private readonly pos: Float32Array
  private readonly col: Float32Array
  private readonly siz: Float32Array
  private readonly vel: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly s0: Float32Array
  private readonly s1: Float32Array
  private readonly a0: Float32Array
  private readonly grav: Float32Array
  private readonly drag: Float32Array
  private next = 0
  /** Live particle count (the layer keeps the frame loop running while > 0). */
  alive = 0

  constructor(capacity: number, additive: boolean) {
    this.capacity = capacity
    const n = capacity
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.siz = new Float32Array(n)
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.maxLife = new Float32Array(n)
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n)
    this.grav = new Float32Array(n); this.drag = new Float32Array(n).fill(1)
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3))
    this.geometry.setAttribute('aColor', new BufferAttribute(this.col, 4))
    this.geometry.setAttribute('aSize', new BufferAttribute(this.siz, 1))
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
        void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vColor;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.15, d); if (a * vColor.a < 0.01) discard; gl_FragColor = vec4(vColor.rgb, vColor.a * a); }`,
      transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending,
    })
    this.points = new Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 10
  }

  emit(p: ParticleSpec): void {
    const i = this.next
    this.next = (this.next + 1) % this.capacity
    if (this.life[i]! <= 0) this.alive++
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z
    this.vel[i * 3] = p.vx ?? 0; this.vel[i * 3 + 1] = p.vy ?? 0; this.vel[i * 3 + 2] = p.vz ?? 0
    this.life[i] = p.life; this.maxLife[i] = p.life
    this.s0[i] = p.size0; this.s1[i] = p.size1 ?? p.size0; this.a0[i] = p.alpha ?? 1
    this.grav[i] = p.gravity ?? 0; this.drag[i] = p.drag ?? 1
    this.col[i * 4] = p.r; this.col[i * 4 + 1] = p.g; this.col[i * 4 + 2] = p.b; this.col[i * 4 + 3] = this.a0[i]!
    this.siz[i] = p.size0
  }

  /** Advance by dt seconds. Returns true while anything is alive. */
  update(dt: number): boolean {
    if (this.alive === 0) return false
    let alive = 0
    for (let i = 0; i < this.capacity; i++) {
      let l = this.life[i]!
      if (l <= 0) continue
      l -= dt
      if (l <= 0) { this.life[i] = 0; this.siz[i] = 0; this.col[i * 4 + 3] = 0; continue }
      this.life[i] = l
      alive++
      const t = 1 - l / this.maxLife[i]!
      const k = Math.pow(this.drag[i]!, dt)
      this.vel[i * 3] = this.vel[i * 3]! * k
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * k + this.grav[i]! * dt
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2]! * k
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt
      this.siz[i] = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * t
      this.col[i * 4 + 3] = this.a0[i]! * (1 - t) * (1 - t * 0.3)
    }
    this.alive = alive
    this.geometry.attributes.position!.needsUpdate = true
    this.geometry.attributes.aColor!.needsUpdate = true
    this.geometry.attributes.aSize!.needsUpdate = true
    return alive > 0
  }

  clear(): void { this.life.fill(0); this.siz.fill(0); this.col.fill(0); this.alive = 0 }
  dispose(): void { this.geometry.dispose(); this.material.dispose() }
}

// ---------- the two shared pools and the little emitters everything uses ----------
export const glowPool = new ParticlePool(384, true)
export const smokePool = new ParticlePool(160, false)
export const anyParticles = (): boolean => glowPool.alive > 0 || smokePool.alive > 0

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
export type Rgb = readonly [number, number, number]
export const COLOURS = {
  spark: [1, 0.72, 0.28] as Rgb, hot: [1, 0.95, 0.7] as Rgb, arcane: [0.55, 0.6, 1] as Rgb, arcaneCore: [0.85, 0.9, 1] as Rgb,
  smoke: [0.55, 0.56, 0.6] as Rgb, steam: [0.85, 0.88, 0.92] as Rgb, flame: [1, 0.45, 0.15] as Rgb, ice: [0.6, 0.9, 1] as Rgb,
  electric: [0.5, 0.9, 1] as Rgb,
}

/** A burst of fast sparks (impacts, crippled arms). */
export function sparks(x: number, y: number, z: number, n: number, c: Rgb = COLOURS.spark, speed = 4): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, up = rnd(0.2, 1)
    const s = rnd(0.4, 1) * speed
    glowPool.emit({ x, y, z, vx: Math.cos(a) * s, vy: up * s, vz: Math.sin(a) * s, life: rnd(0.25, 0.55), size0: 0.16, size1: 0.03, r: c[0], g: c[1], b: c[2], gravity: -9, drag: 0.4 })
  }
}
/** One bright flash (muzzle, impact core). */
export function flash(x: number, y: number, z: number, size = 0.9, c: Rgb = COLOURS.hot, life = 0.14): void {
  glowPool.emit({ x, y, z, life, size0: size, size1: size * 0.3, r: c[0], g: c[1], b: c[2], alpha: 1 })
}
/** A drifting smoke or steam puff. */
export function puff(x: number, y: number, z: number, c: Rgb = COLOURS.smoke, size = 0.5, life = 1.1, rise = 0.9): void {
  smokePool.emit({ x: x + rnd(-0.08, 0.08), y, z: z + rnd(-0.08, 0.08), vx: rnd(-0.12, 0.12), vy: rise, vz: rnd(-0.12, 0.12), life, size0: size * 0.5, size1: size * 1.6, r: c[0], g: c[1], b: c[2], alpha: 0.55, drag: 0.6 })
}
/** A small drifting glow mote (arcane trails, frost shimmer). */
export function mote(x: number, y: number, z: number, c: Rgb = COLOURS.arcane, size = 0.18, life = 0.5): void {
  glowPool.emit({ x: x + rnd(-0.1, 0.1), y: y + rnd(-0.1, 0.1), z: z + rnd(-0.1, 0.1), vy: rnd(0.1, 0.5), life, size0: size, size1: 0.02, r: c[0], g: c[1], b: c[2], alpha: 0.9 })
}
