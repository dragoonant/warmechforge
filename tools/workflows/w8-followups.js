// M8a: M7 follow-ups. Workflow({ scriptPath: 'tools/workflows/w8-followups.js' })
export const meta = {
  name: 'w8-followups',
  description: 'WarMechForge M8a: player controls for capacitor/coolant/MASC/Ultra AC, ferro-lamellor in previews + AI, lance balance, Skirmish options, verify M7 playtest fixes',
  phases: [
    { title: 'Build', detail: 'client equipment controls + Skirmish options; engine/AI previews; data balance' },
    { title: 'Verify', detail: 'replay the M7 playtest majors in real play' },
    { title: 'Ship', detail: 'fixes, gates, e2e, commit, push' },
  ],
}

const ROOT = 'C:/Users/antho/OneDrive/Documents/WarMechForge/warmechforge'
const ATTR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'summary', 'files', 'issues'] }
const FINDINGS = { type: 'object', properties: { ok: { type: 'boolean' }, findings: { type: 'array', items: { type: 'object', properties: { owner: { type: 'string', enum: ['engine', 'ai', 'client', 'data'] }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['owner', 'severity', 'where', 'problem', 'fix'] } } }, required: ['ok', 'findings'] }

const COMMON = `Project root: ${ROOT} (git repo, main, Pages live). Windows; absolute paths, the cwd resets. Run long commands in the FOREGROUND. Orient from ${ROOT}/STATUS.md, HANDOFF.md and tools/out/m7-followups.md (your work package), then only the spec sections named. Game: BattleTech Classic (2026 Core Rules) vs AI. Engine contracts frozen (additive only, logged in docs/spec/00-architecture.md §14). The engine owns every number the UI shows. IP: all prose ours. ANOTHER WORKFLOW (audio) is concurrently editing src/client/audio/**, src/client/weaponFlavour.ts, src/client/presentation/director.ts, src/client/App.tsx, src/client/ui/SettingsPopover.tsx, public/audio/**, public/sounds.html, tools/*audio*: never touch those. Concurrent agents share the tree: touch only files you own, never git commit or npm install unless told. Rulings: "RULING: rule | what we did | why" in issues. Final output is raw JSON.`

phase('Build')
const build = await parallel([
  () => agent(`${COMMON}
WP-CLIENT. You own src/client/ui/** (except SettingsPopover.tsx), src/client/store/setup.ts, src/client/interaction/**, tests/client/** (except audio*), tests/e2e/**.
1. Player equipment controls (engine API listed in tools/out/m7-followups.md WP-CLIENT): in FirePanel a '2 shots' toggle per Ultra AC (rapidShots: 2) with the engine's preview odds/heat updating; a 'Charge' toggle per capacitor-linked PPC (DeclareFireAction.charge) explaining 'fires +5 damage next turn, +5 heat now, cannot fire this turn'; a 'Vent coolant pod' button with the projected heat before/after (coolantPod); in MovePanel a MASC chip in Run mode showing the avoid number and the extra MP from query.reachable(..., {masc}), with a plain-words risk note. Record sheet: capacitor charged, pod used, MASC avoid number, jammed weapons from SheetView.equipment.
2. Skirmish options: turn limit (none / 8 / 12 / 16), forced withdrawal on/off (11 §7), and an 'AI picks a force' button that fills the enemy side to within 10% of your side's BV from all data 'Mechs (deterministic by seed).
3. Make sure the six M7 playtest majors in the client are fixed (feed history built from events not current state; Continue keeps the feed; heat scale pilot-hit rows only where life support is hit per HEAT-025; twist prompt lists which enemies each choice brings into arc and warns before ending the ranged turn with no target); fix any that are not.
Run typecheck, your tests and PW_PORT=4183 npx playwright test. Take e2e-out/m8-*.png of each new control and Read them. Return JSON: ok, summary (<=100 words), files, issues.`, { label: 'client:controls', phase: 'Build', schema: RESULT, model: 'sonnet' }),
  () => agent(`${COMMON}
WP-ENGINE + WP-AI. You own src/engine/** (queries/previews; additive), src/ai/**, tests/engine/**, tests/ai/**, tools/ai-bench.ts, docs/spec/40-ai.md.
1. query.attackPreview / firePreview / physicalPreview apply ferro-lamellor (EQUIP-014) exactly as the damage pipeline does (expected damage per hit and per cluster group), with tests comparing preview expectation to a Monte Carlo of the real pipeline (2000 forced-seed trials, within 3%).
2. src/ai/damage.ts uses the corrected previews; update 40-ai tier table (normal heat cap 13, threat weight 1.3 as built).
3. Verify the two M7 AI majors are fixed in real games: no overkill on a helpless (prone, leg-destroyed or crippled) target while turning its back on a live threat; no moves into positions with no shot at anything when a shooting position was reachable. Build constructed positions as tests; fix the scoring if they fail.
4. Bench: npm run bench:ai -- --games 20 --seed 1 (normal >= 18/20 vs random, >= 15/20 vs easy, 0 rejections/stalls/fallbacks, p95 < 300 ms).
Return JSON: ok, summary (<=100 words incl bench), files, issues.`, { label: 'engine+ai', phase: 'Build', schema: RESULT, effort: 'high' }),
  () => agent(`${COMMON}
WP-DATA balance. You own src/data/forces/**, tests/data/forces*.test.ts, docs/spec/11-missions.md (Skirmish defaults only).
The Regent Lance preset beats the Mad Cat Lance about 85% of the time in easy-vs-easy mirrors. Rebalance the four lance presets (Eris, Solitaire, Regent, Mad Cat) so each pair is within 5% adjusted BV AND within ~55/45 in bench: use npm run bench:ai -- --forces <a>,<b> --games 16 --seed 3 with easy vs easy (both sides swapped) to measure; adjust by swapping variants and pilot skills (e.g. a 3/4 pilot on the weaker side), never by inventing stats. Record the final bench numbers in the preset notes.
Return JSON: ok, summary (<=80 words incl. per-matchup win rates), files, issues.`, { label: 'data:balance', phase: 'Build', schema: RESULT, model: 'sonnet' }),
])

phase('Verify')
const play = await agent(`${COMMON}
ADVERSARIAL PLAYTEST, do not edit code. Build and preview (npm run build && npx vite preview --port 4191 --strictPort) and drive it with Playwright scripts in ${ROOT}/tools/out/pw/ (not committed). Play the intro vs Normal AI for 6 turns and one Skirmish with the new options (turn limit 8, forced withdrawal on, 'AI picks a force') using the new equipment controls (Ultra AC 2 shots, PPC charge, coolant pod, MASC; pick 'Mechs that carry them: Regent A, Solitaire 2, Mad Cat Mk II 2 or others that do). Check specifically the M7 majors: feed history stays true after later moves; Continue keeps the feed; heat scale rows; twist prompt; AI overkill / no-shot moves. Report anything wrong vs the rules, confusing, stalled or broken; severity, owner engine/ai/client/data; max 20, most severe first.
Return JSON: ok, findings.`, { label: 'playtest', phase: 'Verify', schema: FINDINGS, effort: 'high' })

phase('Ship')
const groups = {}
for (const f of (play ? play.findings : [])) (groups[f.owner] = groups[f.owner] || []).push(f)
const OWN = { engine: 'src/engine/**, tests/engine/**', ai: 'src/ai/**, tests/ai/**', client: 'src/client/** except the audio-owned files listed above, tests/client/**, tests/e2e/**', data: 'src/data/**, tests/data/**' }
const fixes = await parallel(Object.keys(groups).filter(o => OWN[o]).map(o => () => agent(`${COMMON}
Fix these playtest findings (verify each first; reject wrong ones in issues; blockers and majors first): ${JSON.stringify(groups[o])}
You own ONLY: ${OWN[o]}. Run the relevant tests in the FOREGROUND.
Return JSON: ok, summary (<=60 words), files, issues.`, { label: `fix:${o}`, phase: 'Ship', schema: RESULT, model: 'sonnet' })))

const issues = [...build, ...fixes].filter(Boolean).flatMap(r => r.issues)
const rulings = issues.filter(s => s.startsWith('RULING'))
const ship = await agent(`${COMMON}
Land M8a. You may edit any non-audio file in src/, tests/, tools/ (not *audio*), docs/, STATUS.md, HANDOFF.md.
1. Gates: npm run typecheck, npm test, npm run validate:data, npm run sim -- --games 30 --seed 8 (0 violations), npm run bench:ai -- --games 20 --seed 1, PW_PORT=4183 npx playwright test. If a failure comes from the audio workflow's uncommitted files, report it and do not fix it.
2. Append rulings to docs/needs-rules-check.md (dedupe): ${JSON.stringify(rulings)}
3. Write unfixed items to tools/out/m8-followups.md by work package.
4. Update STATUS.md and HANDOFF.md (Current state + Next; keep the Morning summary, appending one M8a line).
5. Stage by exact path (only files this stage changed; never audio files, tools/out, e2e-out, docs/sources, PDFs, tokens); commit "M8a: equipment controls, Skirmish options, ferro-lamellor previews, lance balance" + blank line + "${ATTR}"; git pull --rebase; git push origin main; gh run watch the Pages run --exit-status.
Return JSON: ok, summary (<=100 words), files, issues.`, { label: 'ship:m8a', phase: 'Ship', schema: RESULT, effort: 'high' })

const s = r => r && { ok: r.ok, summary: r.summary, issues: r.issues.slice(0, 6) }
return { build: build.map(s), playtest: play && play.findings.map(f => `${f.severity}/${f.owner}: ${f.problem}`).slice(0, 12), fixes: fixes.map(s), ship: s(ship) }
