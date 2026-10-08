// Plays FxSpecs: a few pooled meshes (beams, bolts, streaks, missile orbs, rings) plus the sprite particles. Imperative on
// purpose: nothing here re-renders React and nothing allocates per frame once the pools exist. `lite` (Low graphics) draws
// only the meshes (no particles). Adapted from Whirr Machine's VfxEngine for lasers, PPC bolts, tracers and missile trails.
import { AdditiveBlending, BoxGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, Vector3 } from 'three'
import { COLOURS, flash, glowPool, mote, puff, smokePool, sparks } from './particles'
import type { FxSpec } from './effects'
import type { V3 } from '../figures/sockets'

const UNIT_BOX = new BoxGeometry(1, 1, 1)
const ORB = new SphereGeometry(0.5, 10, 8)
const RING = new RingGeometry(0.9, 1, 48)
const mat = (hex: number, opacity = 1) => new MeshBasicMaterial({ color: hex, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false })

interface Beam { mesh: Mesh; core: Mesh; from: V3; to: V3; t0: number; dur: number; width: number; live: boolean }
interface Shot { mesh: Mesh; from: V3; to: V3; t0: number; dur: number; kind: 'bolt' | 'tracer' | 'missile'; arc: number; live: boolean; trailAt: number }
interface RingFx { mesh: Mesh; t0: number; dur: number; radius: number; live: boolean }
interface Pending { at: number; spec: FxSpec }

export const POOL = { beams: 6, shots: 24, rings: 8 } as const

export class VfxEngine {
  readonly group = new Group()
  /** True in Low graphics: meshes only, no particles. */
  lite = false
  private beams: Beam[] = []
  private shots: Shot[] = []
  private rings: RingFx[] = []
  private pending: Pending[] = []
  private readonly tmp = new Vector3()

  constructor() {
    this.group.name = 'wmf-vfx'
    for (let i = 0; i < POOL.beams; i++) {
      const mesh = new Mesh(UNIT_BOX, mat(0xff3b30, 0.9))
      const core = new Mesh(UNIT_BOX, mat(0xffffff, 1))
      mesh.visible = false; core.visible = false
      mesh.renderOrder = 11; core.renderOrder = 12
      this.group.add(mesh, core)
      this.beams.push({ mesh, core, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, t0: 0, dur: 1, width: 0.03, live: false })
    }
    for (let i = 0; i < POOL.shots; i++) {
      const mesh = new Mesh(ORB, mat(0xffe9a8))
      mesh.visible = false
      mesh.renderOrder = 11
      this.group.add(mesh)
      this.shots.push({ mesh, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, t0: 0, dur: 1, kind: 'tracer', arc: 0, live: false, trailAt: 0 })
    }
    for (let i = 0; i < POOL.rings; i++) {
      const mesh = new Mesh(RING, mat(0xffb060))
      mesh.visible = false
      mesh.rotation.x = -Math.PI / 2
      mesh.renderOrder = 11
      this.group.add(mesh)
      this.rings.push({ mesh, t0: 0, dur: 1, radius: 1, live: false })
    }
    this.group.add(glowPool.points, smokePool.points)
  }

  /** Queue specs; speed > 1 plays them faster. Delays and durations in the specs are ms at speed 1. */
  play(specs: readonly FxSpec[], now: number, speed: number): void {
    const k = 1 / Math.max(0.25, speed)
    for (const s of specs) {
      const delay = s.delay * k + (('delayReal' in s && s.delayReal) || 0)
      const spec = 'dur' in s ? ({ ...s, dur: s.dur * k } as FxSpec) : s
      if (delay > 1) this.pending.push({ at: now + delay, spec })
      else this.start(spec, now)
    }
  }

  /** True while anything is queued or alive (the layer keeps the demand frameloop running). */
  get busy(): boolean {
    return this.pending.length > 0 || this.beams.some((s) => s.live) || this.shots.some((s) => s.live) || this.rings.some((r) => r.live) || glowPool.alive > 0 || smokePool.alive > 0
  }

  private freeShot(): Shot | undefined { return this.shots.find((x) => !x.live) }

  private launch(kind: Shot['kind'], from: V3, to: V3, now: number, dur: number, colour: number, size: number, arc: number, offset = 0): void {
    const s = this.freeShot()
    if (!s) return
    s.live = true; s.from = from; s.to = to; s.t0 = now + offset; s.dur = Math.max(60, dur); s.kind = kind; s.arc = arc; s.trailAt = 0
    ;(s.mesh.material as MeshBasicMaterial).color.setHex(colour)
    s.mesh.scale.set(size, size, kind === 'tracer' ? size * 7 : size)
    s.mesh.visible = false // shown once its start time passes
  }

  private start(spec: FxSpec, now: number): void {
    switch (spec.kind) {
      case 'muzzle': {
        if (this.lite) break
        const { at, dir } = spec
        const ox = at.x + dir.x * 0.05, oy = at.y + dir.y * 0.05, oz = at.z + dir.z * 0.05
        flash(ox, oy, oz, spec.big ? 0.45 : 0.28)
        for (let i = 0; i < (spec.big ? 8 : 4); i++) {
          const sp = 1.4 + Math.random() * 2
          glowPool.emit({ x: ox, y: oy, z: oz, vx: dir.x * sp + (Math.random() - 0.5), vy: dir.y * sp + Math.random() * 0.5, vz: dir.z * sp + (Math.random() - 0.5), life: 0.2, size0: 0.05, size1: 0.01, r: 1, g: 0.8, b: 0.4, drag: 0.3 })
        }
        if (spec.big) puff(ox, oy, oz, COLOURS.smoke, 0.22, 0.8, 0.4)
        break
      }
      case 'beam': {
        const b = this.beams.find((x) => !x.live)
        if (!b) break
        b.live = true; b.from = spec.from; b.to = spec.to; b.t0 = now; b.dur = Math.max(80, spec.dur); b.width = spec.width
        ;(b.mesh.material as MeshBasicMaterial).color.setHex(spec.colour)
        b.mesh.visible = true; b.core.visible = true
        break
      }
      case 'bolt': this.launch('bolt', spec.from, spec.to, now, spec.dur, spec.colour, 0.1, 0.0); break
      case 'tracers': {
        for (let i = 0; i < spec.count; i++) {
          const j = (Math.random() - 0.5) * spec.spread
          const to = { x: spec.to.x + j, y: spec.to.y + (Math.random() - 0.5) * spec.spread, z: spec.to.z + j }
          this.launch('tracer', spec.from, to, now, spec.dur, 0xffe39a, 0.025, 0, i * 45)
        }
        break
      }
      case 'missiles': {
        for (let i = 0; i < spec.count; i++) {
          const to = { x: spec.to.x + (Math.random() - 0.5) * 0.25, y: spec.to.y + (Math.random() - 0.5) * 0.2, z: spec.to.z + (Math.random() - 0.5) * 0.25 }
          this.launch('missile', spec.from, to, now, spec.dur * (0.9 + Math.random() * 0.2), 0xffd07a, 0.045, 0.25 + Math.random() * 0.35, i * 55)
        }
        break
      }
      case 'impact': {
        const { at } = spec
        if (this.lite) { this.ringAt(at, spec.mode === 'blast' ? 0.5 : 0.25, 0xffb060, 280, now); break }
        if (spec.mode === 'blast') {
          flash(at.x, at.y, at.z, 0.9, COLOURS.hot, 0.22)
          sparks(at.x, at.y, at.z, 12, COLOURS.flame, 2.6)
          puff(at.x, at.y, at.z, COLOURS.smoke, 0.45, 1, 0.5)
        } else if (spec.mode === 'melee') {
          flash(at.x, at.y, at.z, 0.5, COLOURS.hot, 0.12)
          sparks(at.x, at.y, at.z, 10, COLOURS.spark, 2.8)
        } else if (spec.mode === 'crit') {
          flash(at.x, at.y, at.z, 0.5, COLOURS.electric, 0.14)
          sparks(at.x, at.y, at.z, 10, COLOURS.electric, 2.4)
        } else {
          flash(at.x, at.y, at.z, 0.32, COLOURS.hot, 0.1)
          sparks(at.x, at.y, at.z, 6, COLOURS.spark, 2)
        }
        break
      }
      case 'fireball': {
        const { at, size } = spec
        if (this.lite) { this.ringAt(at, size, 0xff8a30, 500, now); break }
        flash(at.x, at.y, at.z, size * 1.4, COLOURS.hot, 0.3)
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * Math.PI * 2, up = 0.3 + Math.random()
          const sp = (0.6 + Math.random()) * size * 1.6
          glowPool.emit({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * sp, vy: up * sp, vz: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, size0: 0.28 * size, size1: 0.06, r: 1, g: 0.5 + Math.random() * 0.3, b: 0.12, drag: 0.35 })
        }
        for (let i = 0; i < 4; i++) puff(at.x, at.y + i * 0.08, at.z, COLOURS.smoke, 0.5 * size, 1.4, 0.7)
        break
      }
      case 'ring': this.ringAt(spec.at, spec.radius, spec.colour, spec.dur, now); break
      case 'dust': {
        if (this.lite) { this.ringAt(spec.at, 0.5, 0xb9a98a, 360, now); break }
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2
          smokePool.emit({ x: spec.at.x + Math.cos(a) * 0.15, y: spec.at.y, z: spec.at.z + Math.sin(a) * 0.15, vx: Math.cos(a) * 0.5, vy: 0.12, vz: Math.sin(a) * 0.5, life: 0.9, size0: 0.14, size1: 0.4, r: 0.62, g: 0.56, b: 0.45, alpha: 0.5, drag: 0.5 })
        }
        this.ringAt(spec.at, 0.55, 0xb9a98a, 360, now)
        break
      }
      case 'smoke':
        if (this.lite) break
        for (let i = 0; i < 3; i++) puff(spec.at.x, spec.at.y + i * 0.12, spec.at.z, COLOURS.smoke, 0.4, 1.4, 0.6)
        break
    }
  }

  private ringAt(at: V3, radius: number, hex: number, dur: number, now: number): void {
    const r = this.rings.find((x) => !x.live)
    if (!r) return
    r.live = true; r.t0 = now; r.dur = Math.max(80, dur); r.radius = radius
    ;(r.mesh.material as MeshBasicMaterial).color.setHex(hex)
    r.mesh.position.set(at.x, at.y + 0.03, at.z)
    r.mesh.visible = true
  }

  /** Advance by dt seconds at clock `now` (ms). */
  update(now: number, dt: number): void {
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= now)
      if (due.length) {
        this.pending = this.pending.filter((p) => p.at > now)
        for (const p of due) this.start(p.spec, now)
      }
    }
    for (const b of this.beams) {
      if (!b.live) continue
      const t = (now - b.t0) / b.dur
      if (t >= 1) { b.live = false; b.mesh.visible = false; b.core.visible = false; continue }
      const len = Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y, b.to.z - b.from.z) || 0.01
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85
      for (const [m, w] of [[b.mesh, b.width * 2.2], [b.core, b.width * 0.8]] as const) {
        m.position.set((b.from.x + b.to.x) / 2, (b.from.y + b.to.y) / 2, (b.from.z + b.to.z) / 2)
        m.lookAt(this.tmp.set(b.to.x, b.to.y, b.to.z))
        m.scale.set(w * fade, w * fade, len)
        ;(m.material as MeshBasicMaterial).opacity = 0.35 + 0.65 * fade
      }
    }
    for (const s of this.shots) {
      if (!s.live) continue
      const t = (now - s.t0) / s.dur
      if (t < 0) continue
      if (t >= 1) { s.live = false; s.mesh.visible = false; continue }
      const x = s.from.x + (s.to.x - s.from.x) * t
      let y = s.from.y + (s.to.y - s.from.y) * t
      const z = s.from.z + (s.to.z - s.from.z) * t
      if (s.kind === 'missile') y += Math.sin(t * Math.PI) * s.arc
      s.mesh.position.set(x, y, z)
      s.mesh.visible = true
      if (s.kind !== 'bolt') s.mesh.lookAt(this.tmp.set(s.to.x, s.to.y, s.to.z))
      if (!this.lite) {
        s.trailAt -= dt
        if (s.trailAt <= 0) {
          s.trailAt = 0.02
          if (s.kind === 'bolt') { mote(x, y, z, COLOURS.arcaneCore, 0.09, 0.28); if (Math.random() < 0.5) sparks(x, y, z, 1, COLOURS.electric, 0.8) }
          else if (s.kind === 'missile') puff(x, y, z, COLOURS.smoke, 0.1, 0.6, 0.1)
        }
      }
    }
    for (const r of this.rings) {
      if (!r.live) continue
      const t = (now - r.t0) / r.dur
      if (t >= 1) { r.live = false; r.mesh.visible = false; continue }
      const k = r.radius * (0.25 + 0.75 * (1 - Math.pow(1 - t, 3)))
      r.mesh.scale.set(k, k, 1)
      ;(r.mesh.material as MeshBasicMaterial).opacity = 0.9 * (1 - t)
    }
    if (this.lite) { glowPool.clear(); smokePool.clear() } else { glowPool.update(dt); smokePool.update(dt) }
  }

  clear(): void {
    this.pending = []
    for (const b of this.beams) { b.live = false; b.mesh.visible = false; b.core.visible = false }
    for (const s of this.shots) { s.live = false; s.mesh.visible = false }
    for (const r of this.rings) { r.live = false; r.mesh.visible = false }
    glowPool.clear()
    smokePool.clear()
  }

  dispose(): void {
    this.clear()
    this.group.removeFromParent()
  }
}
