// M7 polish backlog (owner-independent work while the figure gate and the audio key wait).
// Workflow({ scriptPath: 'tools/workflows/w7-polish.js' })
export const meta = {
  name: 'w7-polish',
  description: 'WarMechForge M7: remaining equipment rules, AI for the full roster + overlays, client polish, playtest pass',
  phases: [
    { title: 'Build', detail: 'equipment hooks; AI roster + threat/trace overlays; client polish' },
    { title: 'Playtest', detail: 'adversarial play-through as a new player, findings' },
    { title: 'Ship', detail: 'fix findings, gates, e2e, commit, push' },
  ],
}

const ROOT = 'C:/Users/antho/OneDrive/Documents/WarMechForge/warmechforge'
const ATTR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'summary', 'files', 'issues'] }
const FINDINGS = { type: 'object', properties: { ok: { type: 'boolean' }, findings: { type: 'array', items: { type: 'object', properties: { owner: { type: 'string', enum: ['engine', 'ai', 'client'] }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['owner', 'severity', 'where', 'problem', 'fix'] } } }, required: ['ok', 'findings'] }

const COMMON = `Project root: ${ROOT} (git repo, main, remote github.com/dragoonant/warmechforge, Pages live). Windows; absolute paths, the cwd resets. Run long commands in the FOREGROUND. Orient from ${ROOT}/STATUS.md and HANDOFF.md, then only the spec sections named and the follow-up files tools/out/m0-followups.md and tools/out/m5-followups.md (sections for your package). Game: BattleTech Classic (2026 Core Rules) vs AI. Engine contracts frozen (additive only, logged in docs/spec/00-architecture.md §14). The engine owns every number the UI shows. IP: names fine, all prose ours, no Catalyst/HBS art or layouts. Concurrent agents share the tree: touch only files you own, never git commit or npm install unless told. Rulings: "RULING: rule | what we did | why" in issues. Final output is raw JSON.`

phase('Build')
const build = await parallel([
  () => agent(`${COMMON}
Package WP-CORE equipment. You own src/engine/** (except src/engine/index.ts signatures: additive only), src/data/core/** (code hook fields only), tests/engine/**, docs/spec/10-rules-core.md, docs/spec/12-rules-test-checklist.md.
Implement, with checklist rows and tests proving each hook fires in a real game (validate-data must show every referenced hook registered and wired): PPC capacitor (charge declared in a turn, fires with +5 damage next turn per 10-rules-core/TO rules; 2026 W23: a roll of 2 no longer burns it out; heat per the rules), coolant pod (one-shot heat dissipation boost, explosion behaviour as component explosion), Clan MASC (activation before movement, boosted run MP, Escalating Failure per 2026 W4 with avoid numbers 3,5,7,10,11 and per-turn step-down), Ultra AC rapid fire (two shots, 2026 W11: no jams), RAC rate of fire + jam per 2026 W10 (unjam in Movement Phase), Beagle active probe (only the 2026 effects that apply to the v1 rules, e.g. negating smoke later: a no-op with a note is fine), partial wing (jump MP / heat effects per data notes). Any still-missing hook from tools/out/m5-followups.md for data in src/data.
Also: the chooseAmmo option labels at src/engine/machine.ts (around line 538) should use ammoLabel from describe.ts; UnitDisplaced.cause gains 'stacking' (additive, §14); update 10/12 MOVE-012 for the involuntary-stacking exception.
Run npm run typecheck, npm test, npm run validate:data, npm run sim -- --games 30 --seed 6. Return JSON: ok, summary (<=80 words), files, issues.`, { label: 'engine:equipment', phase: 'Build', schema: RESULT, effort: 'high' }),
  () => agent(`${COMMON}
Package WP-AI. You own src/ai/**, tools/ai-bench.ts, tests/ai/**, src/client/bot/**, and the NEW client files src/client/interaction/ThreatOverlay.tsx and src/client/ui/AiTrace.tsx (export components; the client agent mounts them).
1. Make the normal AI play well with the full 16-variant roster on all 4 Core Box maps: ammo-type choices (LB-X slug vs cluster by range/target armor, MML LRM vs SRM), Gauss/ammo explosion risk on damaged locations, ECM vs Artemis, jump-heavy units (Solitaire Prime, Uziel, Mad Cat Mk II), elevation and woods use on Sodden Hills/Arid Canyons, forced withdrawal awareness if the mission uses it. Use the engine's new hooks when the engine agent lands them (read their files later in your run; if not there, skip).
2. Improve normal vs easy (currently 12/20) toward >= 15/20 without losing normal vs random >= 18/20.
3. ThreatOverlay.tsx: toggled by 'T' / a button: for the hovered or selected hex, which enemy weapons can reach it next turn (engine query.threat), drawn as tinted hexes with expected damage; AiTrace.tsx: a small collapsible panel showing the bot's top-3 scored options for its last decision (the decider already returns a trace).
4. tools/ai-bench.ts: add --map and --forces sweeps; run: npm run bench:ai -- --games 20 --seed 1 (intro), plus 10 games each on sodden-hills and arid-canyons with Regent Lance vs Mad Cat Lance. Report win rates, p95 ms (< 300 ms), 0 rejections/stalls/fallbacks.
Return JSON: ok, summary (<=100 words incl bench), files, issues.`, { label: 'ai:roster', phase: 'Build', schema: RESULT, effort: 'high' }),
  () => agent(`${COMMON}
Package WP-CLIENT polish. You own src/client/** EXCEPT src/client/bot/**, src/client/interaction/ThreatOverlay.tsx, src/client/ui/AiTrace.tsx; plus tests/client/**, tests/e2e/**, src/data/missions/intro.json (briefing text only).
Read docs/spec/50-client.md and the WP-CLIENT/WP-FIG sections of the follow-up files. Do:
- Mount ThreatOverlay and AiTrace (from the AI agent; if missing when you start, mount behind a lazy import guarded for absence and re-check at the end) with a 'T' key and a toolbar toggle.
- Auto-camera: smoothly frame the acting unit and its target during bot moves and attacks (setting: Follow action on/off), never fighting the player's own camera input.
- End screen: damage per location per 'Mech (paper-doll mini sheets), kills, heat peaks, cause of victory, Play again / Rematch with same forces / Back to setup.
- How to Play: add tabs or sections for the equipment now in the data (LB-X ammo, Ultra AC, Gauss explosions, PPC capacitor, MASC, ECM vs Artemis, targeting computer, ferro-lamellor) in our own words, and the Skirmish picker.
- Hover tooltips on record-sheet entries (weapons: ranges/heat/damage; crit slots; heat-scale rows).
- Water seams softer (the M3 known gap), and 'Mech figures slightly larger relative to hexes if they read too small at the default camera (judge from a screenshot).
- Intro briefing text: the intro now plays on Scorched Oasis (an oasis with water and scattered woods, not a canyon); rewrite the briefing in our own words.
- Low graphics setting audit: shop off, shadows off, trees simplified; check ?fps on the default camera stays smooth.
Run typecheck, npm test, and PW_PORT=4183 npx playwright test. Take e2e-out/polish-*.png (end screen, threat overlay, tooltip, how-to) and Read them. Return JSON: ok, summary (<=100 words), files (incl. screenshots), issues.`, { label: 'client:polish', phase: 'Build', schema: RESULT, model: 'sonnet' }),
])

phase('Playtest')
const play = await agent(`${COMMON}
Task: ADVERSARIAL PLAYTEST as a brand-new player who knows BattleTech tabletop but not this app. Do not edit code. Build and preview the app (npm run build && npx vite preview --port 4190 --strictPort, with base /warmechforge/; or reuse the Playwright webServer config) and drive it with Playwright scripts you write in C:/Users/antho/OneDrive/Documents/WarMechForge/warmechforge/tools/out/pw/ (not committed): play the intro mission vs Normal AI for at least 6 turns and one Skirmish (Regent Lance vs Mad Cat Lance on Sodden Hills) for at least 4 turns, through the real UI. Take screenshots at every decision type and Read them. Report every place where: a number looks wrong vs BattleTech rules (check TN math, heat math, hit locations, damage transfer in the feed), the UI is confusing or hides what to do next, the game stalls or the AI does something absurd (walks into water for no reason, turns its back, overheats into shutdown needlessly), the board/shop/figures look broken, text is unclear or not in plain words. Severity blocker/major/minor; owner engine/ai/client; max 25 findings, most severe first.
Return JSON: ok, findings.`, { label: 'playtest', phase: 'Playtest', schema: FINDINGS, effort: 'high' })

phase('Ship')
const groups = {}
for (const f of (play ? play.findings : []).filter(f => f.severity !== 'minor' || true)) (groups[f.owner] = groups[f.owner] || []).push(f)
const OWN = { engine: 'src/engine/**, tests/engine/**, src/data/** (fixes only), docs/spec/10-rules-core.md, docs/spec/12-rules-test-checklist.md', ai: 'src/ai/**, tests/ai/**, src/client/bot/**, src/client/interaction/ThreatOverlay.tsx, src/client/ui/AiTrace.tsx', client: 'src/client/** except the AI-owned files, tests/client/**, tests/e2e/**' }
const fixes = await parallel(Object.keys(groups).filter(o => OWN[o]).map(o => () => agent(`${COMMON}
Task: fix these playtest findings (verify each first; reject wrong ones in issues; do blockers and majors first, minors if cheap): ${JSON.stringify(groups[o])}
You own ONLY: ${OWN[o]}. Run the relevant tests in the FOREGROUND.
Return JSON: ok, summary (<=60 words), files, issues.`, { label: `fix:${o}`, phase: 'Ship', schema: RESULT, model: 'sonnet' })))

const issues = [...build, ...fixes].filter(Boolean).flatMap(r => r.issues)
const rulings = issues.filter(s => s.startsWith('RULING'))
const ship = await agent(`${COMMON}
Task: land M7. You may edit any file in src/, tests/, tools/, docs/, STATUS.md, HANDOFF.md, CREDITS.md.
1. Gates: npm run typecheck, npm test, npm run validate:data, npm run sim -- --games 30 --seed 7 (0 violations), npm run bench:ai -- --games 20 --seed 1 (normal beats random >= 18/20, 0 rejections/stalls/fallbacks), PW_PORT=4183 npx playwright test (all specs). Fix minimal breakage.
2. Append rulings to docs/needs-rules-check.md (dedupe): ${JSON.stringify(rulings)}
3. Write unfixed findings/issues to tools/out/m7-followups.md by work package.
4. Update STATUS.md and HANDOFF.md (Current state + Next + Known gaps; keep the Morning summary block, appending one line summarising M7).
5. Stage by exact path (never sources-local, tools/out, e2e-out, docs/sources, PDFs, tokens, art/board-textures/preview.png); commit "M7: equipment rules, AI for the full roster, threat overlay, client polish" + blank line + "${ATTR}"; git pull --rebase; git push origin main; gh run watch the Pages run --exit-status.
Return JSON: ok, summary (<=100 words), files, issues.`, { label: 'ship:m7', phase: 'Ship', schema: RESULT, effort: 'high' })

const s = r => r && { ok: r.ok, summary: r.summary, issues: r.issues.slice(0, 6) }
return { build: build.map(s), playtest: play && play.findings.map(f => `${f.severity}/${f.owner}: ${f.problem}`).slice(0, 15), fixes: fixes.map(s), ship: s(ship) }
