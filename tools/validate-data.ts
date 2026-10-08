// npm run validate:data : ajv over the schemas plus the cross checks of 20-data-schema section 11.
// Exports validateDataset() so tests can feed it mutated copies of the real data.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Mod from 'ajv/dist/2020.js'
import addFormatsMod from 'ajv-formats'
import { adjustedBv, engineHeldSinks, maxArmor } from '../src/data/derive'
import type { Ammo, Equipment, Force, GameMap, Mech, Mission, Pilot, Spa, Tables, Weapon, Loc } from '../src/data/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '..')
const DATA = path.join(REPO, 'src', 'data')
const SCHEMAS = path.join(REPO, 'docs', 'spec', 'schemas')
const SOURCES = path.join(REPO, 'docs', 'sources')

// ---------------------------------------------------------------- dataset
export interface Dataset {
  weapons: Weapon[]
  ammo: Ammo[]
  equipment: Equipment[]
  spas: Spa[]
  pilots: Pilot[]
  tables: Tables
  mechs: Mech[]
  maps: GameMap[]
  forces: Force[]
  missions: Mission[]
}
export interface Report { errors: string[]; warnings: string[]; logs: string[] }

function listJson(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...listJson(p))
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out.sort()
}
const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T

export function loadDataset(root = DATA): Dataset {
  const rd = <T>(rel: string): T => readJson<T>(path.join(root, rel))
  const dir = (rel: string): string[] => (fs.existsSync(path.join(root, rel)) ? listJson(path.join(root, rel)) : [])
  return {
    weapons: rd('core/weapons.json'),
    ammo: rd('core/ammo.json'),
    equipment: rd('core/equipment.json'),
    spas: rd('core/spas.json'),
    pilots: rd('pilots/pilots.json'),
    tables: rd('core/tables.json'),
    mechs: dir('mechs').map((p) => readJson<Mech>(p)),
    maps: dir('maps').map((p) => readJson<GameMap>(p)),
    forces: dir('forces').map((p) => readJson<Force>(p)),
    missions: dir('missions').map((p) => readJson<Mission>(p)),
  }
}

// ---------------------------------------------------------------- constants (from the spec)
const IS_TABLE: Record<number, [number, number, number, number]> = {
  20: [6, 5, 3, 4], 25: [8, 6, 4, 6], 30: [10, 7, 5, 7], 35: [11, 8, 6, 8], 40: [12, 10, 6, 10], 45: [14, 11, 7, 11],
  50: [16, 12, 8, 12], 55: [18, 13, 9, 13], 60: [20, 14, 10, 14], 65: [21, 15, 10, 15], 70: [22, 15, 11, 15],
  75: [23, 16, 12, 16], 80: [25, 17, 13, 17], 85: [27, 18, 14, 18], 90: [29, 19, 15, 19], 95: [30, 20, 16, 20], 100: [31, 21, 17, 21],
}
const ENGINE_SLOTS: Record<string, { ct: number; sideIS: number; sideClan: number }> = {
  standard: { ct: 6, sideIS: 0, sideClan: 0 }, compact: { ct: 3, sideIS: 0, sideClan: 0 }, light: { ct: 6, sideIS: 2, sideClan: 2 },
  xl: { ct: 6, sideIS: 3, sideClan: 2 }, xxl: { ct: 6, sideIS: 6, sideClan: 4 },
}
const GYRO_SLOTS: Record<string, number> = { standard: 4, compact: 2, heavyDuty: 4, xl: 6 }
const STRUCT_FILL: Record<string, { IS: number; Clan: number }> = {
  endoSteel: { IS: 14, Clan: 7 }, endoComposite: { IS: 7, Clan: 4 }, composite: { IS: 0, Clan: 0 }, reinforced: { IS: 0, Clan: 0 }, standard: { IS: 0, Clan: 0 },
}
const ARMOR_FILL: Record<string, { IS: number; Clan: number }> = {
  ferroFibrous: { IS: 14, Clan: 7 }, lightFerro: { IS: 7, Clan: -1 }, heavyFerro: { IS: 21, Clan: -1 }, ferroLamellor: { IS: -1, Clan: 12 },
  stealth: { IS: 12, Clan: -1 }, reactive: { IS: 14, Clan: 7 }, reflective: { IS: 10, Clan: 5 }, standard: { IS: 0, Clan: 0 }, hardened: { IS: 0, Clan: 0 },
}
const SYSTEM_TOKENS = new Set(['lifeSupport', 'sensors', 'cockpit', 'engine', 'gyro', 'shoulder', 'upperArm', 'lowerArm', 'hand', 'hip', 'upperLeg', 'lowerLeg', 'foot'])
const FREE_TOKENS = new Set(['structure', 'armor', 'empty'])
const ADJACENT: Record<string, string[]> = { LA: ['LT'], RA: ['RT'], LT: ['CT', 'LA', 'LL'], RT: ['CT', 'RA', 'RL'], CT: ['LT', 'RT'], LL: ['LT'], RL: ['RT'] }
const LOCS: Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']
const LEAK_KEYS = new Set(['stability', 'evasion', 'skid', 'ghostHeat', 'dumpAmmo', 'pointValue', 'pv', 'tmm', 'overheat', 'inches', 'alphaStrike'])
const BANNED_ITEMS = /flail|flechette|fragmentation|ejection|industrial|\bumu\b|jump booster/i
const RESERVED_TERRAIN = new Set(['rubble', 'sand', 'mud', 'swamp', 'ice', 'snow', 'foliage', 'building', 'bridge'])
const FIXED_HOOKS = ['racJam', 'ultraJam', 'xPulse', 'improvedHeavyGauss', 'ppcCapacitor', 'targetingComputer', 'supercharger', 'caseProtect', 'caseIIProtect', 'ferroLamellor']

function knownHooks(): Set<string> {
  const s = new Set<string>(FIXED_HOOKS)
  const f = path.join(REPO, 'src', 'engine', 'code-hooks.ts')
  if (fs.existsSync(f)) {
    const txt = fs.readFileSync(f, 'utf8')
    for (const m of txt.matchAll(/name:\s*['"]([A-Za-z0-9.]+)['"]/g)) s.add(m[1]!)
  }
  return s
}

// ---------------------------------------------------------------- schema pass
type AjvLike = { addSchema(s: unknown): unknown; getSchema(id: string): ((d: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null } | undefined }
function buildAjv(): AjvLike {
  const Ajv = ((Ajv2020Mod as unknown as { default?: unknown }).default ?? Ajv2020Mod) as new (o: object) => AjvLike
  const addFormats = ((addFormatsMod as unknown as { default?: unknown }).default ?? addFormatsMod) as (a: unknown) => void
  const ajv = new Ajv({ allErrors: true, strict: true })
  addFormats(ajv)
  for (const f of fs.readdirSync(SCHEMAS)) if (f.endsWith('.schema.json')) ajv.addSchema(readJson(path.join(SCHEMAS, f)))
  return ajv
}

// ---------------------------------------------------------------- helpers
type Ctx = Report & { err(where: string, msg: string): void; warn(where: string, msg: string): void; log(msg: string): void }
function mkCtx(): Ctx {
  const r: Ctx = {
    errors: [], warnings: [], logs: [],
    err(w, m) { r.errors.push(`${w}: ${m}`) },
    warn(w, m) { r.warnings.push(`${w}: ${m}`) },
    log(m) { r.logs.push(m) },
  }
  return r
}
function* walk(v: unknown, p = ''): Generator<[string, string, unknown]> {
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) yield* walk(v[i], `${p}/${i}`) }
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as object)) { yield [`${p}/${k}`, k, x]; yield* walk(x, `${p}/${k}`) }
  }
}
function* strings(v: unknown, p = ''): Generator<[string, string]> {
  if (typeof v === 'string') yield [p, v]
  else if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) yield* strings(v[i], `${p}/${i}`) }
  else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v as object)) yield* strings(x, `${p}/${k}`) }
}
const SIDE_IS = (id: string): boolean => id.startsWith('is.')
const orderedRanges = (r: { min?: number; short: number; medium: number; long: number }): boolean =>
  (r.min ?? 0) < r.short && r.short < r.medium && r.medium < r.long

// ---------------------------------------------------------------- the checks
export interface Options { skipSchema?: boolean; skipProse?: boolean }

export function validateDataset(ds: Dataset, opts: Options = {}): Report {
  const c = mkCtx()
  const hooks = knownHooks()

  // ---- schemas
  if (!opts.skipSchema) {
    const ajv = buildAjv()
    const run = (name: string, rec: unknown, label: string): void => {
      const v = ajv.getSchema(`https://warmechforge.dev/schemas/${name}.schema.json`)
      if (!v) { c.err(label, `schema ${name} missing`); return }
      if (!v(rec)) for (const e of v.errors ?? []) c.err(label, `schema ${name} ${e.instancePath || '/'} ${e.message}`)
    }
    ds.weapons.forEach((r) => run('weapon', r, r.id))
    ds.ammo.forEach((r) => run('ammo', r, r.id))
    ds.equipment.forEach((r) => run('equipment', r, r.id))
    ds.spas.forEach((r) => run('spa', r, r.id))
    ds.pilots.forEach((r) => run('pilot', r, r.id))
    ds.mechs.forEach((r) => run('mech', r, r.id))
    ds.maps.forEach((r) => run('map', r, r.id))
    ds.forces.forEach((r) => run('force', r, r.id))
    ds.missions.forEach((r) => run('mission', r, r.id))
    run('tables', ds.tables, 'tables')
  }

  // ---- unique ids and id maps
  const all = new Map<string, string>()
  const addIds = (kind: string, list: { id: string }[]): void => {
    for (const r of list) {
      if (all.has(r.id)) c.err(r.id, `duplicate id (also a ${all.get(r.id)})`)
      all.set(r.id, kind)
    }
  }
  addIds('weapon', ds.weapons); addIds('ammo', ds.ammo); addIds('equipment', ds.equipment); addIds('spa', ds.spas)
  addIds('pilot', ds.pilots); addIds('mech', ds.mechs); addIds('map', ds.maps); addIds('force', ds.forces); addIds('mission', ds.missions)
  const W = new Map(ds.weapons.map((w) => [w.id, w]))
  const AM = new Map(ds.ammo.map((a) => [a.id, a]))
  const EQ = new Map(ds.equipment.map((e) => [e.id, e]))
  const MECH = new Map(ds.mechs.map((m) => [m.id, m]))
  const PILOT = new Map(ds.pilots.map((p) => [p.id, p]))
  const MAP = new Map(ds.maps.map((m) => [m.id, m]))
  const FORCE = new Map(ds.forces.map((f) => [f.id, f]))
  const SPA = new Set(ds.spas.map((s) => s.id))

  // ---- tables
  {
    const t = ds.tables
    if (t.bvSkillMultiplier?.rows?.[4]?.[5] !== 1) c.err('tables', 'bvSkillMultiplier.rows[4][5] must be 1')
    for (const [ton, row] of Object.entries(IS_TABLE)) {
      const r = t.internalStructure?.[String(ton)]
      if (!r) { c.err('tables', `internalStructure row ${ton} missing`); continue }
      const want = { HD: 3, CT: row[0], sideTorso: row[1], arm: row[2], leg: row[3] }
      if (JSON.stringify([r.HD, r.CT, r.sideTorso, r.arm, r.leg]) !== JSON.stringify([want.HD, want.CT, want.sideTorso, want.arm, want.leg])) {
        c.err('tables', `internalStructure ${ton} differs from the spec table`)
      }
    }
  }

  // ---- weapons and ammo
  for (const w of ds.weapons) {
    if (!orderedRanges(w.ranges)) c.err(w.id, 'ranges must satisfy min < short < medium < long')
    if (w.techBase === 'IS' !== SIDE_IS(w.id) || !/^(is|cl)\.w\./.test(w.id)) c.err(w.id, 'id prefix does not match techBase or the w. grammar')
    for (const a of w.ammo ?? []) {
      const am = AM.get(a)
      if (!am) c.err(w.id, `ammo ${a} does not exist`)
      else if (!am.weapons.includes(w.id)) c.err(w.id, `ammo ${a} does not list this weapon back`)
    }
    for (const h of [...(w.code ?? []), ...(w.rapidFire?.jamHook ? [w.rapidFire.jamHook] : [])]) if (!hooks.has(h)) c.err(w.id, `unknown hook ${h}`)
    if ((w.flags ?? []).includes('streak') && !w.cluster) c.err(w.id, 'streak needs a cluster block')
  }
  for (const a of ds.ammo) {
    if (a.override?.ranges && !orderedRanges(a.override.ranges)) c.err(a.id, 'override ranges must be ordered')
    for (const wid of a.weapons) {
      const w = W.get(wid)
      if (!w) c.err(a.id, `weapon ${wid} does not exist`)
      else if (!(w.ammo ?? []).includes(a.id)) c.err(a.id, `weapon ${wid} does not list this ammo`)
    }
    if (a.explodes === false && a.explosionPerShot !== 0) c.err(a.id, 'inert ammo must have explosionPerShot 0')
    for (const h of a.code ?? []) if (!hooks.has(h)) c.err(a.id, `unknown hook ${h}`)
  }

  // ---- equipment fixed values (section 5)
  const jjTons = (t: number): number => (t <= 55 ? 0.5 : t <= 85 ? 1 : 2)
  for (const e of ds.equipment) {
    const slotsTons = `${e.slots}/${e.tons}`
    const want = (s: number, t: number | 'perMech'): void => {
      if (e.slots !== s || e.tons !== t) c.err(e.id, `fixed values: expected ${s} slots / ${t} t, found ${slotsTons}`)
    }
    if (e.kind === 'heatSink') {
      if (e.heatSink?.dissipation === 1) want(1, 1)
      else want(e.techBase === 'IS' ? 3 : 2, 1)
    } else if (e.kind === 'jumpJet') {
      want(e.jumpJet?.improved ? 2 : 1, 'perMech')
    } else if (e.kind === 'case') {
      if (e.techBase === 'IS') want(1, 0.5); else want(0, 0)
    } else if (e.kind === 'caseII') {
      want(1, e.techBase === 'IS' ? 1 : 0.5)
    } else if (e.kind === 'capacitor') {
      want(1, 1)
    } else if (e.kind === 'supercharger') {
      if (e.slots !== 1) c.err(e.id, 'supercharger is 1 slot')
    }
    for (const h of e.code ?? []) if (!hooks.has(h)) c.err(e.id, `unknown hook ${h}`)
  }

  // ---- mechs
  for (const m of ds.mechs) checkMech(m, ds, c, { W, AM, EQ }, jjTons)

  // ---- pilots and spas
  for (const p of ds.pilots) for (const s of p.spas) if (!SPA.has(s)) c.err(p.id, `spa ${s} does not exist`)
  for (const s of ds.spas) if (!hooks.has(`spa.${s.hook}`) && !hooks.has(s.hook)) c.warn(s.id, `hook ${s.hook} not in the registry`)

  // ---- maps
  for (const m of ds.maps) checkMap(m, MAP, c)

  // ---- forces
  for (const f of ds.forces) {
    let total = 0
    for (const [i, u] of f.units.entries()) {
      const mech = MECH.get(u.mech)
      if (!mech) { c.err(f.id, `unit ${i}: mech ${u.mech} does not exist`); continue }
      if (u.pilot && !PILOT.has(u.pilot)) c.err(f.id, `unit ${i}: pilot ${u.pilot} does not exist`)
      const sk = u.skills ?? (u.pilot ? PILOT.get(u.pilot) : undefined) ?? { gunnery: 4, piloting: 5 }
      total += adjustedBv(ds.tables, mech.bv, sk.gunnery, sk.piloting)
      for (const [bin, ammoId] of Object.entries(u.ammo ?? {})) {
        const b = mech.ammoBins.find((x) => x.id === bin)
        if (!b) c.err(f.id, `unit ${i}: bin ${bin} not on ${mech.id}`)
        else if (!(b.options ?? [b.ammo]).includes(ammoId)) c.err(f.id, `unit ${i}: ${ammoId} is not an option for ${bin}`)
      }
      for (const bin of u.halfLoad ?? []) if (!mech.ammoBins.some((x) => x.id === bin)) c.err(f.id, `unit ${i}: half-load bin ${bin} not on ${mech.id}`)
    }
    if (f.bvBudget !== undefined && total > f.bvBudget) c.err(f.id, `adjusted BV ${total} exceeds bvBudget ${f.bvBudget}`)
    c.log(`${f.id}: adjusted BV ${total}`)
  }

  // ---- missions
  for (const m of ds.missions) checkMission(m, MAP, FORCE, MECH, PILOT, ds, c, hooks)

  // ---- edition leak, banned items, prose
  const records: [string, unknown][] = [
    ...ds.weapons.map((r): [string, unknown] => [r.id, r]), ...ds.ammo.map((r): [string, unknown] => [r.id, r]),
    ...ds.equipment.map((r): [string, unknown] => [r.id, r]), ...ds.spas.map((r): [string, unknown] => [r.id, r]),
    ...ds.pilots.map((r): [string, unknown] => [r.id, r]), ...ds.mechs.map((r): [string, unknown] => [r.id, r]),
    ...ds.maps.map((r): [string, unknown] => [r.id, r]), ...ds.forces.map((r): [string, unknown] => [r.id, r]),
    ...ds.missions.map((r): [string, unknown] => [r.id, r]), ['tables', ds.tables],
  ]
  for (const [id, rec] of records) {
    for (const [p, k] of walk(rec)) if (LEAK_KEYS.has(k)) c.err(id, `edition leak key "${k}" at ${p}`)
    for (const [p, s] of strings(rec)) if (/Weapon Attack Phase/i.test(s)) c.err(id, `edition leak text at ${p}`)
    const itemId = (rec as { id?: string }).id ?? ''
    if (BANNED_ITEMS.test(itemId) || BANNED_ITEMS.test((rec as { name?: string }).name ?? '')) c.err(id, 'out-of-scope item (flail, flechette, ejection, industrial, UMU, booster)')
  }
  if (!opts.skipProse) proseScan(records, c)
  return c
}

// ---------------------------------------------------------------- mech
function checkMech(
  m: Mech, ds: Dataset, c: Ctx,
  maps: { W: Map<string, Weapon>; AM: Map<string, Ammo>; EQ: Map<string, Equipment> },
  jjTons: (t: number) => number,
): void {
  const { W, AM, EQ } = maps
  const id = m.id
  const tb = (x?: string): string => x ?? m.techBase
  const engTb = tb(m.engine.techBase)
  if (m.techBase === 'Mixed') for (const part of ['engine', 'heatSinks', 'structure', 'armor'] as const) if (!m[part].techBase) c.err(id, `Mixed 'Mech needs ${part}.techBase`)
  if (!IS_TABLE[m.tonnage]) c.err(id, `tonnage ${m.tonnage} not in the structure table`)

  // movement
  if (m.engine.rating !== m.tonnage * m.movement.walk) c.err(id, `engine rating ${m.engine.rating} != tonnage x walk (${m.tonnage * m.movement.walk})`)
  if (m.movement.run !== Math.ceil(m.movement.walk * 1.5)) c.err(id, `run ${m.movement.run} != ceil(walk x 1.5)`)
  const jjMounts = m.mounts.filter((x) => EQ.get(x.item)?.kind === 'jumpJet')
  const improved = jjMounts.some((x) => EQ.get(x.item)?.jumpJet?.improved)
  if (jjMounts.length !== m.movement.jump) c.err(id, `${jjMounts.length} jump-jet mounts but jump ${m.movement.jump}`)
  if (m.movement.jump > (improved ? m.movement.run : m.movement.walk)) c.err(id, 'jump exceeds walk (run if improved)')
  for (const j of jjMounts) {
    if (!['LL', 'RL', 'LT', 'RT', 'CT'].includes(j.location)) c.err(id, `jump jet ${j.id} in ${j.location}`)
    const want = jjTons(m.tonnage) * (EQ.get(j.item)?.jumpJet?.improved ? 2 : 1)
    if (j.tons !== want) c.err(id, `jump jet ${j.id} tons ${j.tons}, expected ${want}`)
  }

  // heat sinks
  const held = engineHeldSinks(m)
  const sinkMounts = m.mounts.filter((x) => EQ.get(x.item)?.kind === 'heatSink')
  if (sinkMounts.length !== m.heatSinks.count - held) c.err(id, `${sinkMounts.length} sink mounts, expected ${m.heatSinks.count - held}`)
  for (const s of sinkMounts) {
    const e = EQ.get(s.item)!
    if ((e.heatSink!.dissipation === 2) !== (m.heatSinks.type === 'double')) c.err(id, `sink ${s.id} type differs from the 'Mech's`)
    if (e.techBase !== tb(m.heatSinks.techBase)) c.err(id, `sink ${s.id} tech base`)
  }

  // armor
  for (const loc of LOCS) {
    const f = m.armor.front[loc]
    const cap = maxArmor(ds.tables, m.tonnage, loc)
    const rear = loc === 'CT' || loc === 'LT' || loc === 'RT' ? m.armor.rear[loc] : 0
    if (loc === 'HD' && f > 9) c.err(id, 'head armor above 9')
    if (f + rear > cap) c.err(id, `${loc} armor ${f}+${rear} exceeds max ${cap}`)
  }

  // mounts and tech base
  const mountIds = new Set<string>()
  for (const x of m.mounts) {
    if (mountIds.has(x.id)) c.err(id, `duplicate mount id ${x.id}`)
    mountIds.add(x.id)
    const w = W.get(x.item); const e = EQ.get(x.item)
    const item = w ?? e
    if (!item) { c.err(id, `mount ${x.id}: item ${x.item} does not exist`); continue }
    if (m.techBase !== 'Mixed' && item.techBase !== m.techBase) c.err(id, `mount ${x.id}: ${x.item} is ${item.techBase}, 'Mech is ${m.techBase}`)
    if (x.rear && !['CT', 'LT', 'RT'].includes(x.location)) c.err(id, `mount ${x.id}: rear outside the torso`)
    if (x.split) {
      if (!w) c.err(id, `mount ${x.id}: only weapons may split`)
      if (!(ADJACENT[x.location] ?? []).includes(x.split)) c.err(id, `mount ${x.id}: split ${x.location}-${x.split} not adjacent`)
    }
    if (x.linkedTo) {
      const t = m.mounts.find((y) => y.id === x.linkedTo)
      const tw = t ? W.get(t.item) : undefined
      const kind = e?.kind === 'artemis' ? 'artemis' : e?.kind === 'capacitor' ? 'capacitor' : e?.kind === 'targetingComputer' ? 'targetingComputer' : ''
      if (!t || !tw) c.err(id, `mount ${x.id}: linkedTo ${x.linkedTo} is not a weapon mount`)
      else if (!kind || !(tw.linkable ?? []).includes(kind as 'artemis')) c.err(id, `mount ${x.id}: ${t.item} cannot link ${kind || 'this item'}`)
    }
    const fixedSlots = item.slots
    if (fixedSlots === 'perMech' && x.slots === undefined) c.err(id, `mount ${x.id}: perMech slots not stated`)
    if (item.tons === 'perMech' && x.tons === undefined) c.err(id, `mount ${x.id}: perMech tons not stated`)
  }

  // ammo bins
  const binIds = new Set<string>()
  const mountedWeapons = m.mounts.map((x) => W.get(x.item)).filter((x): x is Weapon => !!x)
  for (const b of m.ammoBins) {
    if (binIds.has(b.id) || mountIds.has(b.id)) c.err(id, `duplicate local id ${b.id}`)
    binIds.add(b.id)
    const a = AM.get(b.ammo)
    if (!a) { c.err(id, `bin ${b.id}: ammo ${b.ammo} does not exist`); continue }
    const firers = mountedWeapons.filter((w) => (w.ammo ?? []).includes(b.ammo))
    if (!firers.length) c.err(id, `bin ${b.id}: no mounted weapon fires ${b.ammo}`)
    if (m.techBase !== 'Mixed' && a.techBase !== m.techBase) c.err(id, `bin ${b.id}: ammo tech base`)
    if (b.options) {
      if (!b.options.includes(b.ammo)) c.err(id, `bin ${b.id}: options must include the default ammo`)
      for (const o of b.options) {
        if (!AM.has(o)) { c.err(id, `bin ${b.id}: option ${o} does not exist`); continue }
        for (const w of firers) if (!(w.ammo ?? []).includes(o)) c.err(id, `bin ${b.id}: option ${o} not fireable by ${w.id}`)
      }
    }
  }

  // crit table
  const cockpit = m.cockpit ?? 'standard'
  const gyro = m.gyro ?? 'standard'
  const eng = ENGINE_SLOTS[m.engine.type]!
  const side = engTb === 'IS' ? eng.sideIS : eng.sideClan
  const seq = (loc: Loc): string[] => m.crits[loc] ?? []
  const isFree = (t: string): boolean => FREE_TOKENS.has(t) || t.startsWith('#')
  const expectSys = (loc: Loc, i: number, want: string): void => { if (seq(loc)[i] !== want) c.err(id, `${loc} slot ${i + 1} should be ${want}, is ${seq(loc)[i]}`) }

  {
    const h = seq('HD')
    const pattern = cockpit === 'standard' ? ['lifeSupport', 'sensors', 'cockpit', null, 'sensors', 'lifeSupport'] : ['lifeSupport', 'sensors', 'cockpit', 'sensors', null, null]
    pattern.forEach((p, i) => { if (p === null) { if (!isFree(h[i]!)) c.err(id, `HD slot ${i + 1} must be free`) } else expectSys('HD', i, p) })
  }
  {
    const ct = seq('CT')
    const g = GYRO_SLOTS[gyro]!
    const want: (string | null)[] = [...Array(3).fill('engine'), ...Array(g).fill('gyro'), ...Array(eng.ct - 3).fill('engine')]
    while (want.length < 12) want.push(null)
    want.forEach((p, i) => { if (p === null) { if (!isFree(ct[i]!)) c.err(id, `CT slot ${i + 1} must be free`) } else expectSys('CT', i, p) })
  }
  for (const loc of ['LT', 'RT'] as const) {
    const s = seq(loc)
    s.forEach((t, i) => { if (i < side) expectSys(loc, i, 'engine'); else if (!isFree(t)) c.err(id, `${loc} slot ${i + 1} must be free`) })
  }
  for (const loc of ['LA', 'RA'] as const) {
    const s = seq(loc)
    expectSys(loc, 0, 'shoulder'); expectSys(loc, 1, 'upperArm')
    const hasLower = s[2] === 'lowerArm'
    const hasHand = s[3] === 'hand'
    if (hasHand && !hasLower) c.err(id, `${loc}: hand without lower arm`)
    s.forEach((t, i) => {
      if (i >= 2 && !(i === 2 && hasLower) && !(i === 3 && hasHand) && !isFree(t)) c.err(id, `${loc} slot ${i + 1} must be free`)
    })
  }
  for (const loc of ['LL', 'RL'] as const) {
    ['hip', 'upperLeg', 'lowerLeg', 'foot'].forEach((t, i) => expectSys(loc, i, t))
    seq(loc).forEach((t, i) => { if (i >= 4 && !isFree(t)) c.err(id, `${loc} slot ${i + 1} must be free`) })
  }

  // filler counts
  let structN = 0; let armorN = 0
  const refs = new Map<string, { loc: Loc; idx: number }[]>()
  for (const loc of LOCS) {
    seq(loc).forEach((t, idx) => {
      if (t === 'structure') structN++
      else if (t === 'armor') armorN++
      else if (t.startsWith('#')) { const k = t.slice(1); if (!refs.has(k)) refs.set(k, []); refs.get(k)!.push({ loc, idx }) }
      else if (!FREE_TOKENS.has(t) && !SYSTEM_TOKENS.has(t) && t !== 'engine' && t !== 'gyro') c.err(id, `${loc} slot ${idx + 1}: unknown token ${t}`)
    })
  }
  const sTb = (tb(m.structure.techBase) as 'IS' | 'Clan')
  const aTb = (tb(m.armor.techBase) as 'IS' | 'Clan')
  const wantS = STRUCT_FILL[m.structure.type]?.[sTb]
  const wantA = ARMOR_FILL[m.armor.type]?.[aTb]
  if (wantS === undefined || wantS < 0) c.err(id, `structure ${m.structure.type} is not available for ${sTb}`)
  else if (structN !== wantS) c.err(id, `${structN} structure filler slots, expected ${wantS}`)
  if (wantA === undefined || wantA < 0) c.err(id, `armor ${m.armor.type} is not available for ${aTb}`)
  else if (armorN !== wantA) c.err(id, `${armorN} armor filler slots, expected ${wantA}`)

  // mount slot accounting
  for (const x of m.mounts) {
    const item = W.get(x.item) ?? EQ.get(x.item)
    if (!item) continue
    const need = item.slots === 'perMech' ? (x.slots ?? 0) : item.slots
    const at = refs.get(x.id) ?? []
    if (at.length !== need) c.err(id, `mount ${x.id} occupies ${at.length} slots, expected ${need}`)
    for (const a of at) if (a.loc !== x.location && a.loc !== x.split) c.err(id, `mount ${x.id} found in ${a.loc}, declared ${x.location}${x.split ? '/' + x.split : ''}`)
    for (const loc of new Set(at.map((a) => a.loc))) {
      const idxs = at.filter((a) => a.loc === loc).map((a) => a.idx).sort((p, q) => p - q)
      if (idxs[idxs.length - 1]! - idxs[0]! !== idxs.length - 1) c.err(id, `mount ${x.id} is not contiguous in ${loc}`)
    }
    refs.delete(x.id)
  }
  for (const b of m.ammoBins) {
    const at = refs.get(b.id) ?? []
    if (at.length !== 1) c.err(id, `bin ${b.id} appears ${at.length} times, expected once`)
    else if (at[0]!.loc !== b.location) c.err(id, `bin ${b.id} found in ${at[0]!.loc}, declared ${b.location}`)
    refs.delete(b.id)
  }
  for (const k of refs.keys()) c.err(id, `crit table references #${k}, which is neither a mount nor a bin`)

  // BV, stock label
  if (!(m.bv > 0)) c.err(id, 'bv missing')
  if (m.stock && !(m.verify ?? []).some((v) => v.status === 'standIn')) c.err(id, 'stock stand-in needs a root verify note with status standIn')
  if (!m.source?.ref) c.err(id, 'source missing')

  // tonnage audit: the parts must add up to the chassis tonnage (a mismatch is an error)
  const sinkMountTons = m.mounts.reduce((s, x) => { const it = EQ.get(x.item); return s + (it?.kind === 'heatSink' ? (it.tons === 'perMech' ? x.tons ?? 0 : it.tons) : 0) }, 0)
  const itemTons = m.mounts.reduce((s, x) => { const it = W.get(x.item) ?? EQ.get(x.item); return s + (it ? (it.tons === 'perMech' ? x.tons ?? 0 : it.tons) : 0) }, 0) - sinkMountTons
  const sinkTons = Math.max(0, m.heatSinks.count - 10) // the first 10 sinks ride in the engine weight; each further one is 1 t, integral or not
  const points = Object.values(m.armor.front).reduce((s, v) => s + v, 0) + Object.values(m.armor.rear).reduce((s, v) => s + v, 0)
  const mult = m.armor.type === 'ferroFibrous' ? (aTb === 'IS' ? 1.12 : 1.2) : 1
  const armorTons = Math.ceil((points / (16 * mult)) * 2) / 2
  const structTons = Math.ceil(m.tonnage * (m.structure.type === 'endoSteel' ? 0.05 : 0.1) * 2) / 2
  const ammoTons = m.ammoBins.reduce((s, b) => s + (b.load === 'half' ? 0.5 : 1), 0)
  const engTons = engineTons(m.engine.type, m.engine.rating)
  if (engTons === undefined) { c.err(id, `tonnage audit: no weight for ${m.engine.type} engine rating ${m.engine.rating}`); return }
  const total = 3 + Math.ceil(m.engine.rating / 100) + structTons + armorTons + itemTons + ammoTons + engTons + sinkTons
  c.log(`${id}: tonnage audit: ${total.toFixed(1)} t of ${m.tonnage} t (engine ${engTons}, extra sinks ${sinkTons})`)
  if (Math.abs(total - m.tonnage) > 1e-6) c.err(id, `tonnage audit: parts weigh ${total} t, chassis is ${m.tonnage} t`)
}

// Standard fusion engine weight by rating, from the AGoAC Engine Table (the text extract runs one row low against
// the printed ratings; checked against 250 = 12.5 t, 300 = 19 t, 400 = 52.5 t). Index i is rating 100 + 5 * i.
const STD_ENGINE_TONS = [3.0, 3.5, 3.5, 4.0, 4.0, 4.0, 4.5, 4.5, 5.0, 5.0, 5.5, 5.5, 6.0, 6.0, 6.0, 7.0, 7.0, 7.5, 7.5, 8.0, 8.5, 8.5,
  9.0, 9.5, 10.0, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.5, 16.0, 16.5, 17.5, 18.0, 19.0, 19.5, 20.5, 21.5,
  22.5, 23.5, 24.5, 25.5, 27.0, 28.5, 29.5, 31.5, 33.0, 34.5, 36.5, 38.5, 41.0, 43.5, 46.0, 49.0, 52.5]
// Engine type factors; the result rounds up to a half ton.
export function engineTons(type: string, rating: number): number | undefined {
  const std = STD_ENGINE_TONS[(rating - 100) / 5]
  if (std === undefined) return undefined
  const f: Record<string, number> = { standard: 1, xl: 0.5, light: 0.75, xxl: 1 / 3, compact: 1.5 }
  const k = f[type]
  return k === undefined ? undefined : Math.ceil(std * k * 2 - 1e-9) / 2
}

// ---------------------------------------------------------------- maps
function checkMap(m: GameMap, MAP: Map<string, GameMap>, c: Ctx): void {
  const id = m.id
  if (m.hexes && m.sheets) c.err(id, 'hexes and sheets are exclusive')
  if (m.sheets) {
    for (const s of m.sheets) {
      const t = MAP.get(s.map)
      if (!t) c.err(id, `sheet ${s.map} does not exist`)
      else if (t.sheets) c.err(id, `sheet ${s.map} must be a single sheet`)
      if (s.col % 2 !== 0) c.err(id, 'sheet col must be even')
    }
    return
  }
  const hexes = m.hexes ?? {}
  const road = (label: string): number[] | undefined => (hexes[label]?.terrain ?? []).find((t) => t.type === 'road') ? ((hexes[label]!.terrain!.find((t) => t.type === 'road') as { exits: number[] }).exits) : undefined
  const dirs: Record<number, [number, number]> = { 0: [0, -1], 1: [1, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 1], 5: [-1, 0] }
  for (const [label, h] of Object.entries(hexes)) {
    const col = Number(label.slice(0, 2)); const row = Number(label.slice(2))
    if (col < 1 || col > m.width || row < 1 || row > m.height) { c.err(id, `hex ${label} outside ${m.width}x${m.height}`); continue }
    const types = (h.terrain ?? []).map((t) => t.type)
    for (const t of types) if (RESERVED_TERRAIN.has(t)) c.err(id, `UNSUPPORTED_TERRAIN ${t} at ${label}`)
    const woods = types.filter((t) => t === 'lightWoods' || t === 'heavyWoods' || t === 'foliage').length
    const ground = types.filter((t) => ['rough', 'rubble', 'pavement', 'sand', 'mud', 'swamp', 'snow'].includes(t)).length
    if (woods > 1) c.err(id, `hex ${label}: more than one woods feature`)
    if (ground > 1) c.err(id, `hex ${label}: more than one ground feature`)
    if (types.includes('water') && (woods || ground || types.includes('road') || types.includes('building'))) c.err(id, `hex ${label}: water excludes woods, ground features, road and building`)
    if (types.includes('road') && ground && !types.includes('pavement')) c.err(id, `hex ${label}: road may only share a hex with pavement`)
    const exits = road(label)
    if (exits) {
      // neighbour via odd-q offset (0-based odd columns sit lower)
      const c0 = col - 1; const r0 = row - 1
      for (const f of exits) {
        const [dq, dr] = dirs[f]!
        const q = c0 + dq
        const axR = r0 - (c0 - (c0 & 1)) / 2 + dr
        const nr = axR + (q - (q & 1)) / 2
        if (q < 0 || q >= m.width || nr < 0 || nr >= m.height) continue
        const nl = `${String(q + 1).padStart(2, '0')}${String(nr + 1).padStart(2, '0')}`
        const back = road(nl)
        if (!back || !back.includes((f + 3) % 6)) c.err(id, `hex ${label}: road exit ${f} has no matching road at ${nl}`)
      }
    }
  }
  const dl = m.defaultLevel ?? 0
  const levels = new Map<number, number>()
  for (let x = 1; x <= m.width; x++) for (let y = 1; y <= m.height; y++) {
    const lv = hexes[`${String(x).padStart(2, '0')}${String(y).padStart(2, '0')}`]?.level ?? dl
    levels.set(lv, (levels.get(lv) ?? 0) + 1)
  }
  c.log(`${id}: ${m.width * m.height} hexes, levels ${[...levels.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`)
}

// ---------------------------------------------------------------- missions
function checkMission(
  m: Mission, MAP: Map<string, GameMap>, FORCE: Map<string, Force>, MECH: Map<string, Mech>, PILOT: Map<string, Pilot>,
  ds: Dataset, c: Ctx, hooks: Set<string>,
): void {
  const id = m.id
  const [a, b] = m.sides
  if (a.id === b.id) c.err(id, 'side ids must differ')
  const opp: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' }
  if (opp[a.homeEdge] !== b.homeEdge) c.err(id, 'home edges must be opposite')
  if (m.defaultHumanSide && ![a.id, b.id].includes(m.defaultHumanSide)) c.err(id, 'defaultHumanSide is not a side')
  const maps: string[] = m.map === 'choose' ? (m.mapChoices ?? []) : [m.map]
  for (const mid of maps) if (!MAP.has(mid)) c.err(id, `map ${mid} does not exist`)
  for (const s of m.sides) {
    if (s.force !== 'pick') {
      const f = FORCE.get(s.force)
      if (!f) c.err(id, `force ${s.force} does not exist`)
      else {
        let total = 0
        for (const u of f.units) {
          const mech = MECH.get(u.mech)
          if (!mech) continue
          const sk = u.skills ?? (u.pilot ? PILOT.get(u.pilot) : undefined) ?? { gunnery: 4, piloting: 5 }
          total += adjustedBv(ds.tables, mech.bv, sk.gunnery, sk.piloting)
        }
        if (m.options.bvBudget !== undefined && total > m.options.bvBudget) c.err(id, `force ${f.id} BV ${total} exceeds mission budget`)
      }
    }
    for (const mid of maps) {
      const map = MAP.get(mid)
      if (!map || map.sheets) continue
      const d = s.deployment
      if (d.mode === 'hexes') for (const h of d.hexes) if (!map.hexes?.[h] && !(Number(h.slice(0, 2)) >= 1 && Number(h.slice(0, 2)) <= map.width && Number(h.slice(2)) >= 1 && Number(h.slice(2)) <= map.height)) c.err(id, `deployment hex ${h} not on ${mid}`)
      if (d.mode === 'edgePlace') {
        const span = s.homeEdge === 'north' || s.homeEdge === 'south' ? map.height : map.width
        if (d.depth >= span / 2) c.err(id, 'edgePlace depth must be under half the map')
      }
      // entry: some edge hex that is clear / road / pavement
      const edge: string[] = []
      for (let x = 1; x <= map.width; x++) for (let y = 1; y <= map.height; y++) {
        const onEdge = (s.homeEdge === 'north' && y === 1) || (s.homeEdge === 'south' && y === map.height) || (s.homeEdge === 'west' && x === 1) || (s.homeEdge === 'east' && x === map.width)
        if (onEdge) edge.push(`${String(x).padStart(2, '0')}${String(y).padStart(2, '0')}`)
      }
      const ok = edge.some((l) => (map.hexes?.[l]?.terrain ?? []).every((t) => t.type === 'road' || t.type === 'pavement'))
      if (!ok) c.err(id, `no cheap entry hex on the ${s.homeEdge} edge of ${mid}`)
    }
  }
  for (const v of m.victory) {
    if (v.type === 'turnLimitBV' && m.turnLimit === undefined && m.kind !== 'skirmish') c.err(id, 'turnLimitBV needs turnLimit or kind skirmish')
    if (v.type === 'objective' && !hooks.has(v.hook)) c.warn(id, `objective hook ${v.hook} not registered`)
  }
}

// ---------------------------------------------------------------- prose
function proseScan(records: [string, unknown][], c: Ctx): void {
  if (!fs.existsSync(SOURCES)) return
  const norm = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const N = 12
  const shingles = new Set<string>()
  for (const f of fs.readdirSync(SOURCES)) {
    if (!f.endsWith('.txt')) continue
    const w = norm(fs.readFileSync(path.join(SOURCES, f), 'utf8'))
    for (let i = 0; i + N <= w.length; i++) shingles.add(w.slice(i, i + N).join(' '))
  }
  for (const [id, rec] of records) {
    for (const [p, s] of strings(rec)) {
      const w = norm(s)
      for (let i = 0; i + N <= w.length; i++) {
        if (shingles.has(w.slice(i, i + N).join(' '))) { c.err(id, `prose at ${p} matches a rules source for ${N} words`); break }
      }
    }
  }
}

// ---------------------------------------------------------------- cli
export function main(): number {
  const rep = validateDataset(loadDataset())
  for (const l of rep.logs) console.log('  ' + l)
  for (const w of rep.warnings) console.warn('WARN  ' + w)
  for (const e of rep.errors) console.error('ERROR ' + e)
  console.log(`validate-data: ${rep.errors.length} errors, ${rep.warnings.length} warnings`)
  return rep.errors.length ? 1 : 0
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
