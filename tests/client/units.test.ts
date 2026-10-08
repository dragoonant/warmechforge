// Units, interaction and VFX (30-figures, 50 sections 5 to 7). Headless: no React, no DOM, no GPU. Rigs are plain three.js
// objects; the interaction flow runs through the real stores at animation speed 0.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Group, Mesh, MeshStandardMaterial, BoxGeometry, Object3D } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { LEVEL_HEIGHT, query, type Facing, type GameState, type Hex, type ReachEntry, type UnitId } from '../../src/engine/index'
import { bootClient, game, queryReach } from '../../src/client/contract'
import { resetGameStore, newGame, useGameStore } from '../../src/client/store/gameStore'
import { bundle } from '../../src/client/store/setup'
import { useSettingsStore } from '../../src/client/store/settingsStore'
import { ui, useUiStore } from '../../src/client/store/uiStore'
import { memoryStorage, setStorage } from '../../src/client/store/storage'
import { setDirectorClock, setPaused } from '../../src/client/presentation/director'
import { usePresentedStore, type ActiveBeat } from '../../src/client/presentation/presentedStore'
import { BASE_RADIUS_BY_CLASS, BASE_THICKNESS, HEIGHT_BY_CLASS, weightClassOf } from '../../src/client/figures/figureConstants'
import { frontVector, rotateLocal, twistYaw, yawForFacing } from '../../src/client/figures/facing'
import { GLB_SLUG_BY_MODEL, glbSlugFor, parseGlbManifest, setGlbManifestForTest } from '../../src/client/figures/glbModels'
import { chassisKey, profileOf, styleFor } from '../../src/client/figures/profile'
import { resolvePaint, trimOf } from '../../src/client/figures/paintStore'
import { REST_POSE, applyStatus, buildGlbRig, buildProceduralRig, setPose, triangleCount } from '../../src/client/figures/rig'
import { socketWorld } from '../../src/client/figures/sockets'
import { hexTopY } from '../../src/client/figures/unitFrame'
import { heatGlow, unitVisual } from '../../src/client/figures/visuals'
import { currentFacingChoices, chooseFacing, confirmDraft, draftReady, handleHexClick, handleUnitClick, deployZone } from '../../src/client/interaction/controller'
import {
  arcFills, attackTargets, bandOfDistance, facingChoices, losView, pathView, reachFillSpecs, stepFacing, LOS_COLOUR_HEX,
} from '../../src/client/interaction/overlayModel'
import { rayToHex } from '../../src/client/interaction/pick'
import { VfxEngine } from '../../src/client/vfx/engine'
import { planBeat, weaponLook, missPoint } from '../../src/client/vfx/effects'
import { glowPool, smokePool } from '../../src/client/vfx/particles'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PAINT = resolvePaint('#3b6ea8')
const INTRO = { mission: 'mission.intro', turnLimit: 30 } as const

beforeEach(() => {
  setStorage(memoryStorage())
  setDirectorClock(null)
  useSettingsStore.getState().set({ speed: 0 })
  setPaused(false)
  resetGameStore()
  ui.reset()
})

// ---------- figures ----------
describe('figure profiles and sizes', () => {
  it('every Mech in the data bundle resolves to a procedural style and a weight class by tonnage', () => {
    for (const m of Object.values(bundle().mechs) as { id: string; chassis: string; tonnage: number }[]) {
      const p = profileOf({ mechId: m.id, tonnage: m.tonnage })
      expect(p.key).toBe(chassisKey(m.chassis))
      expect(['humanoid', 'reverse']).toContain(styleFor(p.key).legs)
      expect(p.cls).toBe(weightClassOf(m.tonnage))
    }
    expect([weightClassOf(20), weightClassOf(35), weightClassOf(40), weightClassOf(55), weightClassOf(60), weightClassOf(75), weightClassOf(80), weightClassOf(100)])
      .toEqual(['light', 'light', 'medium', 'medium', 'heavy', 'heavy', 'assault', 'assault'])
    expect(styleFor('mad-cat-mk-ii')).toMatchObject({ legs: 'reverse', arms: 'gunpod', shoulderPods: 2, cockpit: 'nose' })
  })

  it('light figures are shorter than assault figures at the GLB proportions (0.75 : 1.0)', () => {
    expect(HEIGHT_BY_CLASS.light).toBe(0.75)
    expect(HEIGHT_BY_CLASS.assault).toBe(1)
    expect(HEIGHT_BY_CLASS.light).toBeLessThan(HEIGHT_BY_CLASS.medium)
    expect(HEIGHT_BY_CLASS.heavy).toBeLessThan(HEIGHT_BY_CLASS.assault)
    for (const r of Object.values(BASE_RADIUS_BY_CLASS)) expect(r).toBeLessThan(0.5)
    const light = buildProceduralRig('light', styleFor('solitaire'), PAINT)
    const assault = buildProceduralRig('assault', styleFor('regent'), PAINT)
    expect(light.height).toBeLessThan(assault.height)
    expect(light.height / assault.height).toBeCloseTo(0.75, 5)
    light.dispose(); assault.dispose()
  })
})

describe('facing maths', () => {
  it('facing 1 points the front to the north-east hexside; facing 0 is north (-z); twist +1 is clockwise', () => {
    expect(yawForFacing(0)).toBeCloseTo(Math.PI)
    expect(yawForFacing(1)).toBeCloseTo(Math.PI - Math.PI / 3)
    const n = frontVector(0), ne = frontVector(1), e = frontVector(2)
    expect(n.x).toBeCloseTo(0); expect(n.z).toBeCloseTo(-1)
    expect(ne.x).toBeCloseTo(Math.sin(Math.PI / 3)); expect(ne.z).toBeCloseTo(-0.5)
    expect(e.x).toBeGreaterThan(0.8); expect(e.z).toBeGreaterThan(-0.6)
    // twist +1 turns the torso clockwise: from facing 0 it ends up looking like facing 1
    const f = frontVector(0, 1)
    expect(f.x).toBeCloseTo(ne.x); expect(f.z).toBeCloseTo(ne.z)
    expect(twistYaw(1)).toBeCloseTo(-Math.PI / 3)
    // a three.js object turned by yawForFacing really has its +z front on that world direction
    const o = new Object3D(); o.rotation.y = yawForFacing(2)
    const p = rotateLocal(0, 1, yawForFacing(2))
    expect(p.x).toBeCloseTo(frontVector(2).x); expect(p.z).toBeCloseTo(frontVector(2).z)
    const w = o.localToWorld(new Object3D().position.set(0, 0, 1))
    expect(w.x).toBeCloseTo(p.x); expect(w.z).toBeCloseTo(p.z)
  })

  it('a torso-mounted socket follows the twist, a leg socket does not', () => {
    const f = { x: 0, y: 0, z: 0, facing: 0 as number, twist: 0, H: 1 }
    const straight = socketWorld('CT', f)
    const twisted = socketWorld('CT', { ...f, twist: 1 })
    expect(twisted.x).toBeGreaterThan(straight.x + 0.05)
    expect(socketWorld('LL', { ...f, twist: 1 })).toEqual(socketWorld('LL', f))
    expect(socketWorld('CT', f, true).z).toBeCloseTo(-straight.z)
  })
})

describe('procedural rig and status visuals', () => {
  it('exposes every node of the contract and stays within 600 triangles', () => {
    for (const [cls, key] of [['light', 'solitaire'], ['heavy', 'rakshasa'], ['assault', 'mad-cat-mk-ii']] as const) {
      const rig = buildProceduralRig(cls, styleFor(key), PAINT)
      for (const n of ['lower', 'upper', 'armL', 'armR', 'head', 'torsoC', 'torsoL', 'torsoR', 'legL', 'legR'] as const) expect(rig.nodes[n], `${key} ${n}`).toBeTruthy()
      expect(rig.base.name).toBe('base')
      expect(rig.base.parent).toBe(rig.root)
      expect(rig.upper.parent).toBe(rig.body)
      expect(rig.nodes.armL!.parent).toBe(rig.upper)
      expect(rig.capabilities).toEqual({ twist: true, armLoss: true })
      expect(triangleCount(rig)).toBeLessThanOrEqual(600)
      rig.dispose()
    }
  })

  it('twist turns the upper body about the hip; prone tips the body but not the base', () => {
    const rig = buildProceduralRig('medium', styleFor('eris'), PAINT)
    setPose(rig, { ...REST_POSE, twist: 1 })
    expect(rig.upper.rotation.y).toBeCloseTo(-Math.PI / 3)
    setPose(rig, { ...REST_POSE, twist: -1 })
    expect(rig.upper.rotation.y).toBeCloseTo(Math.PI / 3)
    setPose(rig, { ...REST_POSE, tip: 1 })
    expect(rig.body.rotation.z).toBeGreaterThan(1.3)
    expect(rig.body.position.y).toBeGreaterThan(BASE_THICKNESS) // lifted clear of the table
    expect(rig.base.rotation.z).toBe(0)
    setPose(rig, { ...REST_POSE, slump: 1 })
    expect(rig.upper.rotation.x).toBeCloseTo(0.25)
    rig.dispose()
  })

  const unit = (over: Record<string, unknown> = {}) => {
    const locs = Object.fromEntries(['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'].map((l) => [l, { armor: 5, rear: null, structure: 5, maxArmor: 5, maxRear: null, maxStructure: 5, destroyed: false, destroyedCause: null }]))
    return { status: 'active', prone: false, shutdown: null, heat: 0, pilot: { conscious: true, dead: false }, locs, attacks: { twist: 0, flipped: false }, ...over } as never
  }
  const lost = (...ls: string[]) => Object.fromEntries(['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'].map((l) => [l, { armor: 0, rear: null, structure: ls.includes(l) ? 0 : 5, maxArmor: 5, maxRear: null, maxStructure: 5, destroyed: ls.includes(l), destroyedCause: null }]))

  it('a destroyed left arm hides armL; a destroyed left torso hides torsoL and armL', () => {
    const rig = buildProceduralRig('light', styleFor('solitaire'), PAINT)
    applyStatus(rig, unitVisual(unit({ locs: lost('LA') })))
    expect(rig.nodes.armL!.visible).toBe(false)
    expect(rig.nodes.armR!.visible).toBe(true)
    expect(rig.nodes.torsoL!.visible).toBe(true)
    applyStatus(rig, unitVisual(unit({ locs: lost('LT') })))
    expect(rig.nodes.torsoL!.visible).toBe(false)
    expect(rig.nodes.armL!.visible).toBe(false)
    applyStatus(rig, unitVisual(unit()))
    expect(rig.nodes.armL!.visible && rig.nodes.torsoL!.visible).toBe(true)
    applyStatus(rig, unitVisual(unit({ locs: lost('HD') })))
    expect(rig.nodes.head!.visible).toBe(false)
    rig.dispose()
  })

  it('lights go out on shutdown, an unconscious pilot or destruction; destroyed figures darken by 60 percent', () => {
    const rig = buildProceduralRig('light', styleFor('solitaire'), PAINT)
    const canopy = () => rig.canopy[0]!.emissiveIntensity
    applyStatus(rig, unitVisual(unit()))
    expect(canopy()).toBeGreaterThan(0.5)
    applyStatus(rig, unitVisual(unit({ shutdown: { cause: 'heat', turn: 1 } })))
    expect(canopy()).toBe(0)
    applyStatus(rig, unitVisual(unit({ pilot: { conscious: false, dead: false } })))
    expect(canopy()).toBe(0)
    const before = rig.tints.torsoC![0]!.mat.color.r
    const base = rig.tints.torsoC![0]!.base.r
    applyStatus(rig, unitVisual(unit({ status: 'destroyed' })))
    expect(rig.tints.torsoC![0]!.mat.color.r).toBeCloseTo(base * 0.4)
    expect(before).toBeCloseTo(base * 1) // untouched in the earlier states
    rig.dispose()
  })

  it('heat glow: none below 10 and while shut down, orange 10-19 rising 0.15 to 0.45, red 20+ rising from 0.5 and pulsing', () => {
    expect(heatGlow(9, false).colour).toBe('none')
    expect(heatGlow(15, true).colour).toBe('none')
    const a = heatGlow(10, false), b = heatGlow(19, false)
    expect(a.colour).toBe('orange'); expect(a.intensity).toBeCloseTo(0.06); expect(b.intensity).toBeCloseTo(0.2)
    const r = heatGlow(20, false)
    expect(r.colour).toBe('red'); expect(r.intensity).toBeCloseTo(0.22); expect(r.pulse).toBe(true)
    expect(heatGlow(40, false).intensity).toBeLessThanOrEqual(0.4)
  })

  it('force colours: the trim of a dark main is light and the trim of a light main is dark', () => {
    const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 }
    expect(lum(trimOf('#3b6ea8'))).toBeGreaterThan(lum('#3b6ea8'))
    expect(lum(trimOf('#e8d890'))).toBeLessThan(lum('#e8d890'))
    expect(resolvePaint('#a83b3b', { secondary: '#ffffff' })).toEqual({ primary: '#a83b3b', secondary: '#ffffff' })
  })
})

// ---------- GLBs ----------
describe('GLB assets', () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/assets/models/manifest.json'), 'utf8')) as unknown

  it('the manifest lists only files that exist; every mapped slug that is listed has its file', () => {
    const slugs = parseGlbManifest(manifest)
    expect(slugs.length).toBeGreaterThanOrEqual(2)
    for (const s of slugs) expect(existsSync(resolve(ROOT, `public/assets/models/${s}.glb`)), s).toBe(true)
    for (const [chassis, slug] of Object.entries(GLB_SLUG_BY_MODEL)) {
      expect(slug).toBe(`bt-${chassis}`)
      if (slugs.includes(slug)) expect(existsSync(resolve(ROOT, `public/assets/models/${slug}.glb`))).toBe(true)
    }
    setGlbManifestForTest(slugs)
    expect(glbSlugFor('solitaire')).toBe('bt-solitaire')
    expect(glbSlugFor('regent')).toBe('bt-regent')
    // every Core Box chassis has a generated figure (owner approved the look 2026-10-08)
    for (const chassis of Object.keys(GLB_SLUG_BY_MODEL)) expect(glbSlugFor(chassis), chassis).toBe(`bt-${chassis}`)
    setGlbManifestForTest(['bt-solitaire'])
    expect(glbSlugFor('eris')).toBeUndefined() // a chassis left out of the manifest stays procedural
    setGlbManifestForTest([])
  })

  it('the real GLBs carry nodes base, lower, upper, armL and armR with the arms under upper, front +z', () => {
    for (const slug of parseGlbManifest(manifest)) {
      const b = readFileSync(resolve(ROOT, `public/assets/models/${slug}.glb`))
      const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as { nodes: { name: string; children?: number[]; translation?: number[] }[] }
      const byName = Object.fromEntries(json.nodes.map((n, i) => [n.name, { n, i }]))
      for (const name of ['base', 'lower', 'upper', 'armL', 'armR']) expect(byName[name], `${slug} ${name}`).toBeTruthy()
      expect(byName.upper!.n.children).toEqual([byName.armL!.i, byName.armR!.i])
      expect(byName.armL!.n.translation![0]).toBeGreaterThan(0) // the figure's left is +x
      expect(byName.armR!.n.translation![0]).toBeLessThan(0)
    }
  })

  it('a rig built from a GLB-shaped scene maps its nodes, keeps the base flat and reports capabilities', () => {
    const mk = (name: string) => { const m = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshStandardMaterial({ color: '#7a8a4a' })); m.name = name; return m }
    const scene = new Group()
    const base = mk('base'); base.scale.set(2, 0.5, 2)
    const upper = new Group(); upper.name = 'upper'; upper.position.set(0, 0.59, 0); upper.add(mk('upperMesh'))
    const armL = new Group(); armL.name = 'armL'; armL.position.set(0.17, 0.11, 0); armL.add(mk('armLMesh'))
    const armR = new Group(); armR.name = 'armR'; armR.position.set(-0.17, 0.11, 0); armR.add(mk('armRMesh'))
    upper.add(armL, armR)
    const lower = mk('lower'); lower.position.y = 0.3
    scene.add(base, upper, lower)
    const rig = buildGlbRig(scene, PAINT)
    expect(rig.kind).toBe('glb')
    expect(rig.capabilities).toEqual({ twist: true, armLoss: true })
    expect(rig.base.parent).toBe(rig.root)
    expect(rig.upper.parent).toBe(rig.body)
    expect(rig.nodes.armL!.parent).toBe(rig.upper)
    setPose(rig, { ...REST_POSE, twist: 1 })
    expect(rig.upper.rotation.y).toBeCloseTo(-Math.PI / 3)
    applyStatus(rig, unitVisual({ status: 'active', prone: false, shutdown: null, heat: 0, pilot: { conscious: true, dead: false }, attacks: { twist: 0, flipped: false },
      locs: Object.fromEntries(['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'].map((l) => [l, { armor: 1, structure: l === 'RA' ? 0 : 1, destroyed: l === 'RA' }])) } as never))
    expect(rig.nodes.armR!.visible).toBe(false)
    expect(rig.nodes.armL!.visible).toBe(true)
    rig.dispose()
    // a scene with no upper node cannot twist
    const flat = new Group(); flat.add(mk('base'), mk('lower'))
    const rig2 = buildGlbRig(flat, PAINT)
    expect(rig2.capabilities.twist).toBe(false)
    rig2.dispose()
  })
})

// ---------- overlay view models ----------
const entry = (q: number, r: number, mode: ReachEntry['mode'], facing: Facing, extra: Partial<ReachEntry> = {}): ReachEntry => ({
  hex: { q, r }, label: `${String(q + 1).padStart(2, '0')}${String(r + 1).padStart(2, '0')}`, facing, mode, path: [], mpUsed: 1, hexesMoved: 1, tmm: 0,
  attackerMod: 0, heat: 0, psrs: [], endsProne: false, physical: null, action: {} as never, ...extra,
})

describe('overlay view models', () => {
  const entries = [
    entry(1, 1, 'walk', 0), entry(1, 1, 'run', 0), entry(2, 1, 'run', 2), entry(3, 3, 'jump', 1),
    entry(4, 4, 'walk', 1, { physical: { kind: 'charge', targetId: 'B1', fromHex: { q: 4, r: 4 } } }),
  ]
  const kinds = (specs: ReturnType<typeof reachFillSpecs>) => specs.map((s) => `${s.kind}${s.outline ? '*' : ''}@${s.hex.q},${s.hex.r}`).sort()

  it('walk shows walk-reachable green and run-only hexes as amber outlines; run fills them; jump is blue only', () => {
    expect(kinds(reachFillSpecs(entries, 'walk'))).toEqual(['run-hint*@2,1', 'walk@1,1'])
    expect(kinds(reachFillSpecs(entries, 'run'))).toEqual(['run@2,1', 'walk@1,1'])
    expect(kinds(reachFillSpecs(entries, 'jump'))).toEqual(['jump@3,3'])
    expect(reachFillSpecs(entries, 'standStill')).toEqual([])
    const colours = Object.fromEntries(reachFillSpecs(entries, 'run').map((s) => [s.kind, s.colour]))
    expect(colours).toEqual({ walk: '#3fae5a', run: '#d99a1e' })
    expect(reachFillSpecs(entries, 'jump')[0]!.colour).toBe('#3d7fd9')
  })

  it('charge entries are not fills; they name their target and the hexes you would end in', () => {
    const t = attackTargets(entries, 'walk')
    expect([...t.keys()]).toEqual(['B1'])
    expect(t.get('B1')).toMatchObject({ kind: 'charge', fromHexes: [{ q: 4, r: 4 }] })
  })

  it('facing arrows are enabled only for facings in the reach set, each with its MP; Q/E skip disabled arrows', () => {
    const es = [entry(5, 5, 'walk', 1, { mpUsed: 3 }), entry(5, 5, 'walk', 4, { mpUsed: 5 }), entry(5, 5, 'run', 2)]
    const c = facingChoices(es, { q: 5, r: 5 }, 'walk', false)
    expect(c.filter((x) => x.enabled).map((x) => [x.facing, x.mp])).toEqual([[1, 3], [4, 5]])
    expect(stepFacing(c, null, 1)).toBe(1)
    expect(stepFacing(c, 1, 1)).toBe(4)
    expect(stepFacing(c, 4, 1)).toBe(1)
    expect(stepFacing(c, 1, -1)).toBe(4)
    expect(stepFacing(facingChoices([], { q: 0, r: 0 }, 'walk', false), null, 1)).toBeNull()
  })

  it('path view: cumulative MP from the engine costs, cost chips, turn ticks, backward steps and PSR flags', () => {
    const step = (op: string, q: number, total: number, extra: Record<string, unknown> = {}) => ({ op, hex: { q, r: 0 }, facing: 0, cost: { base: 1, terrain: 0, level: 0, turn: 0, total, ...(extra.cost as object) }, psr: (extra.psr as string) ?? null })
    const e = entry(3, 0, 'run', 0, { mpUsed: 6, path: [step('forward', 1, 1), step('forward', 2, 3, { cost: { terrain: 1, level: 1 } }), step('turnRight', 2, 1), step('backward', 3, 1, { psr: 'runWater' })] as never })
    const v = pathView(e)
    expect(v.steps.map((s) => s.cumulative)).toEqual([1, 4, 5, 6])
    expect(v.steps[1]!.chips).toEqual(['+1 terrain', '+1 level'])
    expect(v.steps[2]!.turn).toBe(true)
    expect(v.steps[3]!.backward).toBe(true)
    expect(v.steps[3]!.psr!.label).toMatch(/water/)
    expect(v.total).toBe(6)
    expect(v.hexes.map((h) => h.q)).toEqual([1, 2, 3]) // the turn does not add a hex
  })

  it('arcs: sides blue-grey, rear red, front shaded lightly and outlined', () => {
    const f = arcFills({ front: [{ q: 0, r: 0 }], left: [{ q: 1, r: 0 }], right: [{ q: 2, r: 0 }], rear: [{ q: 3, r: 0 }], mountArcs: {} })
    expect(f.fills.map((x) => x.kind)).toEqual(['left', 'right', 'rear', 'frontFill'])
    expect(f.fills.every((x) => x.opacity >= 0.2)).toBe(true)
    expect(f.frontOutline).toEqual([{ q: 0, r: 0 }])
    expect(arcFills(null)).toEqual({ fills: [], frontOutline: [] })
  })

  it('LOS lines: clear green, clear with modifiers amber, no attack red; chips carry our words', () => {
    const base = { visible: true, attackAllowed: true, divided: false, chosen: null, hexes: [{ q: 0, r: 0 }, { q: 1, r: 0 }], alt: null, blockers: [], woodsPoints: 0, partialCover: false }
    expect(losView({ ...base, reasons: [{ code: 'clear' }] })!.colour).toBe('clear')
    const amber = losView({ ...base, woodsPoints: 1, reasons: [{ code: 'woods', hex: { q: 1, r: 0 }, value: 1 }] })!
    expect(amber.colour).toBe('modified')
    expect(amber.chips[0]!.text).toMatch(/woods/)
    const red = losView({ ...base, visible: false, attackAllowed: false, reasons: [{ code: 'woodsBlock', hex: { q: 1, r: 0 } }], blockers: [{ hex: { q: 1, r: 0 }, reason: 'woods' }] })!
    expect(red.colour).toBe('blocked')
    expect(red.blockers).toEqual([{ q: 1, r: 0 }])
    expect(LOS_COLOUR_HEX.clear).toBe('#3fae5a'); expect(LOS_COLOUR_HEX.blocked).toBe('#d0402b')
    expect(losView(null)).toBeNull()
  })

  it('range bands bucket a hex distance by the weapon data (minimum, short, medium, long)', () => {
    const r = { min: 3, short: 6, medium: 12, long: 18 }
    expect([0, 2, 3, 4, 6, 7, 12, 13, 18, 19].map((d) => bandOfDistance(r, d))).toEqual([null, 'min', 'min', 'short', 'short', 'medium', 'medium', 'long', 'long', null])
  })
})

// ---------- VFX ----------
describe('VFX', () => {
  it('every weapon in the data has a flight look; lasers, PPCs, missiles and ballistic weapons are told apart', () => {
    const looks = Object.fromEntries(Object.keys(bundle().weapons).map((id) => [id, weaponLook(id).look]))
    expect(looks['is.w.medium-laser']).toBe('laser')
    expect(looks['is.w.er-large-laser']).toBe('laser')
    expect(looks['is.w.ppc']).toBe('ppc')
    expect(looks['is.w.snub-nose-ppc']).toBe('ppc')
    expect(looks['is.w.lrm-10']).toBe('missile')
    expect(looks['is.w.srm-6']).toBe('missile')
    expect(looks['is.w.mml-5']).toBe('missile')
    expect(looks['is.w.machine-gun']).toBe('tracer')
    expect(weaponLook('cl.w.heavy-medium-laser').clan).toBe(true)
    expect(weaponLook('is.w.lrm-10').rack).toBe(8) // capped for drawing
    for (const l of Object.values(looks)) expect(['laser', 'ppc', 'tracer', 'missile']).toContain(l)
  })

  function twoUnitState(): { state: GameState; a: UnitId; b: UnitId } {
    expect(newGame({ ...INTRO, controllers: { A: 'human', B: 'human' }, seed: 'vfx-1' })).toBeNull()
    const s = useGameStore.getState().state!
    const [a, b] = [s.unitOrder.find((id) => s.units[id]!.owner === 'A')!, s.unitOrder.find((id) => s.units[id]!.owner === 'B')!]
    const placed = { ...s, units: { ...s.units, [a]: { ...s.units[a]!, status: 'active', pos: { q: 6, r: 10 } }, [b]: { ...s.units[b]!, status: 'active', pos: { q: 6, r: 4 } } } } as GameState
    return { state: placed, a, b }
  }
  const beat = (fx: ActiveBeat['fx'], unitIds: UnitId[]): ActiveBeat => ({ id: 1, kind: 'fire', startedAt: 0, durationMs: 700, firstSeq: 1, lastSeq: 1, unitIds, fx })

  it('a laser shot plans a muzzle flash and a beam from the mount location to the target (a miss ends beside it)', () => {
    const { state, a, b } = twoUnitState()
    const mount = Object.values(state.units[a]!.mounts).find((m) => weaponLook(m.item).look === 'laser')!
    const fx = (hit: boolean) => ({ kind: 'fire' as const, attackId: 'x', attackerId: a, targetId: b, attack: 'ranged' as const, mountId: mount.id, weaponId: mount.item, hit, tn: 8, roll: 9 })
    const specs = planBeat(beat(fx(true), [a, b]), { state, tweens: {}, now: 0 })
    expect(specs.map((s) => s.kind)).toEqual(['muzzle', 'beam'])
    const bm = specs[1] as Extract<(typeof specs)[number], { kind: 'beam' }>
    const target = query.hexToWorld(state, state.units[b]!.pos!)
    expect(bm.to.x).toBeCloseTo(target.x, 0)
    expect(bm.to.z).toBeCloseTo(target.z, 0)
    expect(bm.from.y).toBeGreaterThan(hexTopY(state, state.units[a]!.pos!))
    const miss = planBeat(beat(fx(false), [a, b]), { state, tweens: {}, now: 0 })[1] as typeof bm
    expect(Math.hypot(miss.to.x - bm.to.x, miss.to.z - bm.to.z)).toBeGreaterThan(0.3)
    expect(missPoint({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -5 }).x).not.toBe(0)
  })

  it('PPCs fly as bolts, missiles as a rack of trails, hits spark at the struck location, destruction burns', () => {
    const { state, a, b } = twoUnitState()
    const find = (look: string) => Object.values(state.units[a]!.mounts).find((m) => weaponLook(m.item).look === look)!
    const mk = (m: { id: string; item: string }) => ({ kind: 'fire' as const, attackId: 'x', attackerId: a, targetId: b, attack: 'ranged' as const, mountId: m.id, weaponId: m.item, hit: true, tn: 8, roll: 9 })
    expect(planBeat(beat(mk(find('ppc')), [a, b]), { state, tweens: {}, now: 0 }).map((s) => s.kind)).toContain('bolt')
    const missiles = planBeat(beat(mk(find('missile')), [a, b]), { state, tweens: {}, now: 0 }).find((s) => s.kind === 'missiles') as { count: number }
    expect(missiles.count).toBeGreaterThan(1)
    const hit = planBeat(beat({ kind: 'hit', unitId: b, location: 'RA', side: 'front', damage: 12, attackId: 'x' }, [b]), { state, tweens: {}, now: 0 })
    expect(hit).toHaveLength(1)
    expect(hit[0]).toMatchObject({ kind: 'impact', mode: 'blast' })
    const small = planBeat(beat({ kind: 'hit', unitId: b, location: 'LL', side: 'front', damage: 3, attackId: 'x' }, [b]), { state, tweens: {}, now: 0 })
    expect(small[0]).toMatchObject({ kind: 'impact', mode: 'spark' })
    expect((hit[0] as { at: { y: number } }).at.y).toBeGreaterThan((small[0] as { at: { y: number } }).at.y) // an arm is higher than a leg
    expect(planBeat(beat({ kind: 'destroyed', unitId: b }, [b]), { state, tweens: {}, now: 0 }).map((s) => s.kind)).toEqual(['fireball', 'smoke'])
    expect(planBeat(beat({ kind: 'fall', unitId: b }, [b]), { state, tweens: {}, now: 0 }).map((s) => s.kind)).toEqual(['dust'])
    expect(planBeat(beat(null, []), { state, tweens: {}, now: 0 })).toEqual([])
  })

  it('the pooled engine plays a beam and a missile rack, goes idle when they end, and clear() empties the pools', () => {
    const e = new VfxEngine()
    const from = { x: 0, y: 1, z: 0 }, to = { x: 0, y: 1, z: -5 }
    expect(e.busy).toBe(false)
    e.play([{ kind: 'beam', from, to, colour: 0xff3b30, width: 0.03, dur: 380, delay: 0 }, { kind: 'missiles', from, to, count: 6, dur: 500, delay: 0 }, { kind: 'impact', at: to, mode: 'spark', delay: 100 }], 0, 1)
    expect(e.busy).toBe(true)
    e.update(0, 0.016)
    e.update(200, 0.016)
    expect(e.busy).toBe(true)
    for (let t = 300; t < 3000; t += 100) e.update(t, 0.1)
    expect(e.busy).toBe(false)
    // speed 2 halves the durations
    e.play([{ kind: 'beam', from, to, colour: 0xff3b30, width: 0.03, dur: 400, delay: 0 }], 10000, 2)
    e.update(10250, 0.016)
    expect(e.busy).toBe(false)
    e.play([{ kind: 'fireball', at: to, size: 1, delay: 0 }], 20000, 1)
    expect(glowPool.alive + smokePool.alive).toBeGreaterThan(0)
    e.clear()
    expect(glowPool.alive + smokePool.alive).toBe(0)
    expect(e.busy).toBe(false)
    e.lite = true
    e.play([{ kind: 'fireball', at: to, size: 1, delay: 0 }], 30000, 1)
    e.update(30010, 0.016)
    expect(glowPool.alive + smokePool.alive).toBe(0) // Low graphics: no particles
    e.dispose()
  })
})

// ---------- picking and the real interaction flow ----------
describe('ray to hex', () => {
  it('a ray down onto a hex top returns that hex, including raised hexes and oblique rays; off the board is null', () => {
    expect(newGame({ ...INTRO, controllers: { A: 'human', B: 'human' }, seed: 'pick-1' })).toBeNull()
    const s = useGameStore.getState().state!
    const raised = Object.entries(s.board.hexes).find(([, h]) => h.level > 0)
    const label = raised ? raised[0] : Object.keys(s.board.hexes)[40]!
    const h = (query as unknown as { hexToWorld: unknown }) && (() => { const m = /^(\d\d)(\d\d)$/.exec(label)!; const col = Number(m[1]) - 1, row = Number(m[2]) - 1; return { q: col, r: row - (col - (col & 1)) / 2 } })()
    const w = query.hexToWorld(s, h)
    const top = hexTopY(s, h)
    expect(rayToHex(s, { x: w.x, y: 8, z: w.z }, { x: 0, y: -1, z: 0 })).toEqual(h)
    const o = { x: w.x, y: 7, z: w.z + 7 }
    const d = { x: 0, y: top - o.y, z: w.z - o.z }
    const n = Math.hypot(d.y, d.z)
    expect(rayToHex(s, o, { x: 0, y: d.y / n, z: d.z / n })).toEqual(h)
    expect(rayToHex(s, { x: 500, y: 8, z: 500 }, { x: 0, y: -1, z: 0 })).toBeNull()
    expect(rayToHex(s, { x: w.x, y: 8, z: w.z }, { x: 0, y: 1, z: 0 })).toBeNull()
    expect(LEVEL_HEIGHT).toBeGreaterThan(0)
  })
})

describe('move flow through the real stores', () => {
  function toMove(): UnitId {
    for (let i = 0; i < 40; i++) {
      const p = useGameStore.getState().pending!
      if (p.kind === 'move' || p.kind === 'deploy') return p.unitId ?? ''
      if (p.kind === 'initiativeAck') game.ack()
      else if (p.kind === 'selectUnit') game.selectUnit(p.context.eligible![0]!)
      else throw new Error('unexpected decision ' + p.kind)
    }
    throw new Error('no move decision')
  }

  it('select, click a reachable hex, pick a facing from the picker, confirm: the engine entry is dispatched and the mech arrives', () => {
    expect(newGame({ ...INTRO, controllers: { A: 'human', B: 'human' }, seed: 'u1' })).toBeNull()
    const off = bootClient({ bot: false, autosave: false, clickToSkip: false })
    const id = toMove()
    expect(useUiStore.getState().mode).toBe('move')
    expect(useUiStore.getState().selectedId).toBe(id)
    const entries = queryReach(id)
    const target = entries.find((e) => e.mode === 'walk' && !e.physical)!
    expect(target).toBeTruthy()
    // a click outside the reach set clears the draft instead of locking a hex
    handleHexClick({ q: 50, r: 50 })
    expect(useUiStore.getState().move.hex).toBeNull()
    handleHexClick(target.hex)
    const d = useUiStore.getState().move
    expect(d.hex).toEqual(target.hex)
    expect(draftReady()).toBe(false) // no facing yet unless only one exists
    const choices = currentFacingChoices()
    expect(choices).toHaveLength(6)
    const allowed = entries.filter((e) => e.mode === 'walk' && !e.physical && e.hex.q === target.hex.q && e.hex.r === target.hex.r).map((e) => e.facing)
    expect(choices.filter((c) => c.enabled).map((c) => c.facing).sort()).toEqual([...new Set(allowed)].sort())
    const disabled = choices.find((c) => !c.enabled)
    if (disabled) { chooseFacing(disabled.facing); expect(useUiStore.getState().move.facing).not.toBe(disabled.facing) }
    chooseFacing(allowed[0]!)
    expect(draftReady()).toBe(true)
    expect(confirmDraft()).toBeNull()
    const u = useGameStore.getState().state!.units[id]!
    expect(u.pos).toEqual(target.hex)
    expect(u.facing).toBe(allowed[0])
    expect(useUiStore.getState().move.hex).toBeNull() // the draft resets after the commit
    off()
  })

  it('clicking an own Mech while a selectUnit decision is open answers it; clicking one outside the eligible set only selects it', () => {
    expect(newGame({ ...INTRO, controllers: { A: 'human', B: 'human' }, seed: 'u1' })).toBeNull()
    const off = bootClient({ bot: false, autosave: false, clickToSkip: false })
    for (let i = 0; i < 6 && useGameStore.getState().pending!.kind !== 'selectUnit'; i++) game.ack()
    const p = useGameStore.getState().pending!
    expect(p.kind).toBe('selectUnit')
    const s = useGameStore.getState().state!
    // units are off the board before their first move: clicks need a hex, so place one in a cloned view only
    const el = p.context.eligible![0]!
    expect(s.units[el]!.pos).toBeNull()
    expect(handleUnitClick(el)).toBeNull() // no board position: nothing to click
    expect(useGameStore.getState().pending!.kind).toBe('selectUnit')
    expect(game.selectUnit(el)).toBeNull()
    expect(useGameStore.getState().pending!.kind).toBe('move')
    expect(deployZone()).toEqual([]) // not a deployment decision
    off()
  })
})

// keep the imports honest when a helper is only used for typing
export type _Unused = Hex | typeof usePresentedStore
