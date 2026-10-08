// Code-hook implementations (00 §11.4, 20 §12.2). Data names a hook with an item's `code` list (or an SPA's `hook`);
// hooks.ts builds its registry from CODE_HOOKS and core code reaches them only through collectHooks at the points in
// HOOK_WIRING. This file is plain data plus pure functions: it must not import hooks.ts at runtime (hooks.ts imports it).
//
// Registered in release 1:
// - caseIIProtect (CASE II, is.eq.case-ii): the protection itself is read from the equipment kind by ammo.caseAt (explosion
//   damage confined to the location, crit check -1). The hook answers the `crit` point when the CASE II slot itself takes a
//   crit: the item is simply destroyed (no special effect), so it reports `handled: false` and the normal effect applies.
// - ultraRapid: the 2026 rules removed Ultra AC jamming (W11), so this is a no-op that never rolls. No release-1 data names it;
//   it is registered so a future Ultra AC record that names it stays valid.
import type { CodeHook, HookContext } from './hooks'

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
  attackRolled(ctx: HookContext) {
    return { state: ctx.state, events: [] }
  },
}

export const CODE_HOOKS: readonly CodeHook[] = [caseIIProtect, ultraRapid]
