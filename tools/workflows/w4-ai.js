// M4 utility AI. Workflow({ scriptPath: 'tools/workflows/w4-ai.js' })
export const meta = {
  name: 'w4-ai',
  description: 'WarMechForge M4: utility AI (movement over reach set, heat knapsack, targeting, physicals) in a worker, tiers, bench vs random',
  phases: [
    { title: 'AI', detail: 'utility decider per 40-ai.md, worker, tiers, bench tool' },
    { title: 'Ship', detail: 'bench gate, sim, client wiring check, commit, push' },
  ],
}

const ROOT = 'C:/Users/antho/OneDrive/Documents/WarMechForge/warmechforge'
const WHIRR = 'C:/Users/antho/OneDrive/Documents/WarMForge/whirr-machine'
const ATTR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'summary', 'files', 'issues'] }

const COMMON = `Project root: ${ROOT} (git repo, main, remote github.com/dragoonant/warmechforge). Windows; absolute paths, the cwd resets. Run long commands (tests, sim, bench) in the FOREGROUND. Orient from ${ROOT}/STATUS.md and HANDOFF.md, then docs/spec/40-ai.md (fully) and the parts of 00-architecture.md about query.* (hypothetical-position queries §11.5). The engine owns every number: the AI uses query.* (reachable, attackPreview/firePreview, hitTable, clusterTable, heatProjection, physicalPreview, fallPreview, explosionPreview, threat) and the closed-form helpers in src/engine/prob.ts; never re-implement rules. Engine contracts are frozen (additive only, mirrored in 00 §14). Game: BattleTech Classic (2026 Core Rules); no Alpha Strike/HBS/MechWarrior-game ideas. Whirr Machine's AI (${WHIRR}/src/ai/{prob,worker,tiers}.ts, src/client/bot/{botDriver,aiWorkerClient}.ts) is a template for the worker + tier plumbing only. Stage commits by exact path, never git add -A. Rules ambiguities: follow the spec, list in issues ("RULING: rule | what we did | why"). Final output is raw JSON.`

phase('AI')
const ai = await agent(`${COMMON}
You own src/ai/**, tools/ai-bench.ts, tests/ai/**, src/client/bot/**, and may make minimal additive engine query fixes (src/engine/queries.ts and tests) if a query the AI needs is missing or wrong (log in 00 §14).
Build the utility decider implementing the engine Decider interface, per 40-ai.md:
- unit selection order in the movement phase (move the most threatened or least committed first when we lost initiative; hold the strongest shooters for last when we move last);
- movement: score every reachable (hex, facing, mode) entry: expected damage we can deal next ranged phase (best weapon set within the heat cap, against each enemy, using hypothetical attackPreview from that hex) minus expected damage taken (from each enemy's threat given its own reach and arcs), plus value for our TMM, woods/partial cover, rear-arc denial (never leave our rear exposed to an enemy that can reach it), getting into the enemy's rear arc, keeping LOS, heat after the move, PSR risk of the path, and staying on the map; facing that presents the strongest remaining armor to the main threat;
- torso twist to bring the most weapons to bear or protect damaged sides;
- ranged fire: heat knapsack over weapon/target pairs maximising expected damage (cluster expectations, hit-location focus on damaged locations, P(location destroyed) and kill probability) subject to the tier's heat cap (normal: end-of-turn heat <= 9 unless a kill shot is likely or the unit is about to die; never risk shutdown above an avoid roll of 8+ unless a kill shot), ammo choice per bin, secondary-target penalties, prefer finishing a cripple;
- physical attacks: kick/punch/push/charge/DFA chosen by expected damage vs own fall risk and the PSR the target must make;
- stand-up attempts, shutdown/startup choices, every other decision kind handled sensibly (fall back to the safest legal option, never an illegal one).
- Tiers: random (existing), easy (noise, heat cap 13, no threat model), normal (full). Each decision must take < 300 ms on this PC (sample/prune the reach set if needed) and run in a Web Worker (src/ai/worker.ts + src/client/bot/aiWorkerClient.ts) so the UI never blocks; the bot driver uses the selected tier (start screen selector; default normal) and falls back to the random bot on worker error.
- tools/ai-bench.ts ('npm run bench:ai -- --games N --seed S'): normal vs random and normal vs easy on the intro mission, sides alternated; print wins by cause, mean turns, mean and p95 ms per decision, rejections, stalls, fallbacks.
- Tests tests/ai/*.test.ts: never illegal across 5 seeded games; prefers a kill shot in a constructed position; respects the heat cap; does not turn its rear to an adjacent enemy in a constructed position.
Run npm run typecheck, npm test, npm run bench:ai -- --games 20 --seed 1 and iterate on src/ai until normal beats random >= 18/20 with 0 rejections, stalls or fallbacks.
Return JSON: ok, summary (<=100 words incl bench numbers), files, issues.`, { label: 'ai-decider', phase: 'AI', schema: RESULT, effort: 'high' })

phase('Ship')
const ship = await agent(`${COMMON}
Land M4. Run npm run typecheck, npm test, npm run validate:data, npm run sim -- --games 30 --seed 4 (zero violations), npm run bench:ai -- --games 20 --seed 1 (normal beats random >= 18/20, 0 rejections/stalls/fallbacks; if not, targeted fixes in src/ai, max 2 rounds). Then run the e2e (PW_PORT=4183 npx playwright test tests/e2e/play.spec.ts) to prove the client still plays against the normal bot without UI stalls (the bot answers within the watchdog), Read the midgame screenshot. Update STATUS.md (AI line) and HANDOFF.md (Current state + Next; keep the Morning summary block for the main agent). Stage by exact paths (src/ai src/client/bot src/engine tests tools/ai-bench.ts tools/workflows/w4-ai.js docs/spec docs/needs-rules-check.md STATUS.md HANDOFF.md package.json package-lock.json), commit "M4: utility AI in a worker with easy/normal tiers" + blank line + "${ATTR}", git pull --rebase, git push origin main, gh run watch the Pages run --exit-status.
Return JSON: ok, summary (<=80 words incl final bench), files, issues.`, { label: 'ai-ship', phase: 'Ship', schema: RESULT, effort: 'high' })

const s = r => r && { ok: r.ok, summary: r.summary, issues: r.issues.slice(0, 6) }
return { ai: s(ai), ship: s(ship) }
