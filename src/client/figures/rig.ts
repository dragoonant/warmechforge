// The 'Mech rig (30-figures section 3): one node contract for the procedural kit and the GLBs, plus the pure-three
// functions that pose it and apply state-driven visuals. No React here (tests build rigs headless).
//
// Frame: origin at the hex top, y up, FRONT +z, figure's LEFT +x (as the GLBs). Nodes (GLB names): `base` (flat),
// `lower` (legs), `upper` (pivot at the hip, rotates about Y for torso twist) with children `armL` / `armR` (origin at the
// shoulder). The procedural kit adds optional head / torsoC / torsoL / torsoR / legL / legR nodes.
import {
  AdditiveBlending, Box3, BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, Shape,
  ShapeGeometry, TorusGeometry, Vector3, type BufferGeometry, type Material, type Object3D,
} from 'three'
import { BASE_RADIUS_BY_CLASS, BASE_THICKNESS, HEIGHT_BY_CLASS, SLUMP_ANGLE, TIP_ANGLE, WRECK_TILT, type WeightClass } from './figureConstants'
import { twistYaw } from './facing'
import { isBaseMesh, ownMaterial, variantMaterial } from './glbPaint'
import { darken, type ResolvedPaint } from './paintStore'
import type { FigureStyle } from './profile'
import { NODE_FALLBACK, type NodeName, type UnitVisual } from './visuals'

export type RigKind = 'procedural' | 'glb'
interface Tint { mat: MeshStandardMaterial; base: Color }

export interface MechRig {
  kind: RigKind
  root: Group
  base: Object3D
  /** Tips onto its side when prone; holds lower and upper. */
  body: Group
  lower: Object3D
  upper: Object3D
  /** Every named node that exists (always lower, upper; armL / armR for both kinds; the rest procedural only). */
  nodes: Partial<Record<NodeName, Object3D>>
  radius: number
  /** Height above the base disc. */
  height: number
  /** Half the body's side-to-side width (lifts a tipped figure clear of the table). */
  halfWidth: number
  capabilities: { twist: boolean; armLoss: boolean }
  tints: Partial<Record<NodeName, Tint[]>>
  /** Lit canopy materials (lights out on shutdown). */
  canopy: MeshStandardMaterial[]
  /** Emissive-capable materials of the whole figure (heat glow). */
  glowMats: MeshStandardMaterial[]
  jets: Group
  arrow: Mesh
  rim: Mesh
  /** Free everything this rig owns (cloned materials, the rim, arrow and jets); shared geometry stays. */
  dispose(): void
}

// ---------- shared geometry (one per type, scaled per instance) ----------
export const GEO = {
  box: new BoxGeometry(1, 1, 1),
  cyl: new CylinderGeometry(0.5, 0.5, 1, 14),
  cone: new ConeGeometry(0.5, 1, 10),
  rim: new RingGeometry(0.965, 1, 40).rotateX(-Math.PI / 2),
  disc: new CylinderGeometry(1, 1, 1, 28),
  torus: new TorusGeometry(1, 0.03, 6, 40).rotateX(Math.PI / 2),
} as const
const ARROW_GEO = ((): BufferGeometry => {
  const s = new Shape()
  s.moveTo(0, 0.12); s.lineTo(-0.1, -0.06); s.lineTo(0, -0.02); s.lineTo(0.1, -0.06); s.closePath()
  return new ShapeGeometry(s).rotateX(-Math.PI / 2)
})()

const metalColour = '#8a8d93'
const darkColour = '#2a2c31'
const CANOPY_LIT = new Color('#7fd3ff')

function stdMat(color: string, rough = 0.6, metal = 0.25): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: rough, metalness: metal })
}

class Builder {
  readonly tints: Partial<Record<NodeName, Tint[]>> = {}
  readonly mats: Material[] = []
  readonly glow: MeshStandardMaterial[] = []
  readonly canopy: MeshStandardMaterial[] = []
  readonly roles: Record<'primary' | 'secondary' | 'metal' | 'dark', MeshStandardMaterial>
  constructor(paint: ResolvedPaint, readonly H: number) {
    this.roles = { primary: stdMat(paint.primary), secondary: stdMat(paint.secondary), metal: stdMat(metalColour, 0.45, 0.6), dark: stdMat(darkColour, 0.8, 0.2) }
    for (const m of Object.values(this.roles)) { this.mats.push(m); this.glow.push(m) }
  }
  /** Register the role materials against a node so per-location darkening can reach them. A node gets its OWN clones. */
  materialsFor(node: NodeName): Record<'primary' | 'secondary' | 'metal' | 'dark', MeshStandardMaterial> {
    const out = {} as Record<'primary' | 'secondary' | 'metal' | 'dark', MeshStandardMaterial>
    for (const k of ['primary', 'secondary', 'metal', 'dark'] as const) {
      const m = this.roles[k].clone()
      this.mats.push(m); this.glow.push(m)
      ;(this.tints[node] ??= []).push({ mat: m, base: m.color.clone() })
      out[k] = m
    }
    return out
  }
  part(parent: Object3D, geo: BufferGeometry, mat: Material, p: [number, number, number], s: [number, number, number], rot?: [number, number, number]): Mesh {
    const m = new Mesh(geo, mat)
    m.position.set(p[0] * this.H, p[1] * this.H, p[2] * this.H)
    m.scale.set(s[0] * this.H, s[1] * this.H, s[2] * this.H)
    if (rot) m.rotation.set(rot[0], rot[1], rot[2])
    m.castShadow = true
    parent.add(m)
    return m
  }
}

function makeNode(name: string, parent: Object3D, y = 0, x = 0, z = 0): Group {
  const g = new Group()
  g.name = name
  g.position.set(x, y, z)
  parent.add(g)
  return g
}

/** Common tail of both builders: rim ring, facing arrow, jets, dispose. */
function finish(rig: Omit<MechRig, 'jets' | 'arrow' | 'rim' | 'dispose'>, paint: ResolvedPaint, ownMats: Material[], extraDispose: (() => void)[] = []): MechRig {
  const rimMat = new MeshBasicMaterial({ color: paint.primary })
  const rim = new Mesh(GEO.rim, rimMat)
  rim.name = 'rim'
  rim.scale.set(rig.radius, 1, rig.radius)
  rim.position.y = BASE_THICKNESS + 0.002
  rig.root.add(rim)
  const arrowMat = new MeshBasicMaterial({ color: paint.secondary })
  const arrow = new Mesh(ARROW_GEO, arrowMat)
  arrow.name = 'facingArrow'
  arrow.position.set(0, BASE_THICKNESS + 0.004, rig.radius + 0.07)
  arrow.scale.setScalar(1.4)
  rig.root.add(arrow)
  const jets = new Group()
  jets.name = 'jets'
  jets.visible = false
  const jetMat = new MeshBasicMaterial({ color: '#ffa640', transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false })
  for (const sx of [-1, 1]) {
    const c = new Mesh(GEO.cone, jetMat)
    c.position.set(sx * 0.12 * rig.height, BASE_THICKNESS + 0.04, 0)
    c.scale.set(0.09, 0.3, 0.09)
    c.rotation.x = Math.PI // point down
    c.name = 'jet'
    jets.add(c)
  }
  rig.root.add(jets)
  const full: MechRig = {
    ...rig, jets, arrow, rim,
    dispose() {
      for (const m of ownMats) m.dispose()
      rimMat.dispose(); arrowMat.dispose(); jetMat.dispose()
      for (const f of extraDispose) f()
      rig.root.removeFromParent()
    },
  }
  return full
}

// =====================================================================================================
// Procedural kit
// =====================================================================================================
/** Build the procedural 'Mech for a weight class, style and two-tone paint. <= ~600 triangles; geometry shared. */
export function buildProceduralRig(cls: WeightClass, style: FigureStyle, paint: ResolvedPaint): MechRig {
  const H = HEIGHT_BY_CLASS[cls]
  const radius = BASE_RADIUS_BY_CLASS[cls]
  const b = new Builder(paint, H)
  const root = new Group()
  root.name = 'root'
  const baseMat = stdMat('#0b0b0d', 0.6, 0)
  b.mats.push(baseMat)
  const base = new Mesh(GEO.disc, baseMat)
  base.name = 'base'
  base.scale.set(radius, BASE_THICKNESS, radius)
  base.position.y = BASE_THICKNESS / 2
  base.receiveShadow = true
  root.add(base)
  const body = makeNode('body', root, BASE_THICKNESS)
  const nodes: MechRig['nodes'] = {}

  // ----- lower: legs and pelvis -----
  const lower = makeNode('lower', body)
  const rev = style.legs === 'reverse'
  const pelvisY = rev ? 0.48 : 0.43
  const lm = b.materialsFor('lower')
  b.part(lower, GEO.box, lm.secondary, [0, pelvisY, 0], [0.3, 0.08, 0.2])
  for (const [name, sx] of [['legL', 1], ['legR', -1]] as const) {
    const lg = makeNode(name, lower, pelvisY * H, sx * 0.12 * H, 0)
    const m = b.materialsFor(name)
    // geometry below is relative to the hip joint (y 0 at the pelvis)
    const sh = (y: number) => y - pelvisY
    const thighRot: [number, number, number] | undefined = rev ? [0.44, 0, 0] : undefined // 25 degrees back
    const shinRot: [number, number, number] | undefined = rev ? [-0.61, 0, 0] : undefined // 35 degrees forward
    const mk = (geo: BufferGeometry, mat: Material, p: [number, number, number], s: [number, number, number], rot?: [number, number, number]) => {
      const mesh = new Mesh(geo, mat)
      mesh.position.set(p[0] * H, p[1] * H, p[2] * H); mesh.scale.set(s[0] * H, s[1] * H, s[2] * H)
      if (rot) mesh.rotation.set(...rot)
      mesh.castShadow = true
      lg.add(mesh)
    }
    mk(GEO.box, m.primary, [0, sh(0.33), 0], [0.14, 0.2, 0.16], thighRot)
    mk(GEO.box, m.primary, [0, sh(0.15), rev ? 0.04 : 0], [0.16, 0.2, 0.18], shinRot)
    mk(GEO.box, m.secondary, [0, sh(0.025), rev ? 0.05 : 0.03], [0.18, 0.05, 0.26])
    nodes[name] = lg
  }

  // ----- upper: torso, head, arms -----
  const hipY = pelvisY + 0.03
  const upper = makeNode('upper', body, hipY * H)
  const fwd = rev ? 0.06 : 0
  const um = b.materialsFor('torsoC')
  const rel = (y: number) => y - hipY
  const tc = makeNode('torsoC', upper)
  b.part(tc, GEO.box, um.primary, [0, rel(0.62), fwd], [0.26, 0.32, 0.24])
  nodes.torsoC = tc
  for (const [name, sx] of [['torsoL', 1], ['torsoR', -1]] as const) {
    const g = makeNode(name, upper)
    const m = b.materialsFor(name)
    b.part(g, GEO.box, m.primary, [sx * 0.2, rel(0.63), fwd], [0.14, 0.28, 0.22])
    if (style.shoulderPods) b.part(g, GEO.box, m.secondary, [sx * 0.22, rel(0.8), fwd], [0.14, 0.1, 0.16])
    nodes[name] = g
  }
  const head = makeNode('head', upper)
  const hm = b.materialsFor('head')
  const cockpitNose = style.cockpit === 'nose'
  const hy = cockpitNose ? 0.7 : 0.88, hz = cockpitNose ? 0.17 : 0.02
  b.part(head, GEO.box, hm.secondary, [0, rel(hy), hz], [0.16, 0.2, 0.18])
  const canopyMat = new MeshStandardMaterial({ color: '#10222b', roughness: 0.2, metalness: 0.4, emissive: CANOPY_LIT, emissiveIntensity: 0.9 })
  b.mats.push(canopyMat)
  b.canopy.push(canopyMat)
  b.part(head, GEO.box, canopyMat, [0, rel(hy + 0.03), hz + 0.095], [0.12, 0.04, 0.02])
  nodes.head = head
  for (const [name, sx] of [['armL', 1], ['armR', -1]] as const) {
    const a = makeNode(name, upper, rel(0.74) * H, sx * 0.31 * H, fwd * H)
    const m = b.materialsFor(name)
    const mk = (geo: BufferGeometry, mat: Material, p: [number, number, number], s: [number, number, number]) => {
      const mesh = new Mesh(geo, mat)
      mesh.position.set(p[0] * H, p[1] * H, p[2] * H); mesh.scale.set(s[0] * H, s[1] * H, s[2] * H); mesh.castShadow = true
      a.add(mesh)
    }
    mk(GEO.box, m.primary, [0, -0.1, 0], [0.11, 0.2, 0.12])
    if (style.arms === 'gunpod') {
      const pod = new Mesh(GEO.cyl, m.metal)
      pod.rotation.x = Math.PI / 2
      pod.position.set(0, -0.3 * H, 0.12 * H)
      pod.scale.set(0.13 * H, 0.34 * H, 0.13 * H)
      pod.castShadow = true
      a.add(pod)
    } else {
      mk(GEO.box, m.secondary, [0, -0.31, 0.04], [0.12, 0.22, 0.18])
    }
    nodes[name] = a
  }
  nodes.lower = lower
  nodes.upper = upper
  const hw = new Box3().setFromObject(body)
  const halfWidth = Math.max(0.2, (hw.max.x - hw.min.x) / 2)
  const tints = b.tints
  const rig = finish({
    kind: 'procedural', root, base, body, lower, upper, nodes, radius, height: H, halfWidth,
    capabilities: { twist: true, armLoss: true }, tints, canopy: b.canopy, glowMats: b.glow,
  }, paint, b.mats)
  return rig
}

// =====================================================================================================
// GLB rig
// =====================================================================================================
/** Build a rig from a private clone of a figure GLB (nodes base, lower, upper, armL, armR). Materials are painted, then
 *  cloned per rig and node so heat glow and damage tint are per figure. Missing nodes degrade (no twist / no arm loss). */
export function buildGlbRig(scene: Object3D, paint: ResolvedPaint, grey = false): MechRig {
  const root = new Group()
  root.name = 'root'
  const find = (n: string): Object3D | null => scene.getObjectByName(n) ?? null
  const baseN = find('base'), lowerN = find('lower'), upperN = find('upper'), armL = find('armL'), armR = find('armR')
  const body = new Group()
  body.name = 'body'
  root.add(body)
  scene.updateMatrixWorld(true)
  let base: Object3D
  if (baseN) { root.attach(baseN); base = baseN } else { base = new Group(); base.name = 'base'; root.add(base) }
  // arms stay children of upper (they follow the twist); lower and upper hang off the body group
  let lower: Object3D, upper: Object3D
  if (lowerN) { body.attach(lowerN); lower = lowerN } else { lower = new Group(); lower.name = 'lower'; body.add(lower) }
  if (upperN) { body.attach(upperN); upper = upperN } else { upper = new Group(); upper.name = 'upper'; body.add(upper) }
  if (!lowerN && !upperN) { while (scene.children.length) { const c = scene.children[0]!; if (c === baseN) { scene.remove(c); continue } lower.attach(c) } }

  const tints: MechRig['tints'] = {}
  const glow: MeshStandardMaterial[] = []
  const owned: Material[] = []
  const ownerOf = (o: Object3D): NodeName => {
    let p: Object3D | null = o
    while (p && p !== body) {
      if (p === armL) return 'armL'
      if (p === armR) return 'armR'
      if (p === upper) return 'upper'
      if (p === lower) return 'lower'
      p = p.parent
    }
    return 'lower'
  }
  body.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || isBaseMesh(mesh)) return
    const node = ownerOf(mesh)
    const swap = (m: Material): Material => {
      const c = ownMaterial(variantMaterial(m, paint, grey))
      owned.push(c)
      if ((c as MeshStandardMaterial).isMeshStandardMaterial) { const sm = c as MeshStandardMaterial; glow.push(sm); (tints[node] ??= []).push({ mat: sm, base: sm.color.clone() }) }
      return c
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
  const bb = new Box3().setFromObject(body)
  const bs = new Box3().setFromObject(base)
  const radius = Math.max(0.2, (bs.max.x - bs.min.x) / 2)
  const nodes: MechRig['nodes'] = { lower, upper }
  if (armL) nodes.armL = armL
  if (armR) nodes.armR = armR
  return finish({
    kind: 'glb', root, base, body, lower, upper, nodes, radius, height: Math.max(0.3, bb.max.y - BASE_THICKNESS),
    halfWidth: Math.max(0.2, (bb.max.x - bb.min.x) / 2), capabilities: { twist: !!upperN, armLoss: !!armL && !!armR },
    tints, canopy: [], glowMats: glow,
  }, paint, owned)
}

// =====================================================================================================
// Posing and status
// =====================================================================================================
export interface RigPose {
  /** Torso twist in hexsides, continuous -1..1 (+1 clockwise). */
  twist: number
  /** 0 = upright, 1 = tipped onto its side. */
  tip: number
  /** 0..1 shutdown slump / wreck tilt blend. */
  slump: number
  wreck: number
  /** Vertical bob added to the body (world units). */
  bob: number
  /** Leg swing angle (radians) for the procedural legs. */
  swing: number
  /** Jet flames on. */
  jets: number
  /** Arm flip 0..1 (arms turn to the rear arc). */
  flip: number
}
export const REST_POSE: RigPose = { twist: 0, tip: 0, slump: 0, wreck: 0, bob: 0, swing: 0, jets: 0, flip: 0 }

/** Pose the rig's nodes (cheap, every frame). The base stays flat; only the body tips. */
export function setPose(rig: MechRig, p: RigPose): void {
  const tip = p.tip * TIP_ANGLE
  const lift = p.tip > 0 ? Math.max(0, rig.halfWidth * Math.sin(tip)) : 0
  rig.body.rotation.z = tip
  rig.body.position.y = lift + p.bob + (rig.kind === 'procedural' ? BASE_THICKNESS : 0)
  rig.upper.rotation.y = rig.capabilities.twist ? twistYaw(p.twist) : 0
  rig.upper.rotation.x = p.slump * SLUMP_ANGLE + p.wreck * (WRECK_TILT - SLUMP_ANGLE)
  if (rig.nodes.armL) rig.nodes.armL.rotation.y = p.flip * Math.PI
  if (rig.nodes.armR) rig.nodes.armR.rotation.y = -p.flip * Math.PI
  const lL = rig.nodes.legL, lR = rig.nodes.legR
  if (lL && lR) { lL.rotation.x = p.swing; lR.rotation.x = -p.swing }
  rig.jets.visible = p.jets > 0.01
  if (rig.jets.visible) {
    const k = 0.8 + 0.4 * Math.sin(performance.now() / 45)
    rig.jets.children.forEach((c, i) => c.scale.set(0.09, 0.28 * p.jets * (k + i * 0.07), 0.09))
  }
}

function nodeFor(rig: MechRig, n: NodeName): NodeName { return rig.nodes[n] ? n : NODE_FALLBACK[n] }

/** State-driven visibility and darkening (30-figures section 6): hidden stumps, exposed tint, charcoal legs, wreck. */
export function applyStatus(rig: MechRig, v: UnitVisual): void {
  const n = rig.nodes
  const hide = (node: Object3D | undefined, h: boolean) => { if (node) node.visible = !h }
  hide(n.armL, v.hideArmL && rig.capabilities.armLoss)
  hide(n.armR, v.hideArmR && rig.capabilities.armLoss)
  hide(n.torsoL, v.hideTorsoL)
  hide(n.torsoR, v.hideTorsoR)
  hide(n.head, v.hideHead)
  // darkness per node: 1 = untouched
  const dark: Partial<Record<NodeName, number>> = {}
  const take = (node: NodeName, k: number) => { const t = nodeFor(rig, node); dark[t] = Math.min(dark[t] ?? 1, k) }
  const nodeOf: Record<string, NodeName> = { HD: 'head', CT: 'torsoC', LT: 'torsoL', RT: 'torsoR', LA: 'armL', RA: 'armR', LL: 'legL', RL: 'legR' }
  for (const l of v.exposedLocs) take(nodeOf[l]!, 0.72)
  for (const l of v.destroyedLocs) take(nodeOf[l]!, 0.3)
  if (v.legL === 'destroyed') take('legL', 0.25)
  if (v.legR === 'destroyed') take('legR', 0.25)
  const all = v.destroyed ? 0.4 : 1
  for (const [name, list] of Object.entries(rig.tints) as [NodeName, Tint[]][]) {
    const k = (dark[name] ?? 1) * all
    for (const t of list) t.mat.color.copy(t.base).multiplyScalar(k)
  }
  const lit = v.lightsOut ? 0 : 0.9
  for (const c of rig.canopy) c.emissiveIntensity = lit
}

const ORANGE = new Color('#ff7a1a')
const RED = new Color('#ff2a10')
const NONE = new Color(0, 0, 0)
/** Heat glow on every material (orange 10-19, red 20+ pulsing with a 1.2 s period). `timeS` is wall seconds. */
export function setGlow(rig: MechRig, v: UnitVisual, timeS: number): void {
  const g = v.glow
  const col = g.colour === 'orange' ? ORANGE : g.colour === 'red' ? RED : NONE
  const k = g.pulse ? g.intensity * (0.8 + 0.2 * Math.sin((timeS / 1.2) * Math.PI * 2)) : g.intensity
  for (const m of rig.glowMats) { m.emissive.copy(col); m.emissiveIntensity = k }
}

/** Resolved hex colour of a rig's primary paint (for rings and chips). */
export const rimColour = (paint: ResolvedPaint): string => darken(paint.primary, 0)

/** Total triangle count of a rig (budget test: <= 600 procedural). */
export function triangleCount(rig: MechRig): number {
  let n = 0
  rig.root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const idx = m.geometry.index
    n += idx ? idx.count / 3 : (m.geometry.attributes.position?.count ?? 0) / 3
  })
  return n
}

export const tmpVec = new Vector3()
export { variantMaterial }
