// M1+M2 engine. Workflow({ scriptPath: 'tools/workflows/w1-engine.js', args: { stage: 'prep' } }) then 'found', then 'rules'.
// found: hex/LOS, combat math, heat/PSR/pilot, slice data -> verify (data + heat/crit/PSR) -> fix -> commit.
// rules: movement search, phases, physical, scenario -> integrate (index, random bot, sim, golden) -> commit + Pages.
export const meta = {
  name: 'w1-engine',
  description: 'WarMechForge M1+M2: rules engine modules, slice data, verify, integrate with random bot + headless sim (stage via args.stage)',
  phases: [
    { title: 'Foundations', detail: 'hex+LOS, to-hit/hitloc/cluster/damage/crits, heat/PSR/pilot, slice data' },
    { title: 'Verify', detail: 'adversarial check of rules-dense modules and data' },
    { title: 'Rules', detail: 'movement search, phases, physical attacks, scenario' },
    { title: 'Integrate', detail: 'index wiring, random bot, sim, golden, commit, push' },
  ],
}

const ROOT = 'C:/Users/antho/OneDrive/Documents/WarMechForge/warmechforge'
const ATTR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
const STAGE = (args && args.stage) || 'found'
const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'summary', 'files', 'issues'] }
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fail'] }, coverage: { type: 'object', properties: { covered: { type: 'number' }, total: { type: 'number' } } }, failing: { type: 'array', items: { type: 'object', properties: { owner: { type: 'string' }, where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['owner', 'where', 'problem', 'fix'] } }, notes: { type: 'string' } }, required: ['verdict', 'failing', 'notes'] }

const COMMON = `Project root: ${ROOT} (git repo, branch main, remote github.com/dragoonant/warmechforge). Windows; use absolute paths, the cwd resets. Run long commands (npm test, typecheck, sim) in the FOREGROUND. Orient from ${ROOT}/STATUS.md, then only the spec sections your task names (docs/spec/). Rules text extracts (gitignored, grep only, never quote at length): docs/sources/agoac-rulebook.txt (AGoAC rulebook), docs/sources/AGOAC-Reference-Card-7th-printing.txt, docs/sources/changelog.txt (2026 Core Rules changes; 2026 wins). docs/spec/10-rules-core.md is the authority; if it is wrong or silent, follow the sources and add "RULING: rule | what we did | why" to issues.
Edition leak guard: NO Alpha Strike values, NO HBS stability/evasion, NO ghost heat; 2026 removed skidding, fall-facing roll, ammo dumping, shutdown fall PSR; it is the "Ranged Attack Phase".
IP rule: names fine; ALL prose our own words; never copy rulebook text. Engine contracts src/engine/{types,actions,events,hooks,rng,decider,index}.ts are FROZEN: additive changes only when unavoidable, mirrored in docs/spec/00-architecture.md §14, noted in issues. roll(state, spec) is the only way to roll; never Math.random. The engine never imports src/data; a bundle is passed in. Concurrent agents share this tree: touch only files you own, never edit STATUS.md/package.json, never run git commit or npm install unless told. Prefer 'npx vitest run <your tests>' over the full suite. Name tests by checklist ID from docs/spec/12-rules-test-checklist.md (e.g. it('HEAT-014 ...')). Final output is raw JSON for an orchestrator.`
const LEAN = '\nLEAN MODE: playable prototype fast. Make it correct for the slice, ~10-15 focused tests on P1 checklist items, no exhaustive coverage.'

const commit = (msg, extra) => agent(`${COMMON}
Task: land this stage. ${extra || ''} Run 'npm run typecheck', 'npm test' and (if it exists) 'npm run validate:data' in the FOREGROUND; make minimal fixes if anything fails (never weaken a test without citing the spec in issues). Update STATUS.md (what exists / next). Stage by exact path (src/**, tests/**, tools/*.ts, tools/workflows/*.js, docs/spec/**, docs/needs-rules-check.md, STATUS.md, package.json, package-lock.json); confirm 'git status --short' shows nothing from docs/sources, tools/out, no PDFs or tokens staged. Commit "${msg}" + blank line + "${ATTR}"; git pull --rebase; git push origin main.
Return JSON: ok, summary (<=60 words), files, issues.`, { label: 'commit', phase: 'Integrate', schema: RESULT, model: 'sonnet' })
const rulingsOf = rs => rs.filter(Boolean).flatMap(r => r.issues).filter(s => s.startsWith('RULING'))
const s = r => r && { ok: r.ok, summary: r.summary, issues: r.issues.slice(0, 6) }

if (STAGE === 'prep') {
  phase('Foundations')
  const prep = await agent(`${COMMON}
Task: settle the open WP-CORE spec items BEFORE the engine fan-out. Read tools/out/m0-followups.md section "WP-CORE" (items 1-26) and apply every item to the specs and contracts: docs/spec/00-architecture.md, 10-rules-core.md, 12-rules-test-checklist.md, 13-golden.md, 11-missions.md (item 7 only), and src/engine/{types,actions,events,hooks,decider,index}.ts (this is the last pre-freeze window: additive or clarifying changes, logged in 00 §14).
Specifically: (1) cross-check every cluster-table row 2-20 against MegaMek (WebFetch the megamek source, e.g. https://raw.githubusercontent.com/MegaMek/megamek/main/megamek/src/megamek/common/compute/Compute.java or search the repo for clusterHitsTable; max 4 fetches) and fix 10 accordingly; (2) verify flat-topped column offset parity and the facing/arc conventions against MegaMek's Coords.java (raw GitHub) and state them unambiguously in 00 with 3 worked examples (label -> axial -> neighbour labels); (3) add the 40-ai §13 hypothetical-position queries to 00 and index.ts signatures; (4) make fire selection one composite action with hold-all always legal; (5) define ReachEntry.physical and MoveAction.attack; (6) the 00 §5.4/§7 rewrites and the 10 edits in items 13-26; (7) stand-attempt modifier: -1 per attempt is NOT cumulative (each attempt is -1) unless the AGoAC text clearly says otherwise. For owner questions (item 3), choose defender-favouring automatic and add a RULING.
Run 'npx tsc --noEmit' and 'npm test' (FOREGROUND). Then stage by exact path (docs/spec/**, src/engine/*.ts, tests/engine/*.ts, tools/workflows/*.js, docs/needs-rules-check.md) and commit "M1: settle pre-freeze spec items (cluster table, hex parity, AI queries, fire action)" + blank line + "${ATTR}"; git pull --rebase; git push origin main. Append any new RULING lines to docs/needs-rules-check.md before committing.
Return JSON: ok, summary (<=100 words), files, issues.`, { label: 'prep:wp-core', phase: 'Foundations', schema: RESULT, effort: 'high' })
  return { prep: s(prep) }
}

if (STAGE === 'found') {
  phase('Foundations')
  const FOUND = [
    { key: 'hex', spec: '00-architecture.md (coordinates, facing), 10-rules-core.md (HEX-, LOS-, ARC- sections)', own: 'src/engine/hex.ts, src/engine/los.ts, src/engine/terrain.ts, tests/engine/hex*.test.ts, tests/engine/los*.test.ts, tests/engine/arc*.test.ts', task: 'axial/cube <-> XXYY for flat-topped mapsheets, neighbours, distance, hex lines with divided-line detection (memoized by hex pair), arcs by facing incl. torso twist and arm arcs, attack direction from the attacker position relative to the target facing, LOS with levels, woods points, water, partial cover, returning a verdict {visible, modifiers, reasons[], blockers[], partialCover}.', ids: 'HEX-*, LOS-*, ARC-*' },
    { key: 'combat', spec: '10-rules-core.md (TOHIT-, HITLOC-, CLUS-, DMG-, CRIT-, AMMO- sections), 00-architecture.md (damage pipeline event sequence)', own: 'src/engine/dice.ts, src/engine/tohit.ts, src/engine/hitloc.ts, src/engine/cluster.ts, src/engine/damage.ts, src/engine/crits.ts, src/engine/ammo.ts, src/engine/prob.ts, tests/engine/{dice,tohit,hitloc,cluster,damage,crit,ammo,prob}*.test.ts', task: 'roll helpers over rng.ts, to-hit target with a full modifier breakdown (each modifier {label, value}), exact P(2d6>=T), hit location tables per direction + punch/kick tables, cluster hits table, the ONE damage pipeline (armor -> internal -> transfer -> crit check -> slot roll -> effect -> ammo/component explosion chain with 2026 caps, CASE/CASE II), destruction checks, 20-damage-per-phase PSR trigger bookkeeping, closed-form helpers (hit-location distribution, expected cluster hits) for UI and AI. Damage is accumulated for end-of-phase application per the phase machine in 00-architecture.', ids: 'TOHIT-*, HITLOC-*, CLUS-*, DMG-*, CRIT-*, AMMO-*' },
    { key: 'heat', spec: '10-rules-core.md (HEAT-, PSR-, PILOT- sections), 00-architecture.md (heat ledger, PSR queue)', own: 'src/engine/heat.ts, src/engine/psr.ts, src/engine/pilot.ts, tests/engine/{heat,psr,pilot}*.test.ts', task: 'the ONE heat ledger (movement, weapons, engine crits, dissipation by sink type and destroyed sinks), heat-scale effects (MP loss, to-hit, shutdown/startup avoid rolls, ammo explosion avoid, life-support pilot damage), heat projection helper for the UI; the ONE PSR queue (enqueue with trigger + modifiers, resolve at phase end, fall resolution: damage by tonnage and levels in 5-point groups, rear on 1d6=1, prone, seatbelt check per 2026); pilot hits, consciousness once per phase with the highest avoid number, recovery, death at 6 hits.', ids: 'HEAT-*, PSR-*, PILOT-*' },
    { key: 'data', spec: '20-data-schema.md + docs/spec/schemas/*, 11-missions.md, 70-maps.md; variant research in tools/out/variant-research.md if present; brief docs/BATTLETECH-HANDOFF.md lines 1003-1046 (stock stats)', own: 'src/data/**, tools/validate-data.ts, tests/data/*.test.ts, docs/spec/mechs-sources.md', task: 'enter every weapon/equipment/ammo the 4 slice Mechs need (Eris ERS-2N, Uziel UZL-2S, Solitaire: the box variant if fully sourced in variant-research.md else Prime labelled "(stock)", Rakshasa: MDG-3D if fully sourced else MDG-1A labelled "(stock)"), with exact numbers (cross-check MegaMek mm-data equipment/MTF via WebFetch, max 5 fetches, never commit their files); the 4 Mechs with full crit slot tables (cross-check the MTF files at https://raw.githubusercontent.com/MegaMek/mm-data/main/data/mekfiles/meks/...); 4 generic pilots at 4/5; one desert map for the slice (procedural canyon-like 15x17 per 70-maps.md if no transcription); the intro mission + a Skirmish mission; tools/validate-data.ts (ajv over the schemas, cross-reference ids, crit slot counts, armor <= max for tonnage, tonnage sum check where feasible, leak-key scan for stability/evasion/skid/ghostHeat) wired as npm run validate:data (it already exists in package.json scripts); src/data/index.ts loadBundle(). Each mech value carries source; docs/spec/mechs-sources.md lists sources and gaps.', ids: '(data validity), EQUIP-*' },
  ]
  const found = await parallel(FOUND.map(m => () => agent(`${COMMON}
Read spec: ${m.spec}. Build: ${m.task}
You own ONLY: ${m.own}. Checklist IDs: ${m.ids}.${LEAN}
Return JSON: ok, summary (<=80 words), files, issues.`, { label: `impl:${m.key}`, phase: 'Foundations', schema: RESULT, model: 'sonnet' })))

  phase('Verify')
  const VER = [
    { key: 'rules', files: 'src/engine/{tohit,hitloc,cluster,damage,crits,ammo,heat,psr,pilot}.ts and their tests', what: 'every table and number vs docs/spec/10-rules-core.md AND the sources (hit location tables, cluster table, heat scale, crit chances and effects incl. 2026 values, ammo explosion caps, PSR modifiers, fall damage, consciousness avoid numbers); damage transfer and destruction order; tests that assert wrong numbers' },
    { key: 'data', files: 'src/data/** and tools/validate-data.ts', what: 'every weapon number (damage, heat, min/short/medium/long, slots, tons, ammo/ton) and every Mech value (armor per location, internal structure by tonnage, MP, heat sinks, weapon locations, crit slots) vs MegaMek mm-data MTF/equipment (WebFetch, max 6) and the brief stock stats; flag unsourced values' },
  ]
  const verdicts = await parallel(VER.map(v => () => agent(`${COMMON}
Task: ADVERSARIAL verification, do not edit. Check ${v.files}: ${v.what}. Default to fail when unsure. Owner of each failing item: 'combat' (tohit/hitloc/cluster/damage/crits/ammo), 'heat' (heat/psr/pilot), 'hex', or 'data'. Max 20 failing items, most severe first.
Return JSON: verdict, coverage, failing, notes (<=60 words).`, { label: `verify:${v.key}`, phase: 'Verify', schema: VERDICT, effort: 'high' })))
  const byOwner = {}
  for (const v of verdicts.filter(Boolean)) for (const f of v.failing) (byOwner[f.owner] = byOwner[f.owner] || []).push(f)
  const ownOf = Object.fromEntries(FOUND.map(m => [m.key, m.own]))
  const fixes = await parallel(Object.keys(byOwner).filter(o => ownOf[o]).map(o => () => agent(`${COMMON}
Task: fix these verified problems (check each against spec + sources first; reject wrong ones in issues): ${JSON.stringify(byOwner[o])}
You own ONLY: ${ownOf[o]}. Run your tests in the FOREGROUND.
Return JSON: ok, summary (<=60 words), files, issues.`, { label: `fix:${o}`, phase: 'Verify', schema: RESULT, model: 'sonnet' })))
  const rul = rulingsOf([...found, ...fixes])
  const c = await commit('M1: hex geometry, LOS, combat math, damage/crits, heat/PSR/pilot, slice data', rul.length ? `First append these lines to docs/needs-rules-check.md (dedupe): ${JSON.stringify(rul)}` : '')
  return { found: found.map(s), verdicts: verdicts.map(v => v && { verdict: v.verdict, n: v.failing.length, notes: v.notes }), fixes: fixes.map(s), commit: s(c) }
}

if (STAGE === 'rules') {
  phase('Rules')
  const RULES = [
    { key: 'movement', spec: '10-rules-core.md (MOVE-, PSR triggers from movement, deployment), 00-architecture.md (query.reachable)', own: 'src/engine/movement.ts, src/engine/phases/movement.ts, src/engine/deploy.ts, tests/engine/{move,deploy}*.test.ts', task: 'Dijkstra over (hex, facing) states per mode (walk/run/jump/backward), MP after heat and damage, terrain and level costs (2026 water), prohibited moves, standing up (2026 -1 PSR, no heat), passing immobile enemies, the exported reachable set {hex, facing, mode, mpUsed, path, heat, tmm, psrs[]}; the movement phase decision flow (choose unit, path, final facing) and edge-entry deployment. Uses hex.ts/terrain.ts/psr.ts/heat.ts (read, do not edit).', ids: 'MOVE-*, SCN- (deployment)' },
    { key: 'combat-phases', spec: '10-rules-core.md (INIT-, ranged attack phase, PHYS-), 00-architecture.md (phase machine, simultaneous damage windows)', own: 'src/engine/initiative.ts, src/engine/phases/initiative.ts, src/engine/phases/ranged.ts, src/engine/phases/physical.ts, src/engine/physical.ts, tests/engine/{init,ranged,phys}*.test.ts', task: 'initiative (2d6, ties, 2026 front-loaded unequal numbers), ranged attack phase (declare per unit in order: torso twist, weapons + targets incl. secondary targets and ammo choice; resolve with tohit/hitloc/cluster/damage; damage applied at phase end; PSRs resolved at phase end), physical attack phase (punch/kick/charge/DFA/push legality, to-hit, damage, PSRs, displacement at end of turn). Uses the foundation modules (read, do not edit).', ids: 'INIT-*, TOHIT- (flow), PHYS-*' },
    { key: 'endturn', spec: '10-rules-core.md (HEAT phase, END phase, SCN-, victory, forced withdrawal), 11-missions.md', own: 'src/engine/phases/heat.ts, src/engine/phases/end.ts, src/engine/scenario.ts, src/engine/victory.ts, tests/engine/{phase-heat,end,scenario,victory}*.test.ts', task: 'heat phase (apply ledger, shutdown/startup, ammo explosion avoid, pilot heat damage), end phase (displacement, consciousness recovery, cleanup, turn advance), mission setup from mission data, victory checks (destroyed/crippled/objectives, optional forced withdrawal), game-over event.', ids: 'HEAT- (phase), SCN-*' },
  ]
  const rules = await parallel(RULES.map(m => () => agent(`${COMMON}
Read spec: ${m.spec}. Read STATUS.md for the foundation modules that exist. Build: ${m.task}
You own ONLY: ${m.own}. Checklist IDs: ${m.ids}.${LEAN}
Return JSON: ok, summary (<=80 words), files, issues.`, { label: `impl:${m.key}`, phase: 'Rules', schema: RESULT, model: 'sonnet' })))

  phase('Integrate')
  const integ = await agent(`${COMMON}
All engine modules now exist. You may edit ANY src/engine, src/ai, src/data, tests or tools file, STATUS.md, HANDOFF.md, package.json (npm install allowed).
0. Loose ends from the foundation stage: create src/engine/code-hooks.ts and make collectHooks work (every hook referenced in data registered AND called; a test per hook proving it fires); set fallDeps.applyDamage (psr.ts) and heatDeps.explodeAmmo (heat.ts) from damage/ammo; wire query.los/heatProjection/fallPreview; add ammo 'is.ammo.lrm-10-artemis' (12 shots/ton, explosionPerShot 10) to the data, list it on is.w.lrm-10, switch both Rakshasa bins to it and add linkedTo on the Artemis mount; dedupe docs/needs-rules-check.md so contradictory RULING lines on the same rule (consciousness timing; heat-explosion bin choice) keep only the one the code implements.
1. Wire src/engine/index.ts: createGame, step (exactly one PendingDecision after each step), legalActions (never empty for an open decision; feasibility = some candidate passes full validation), validate, save/load/replay, view, query.* (reachable set, attackPreview with modifier breakdown + odds, losVerdict, heatProjection, threat), describe.*.
2. 'npm run typecheck' and 'npm test' green.
3. src/ai/random.ts: a random-legal Decider that plays sensibly (moves toward enemies, fires weapons in arc/range while keeping heat below shutdown, kicks when adjacent) so a human can play a full game against it.
4. tools/sim.ts ('npm run sim -- --games N --seed S'): bot vs bot on the intro mission; invariants after every step (no NaN, armor/internal within bounds, heat >= 0, non-empty legalActions, phase order, exactly one pending); 5000-decision cap and 200-decision stall detector; save/load mid-game equality; replay determinism; print wins by cause, mean turns, violations with seed+index.
5. tests/engine/golden.test.ts: replay docs/spec/13-golden.md examples with forced dice (vi.mock of roll() with a FORCED map by roll sequence); it.skip with a reason only if a mechanic is genuinely missing (list in issues). tests/engine/action-fuzz.test.ts: seeded random play asserting a non-empty validating legal set.
6. 'npm run sim -- --games 50 --seed 1' must report zero violations and every game must end.
7. Update STATUS.md and HANDOFF.md (next: M3 playable client). Stage by exact path (never docs/sources, tools/out, PDFs, tokens); commit "M2: rules engine integrated, random bot, headless sim" + blank line + "${ATTR}"; git pull --rebase; git push origin main; gh run watch the Pages run.
Return JSON: ok, summary (<=120 words incl. sim stats), files, issues.`, { label: 'integrate+sim', phase: 'Integrate', schema: RESULT, effort: 'high' })
  const rul = rulingsOf([...rules, integ])
  const c = rul.length ? await commit('M2: record rulings', `Append these lines to docs/needs-rules-check.md (dedupe): ${JSON.stringify(rul)}. If nothing else changed, commit only that file.`) : null
  return { rules: rules.map(s), integrate: s(integ), commit: s(c) }
}

return { error: `stage ${STAGE} not written yet` }
