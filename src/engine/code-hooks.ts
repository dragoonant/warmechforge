// Code-hook implementations (00 §11.4, 20 §12.2). Data names a hook with an item's `code` list (or an SPA's `hook`);
// hooks.ts builds its registry from CODE_HOOKS and core code reaches them only through collectHooks at the points in
// HOOK_WIRING. This file is plain data plus pure functions: it must not import hooks.ts at runtime (hooks.ts imports it).
// The rules themselves live in equipment.ts (10 §18); each hook here is the thin adapter for one hook point.
//
// Registered in release 1:
// - caseIIProtect (CASE II): the protection is read from the equipment kind by ammo.caseAt (explosion confined, crit check -1).
//   A crit on the CASE II slot itself just destroys it: `handled: false`.
// - ultraRapid (Ultra AC): no-op that never rolls; 2026 W11 removed Ultra AC jams. Called after every Ultra AC to-hit roll.
// - racJam (rotary AC): attackRolled jams the weapon on a low natural roll at 2+ shots; movement rolls the unjam (2026 W10).
//   No release-1 'Mech carries a RAC; the hook is registered and tested with a fixture weapon.
// - ppcCapacitor: attackDeclare refuses a shot from a PPC whose capacitor charges this turn; damage adds +5 to the shot of a PPC
//   charged last turn; attackRolled is the 2026 W23 no-op (a natural 2 no longer burns the capacitor out). The charge itself
//   (5 heat) is booked by the fire declaration (DeclareFireAction.charge).
// - coolantPod: heat adds one point of dissipation per operable sink in the turn it is vented; crit bursts an unused pod for 10.
// - masc: movement gives the walk x 2 run bonus and rolls the escalating-failure activation; endPhase steps the avoid number down.
// - partialWing: movement adds the jump bonus, heat the dissipation bonus (BattleMech Manual errata v7.01).
// - beagleProbe: setup no-op. The 2026 probe effects (negating smoke, hidden units) need rules release 1 does not have (M8).
// - guardianEcm: cluster reports -2 (Artemis IV bonus lost) when the attacker or target is inside its 6-hex bubble (EQUIP-015).
import type { CodeHook, HookContext, HookResult } from './hooks'
import type { DataBundle, Hex, UnitId } from './types'
import { distance } from './hex'
import {
  CAPACITOR_DAMAGE, COOLANT_POD_EXPLOSION, activateMasc, capacitorCharging, capacitorReady, coolantBonus, equipDeps,
  escalatingOf, escalatingStepDown, leadWing, mascRun, partialWingBonuses, podActive, podUsed, racJamThreshold, setJam, unjamRoll,
} from './equipment'

const same = (ctx: HookContext): HookResult => ({ state: ctx.state, events: [] })
const mountOf = (ctx: HookContext) => (ctx.mountId ? ctx.state.units[ctx.unitId]?.mounts[ctx.mountId] : undefined)
const query = (ctx: HookContext): string | undefined => ctx.params?.query as string | undefined

const caseIIProtect: CodeHook = {
  name: 'caseIIProtect',
  points: ['crit'],
  crit(_ctx: HookContext) {
    return { handled: false }
  },
}

const ultraRapid: CodeHook = {
  name: 'ultraRapid',
  points: ['attackRolled'],
  attackRolled: same,
}

const racJam: CodeHook = {
  name: 'racJam',
  points: ['attackRolled', 'movement'],
  attackRolled(ctx) {
    const shots = Number(ctx.params?.rapidShots ?? 1)
    if (!ctx.params?.rolled || !ctx.roll || !ctx.mountId) return same(ctx)
    if (ctx.roll.total > racJamThreshold(shots)) return same(ctx)
    return setJam(ctx.state, ctx.unitId, ctx.mountId, true)
  },
  movement(ctx) {
    if (query(ctx) !== 'unjam' || !ctx.mountId || !mountOf(ctx)?.jammed) return {}
    return { result: unjamRoll(ctx.state, ctx.unitId, ctx.mountId) }
  },
}

const ppcCapacitor: CodeHook = {
  name: 'ppcCapacitor',
  points: ['attackDeclare', 'attackRolled', 'damage'],
  attackDeclare(ctx) {
    const cap = mountOf(ctx)
    const charging = (ctx.params?.charging as string[] | undefined) ?? []
    if (cap && charging.includes(String(ctx.params?.weaponMountId))) return { reject: 'a PPC whose capacitor is charging cannot fire this turn' }
    return cap && capacitorCharging(ctx.state, cap) ? { reject: 'a PPC whose capacitor is charging cannot fire this turn' } : null
  },
  // 2026 [CL W23]: an attack roll of 2 with a charged PPC no longer burns the capacitor out; nothing happens here on purpose
  attackRolled: same,
  damage(ctx, amount) {
    const cap = mountOf(ctx)
    return cap && capacitorReady(ctx.state, cap) ? amount + CAPACITOR_DAMAGE : amount
  },
}

const coolantPod: CodeHook = {
  name: 'coolantPod',
  points: ['heat', 'crit'],
  heat(ctx) {
    const u = ctx.state.units[ctx.unitId]
    const m = mountOf(ctx)
    if (!u || !m || !podActive(ctx.state, u, m)) return {}
    return { dissipationDelta: coolantBonus(u) }
  },
  crit(ctx) {
    const m = mountOf(ctx)
    if (!m || m.destroyed || podUsed(m)) return { handled: false }
    const data = ctx.params?.data as DataBundle | undefined
    if (!data) return { handled: false }
    return { handled: true, result: equipDeps.explodeComponent(ctx.state, ctx.unitId, m.id, COOLANT_POD_EXPLOSION, data) }
  },
}

const masc: CodeHook = {
  name: 'masc',
  points: ['movement', 'endPhase'],
  movement(ctx) {
    const u = ctx.state.units[ctx.unitId]
    if (!u || !ctx.mountId) return {}
    const q = query(ctx)
    if (q === 'run') {
      const walk = Number(ctx.params?.walk ?? 0)
      const on = !!ctx.params?.requested || escalatingOf(u, ctx.mountId).usedThisTurn
      return on ? { mpBonus: mascRun(walk) - Math.ceil(1.5 * walk) } : {}
    }
    if (q === 'activate') {
      const data = ctx.params?.data as DataBundle
      const r = activateMasc(ctx.state, ctx.unitId, ctx.mountId, data)
      return { result: { state: r.state, events: r.events } }
    }
    return {}
  },
  endPhase(ctx) {
    return ctx.mountId ? escalatingStepDown(ctx.state, ctx.unitId, ctx.mountId) : same(ctx)
  },
}

const partialWing: CodeHook = {
  name: 'partialWing',
  points: ['movement', 'heat'],
  movement(ctx) {
    const u = ctx.state.units[ctx.unitId]
    if (!u || query(ctx) !== 'jump' || leadWing(u)?.id !== ctx.mountId) return {}
    // errata v7.01: no bonus without some jump MP of its own
    return Number(ctx.params?.jets ?? 0) > 0 ? { mpBonus: partialWingBonuses(u).jump } : {}
  },
  heat(ctx) {
    const u = ctx.state.units[ctx.unitId]
    if (!u || leadWing(u)?.id !== ctx.mountId) return {}
    return { dissipationDelta: partialWingBonuses(u).heat }
  },
}

const beagleProbe: CodeHook = {
  name: 'beagleProbe',
  points: ['setup'],
  setup: same,
}

const guardianEcm: CodeHook = {
  name: 'guardianEcm',
  points: ['cluster'],
  cluster(ctx) {
    const e = ctx.state.units[ctx.unitId]
    if (!e?.pos) return 0
    const attacker = ctx.params?.attackerId ? ctx.state.units[ctx.params.attackerId as UnitId] : undefined
    const targetHex = ctx.params?.targetHex as Hex | null | undefined
    const inside = (h: Hex | null | undefined): boolean => !!h && distance(e.pos!, h) <= 6
    return inside(attacker?.pos) || inside(targetHex) ? -2 : 0
  },
}

export const CODE_HOOKS: readonly CodeHook[] = [
  caseIIProtect, ultraRapid, racJam, ppcCapacitor, coolantPod, masc, partialWing, beagleProbe, guardianEcm,
]
