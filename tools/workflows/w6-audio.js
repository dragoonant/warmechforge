// M6 audio. Workflow({ scriptPath: 'tools/workflows/w6-audio.js', args: { music: false } })
// SFX + voice now (~2k credits); music only with args.music === true (owner OK needed: >5k credits).
export const meta = {
  name: 'w6-audio',
  description: 'WarMechForge M6: weapon flavour map, ElevenLabs SFX + narrator/cockpit voice, loudness trims, audio manager wiring, sounds.html (music opt-in)',
  phases: [
    { title: 'Tools', detail: 'port Whirr audio tools, manifest, weapon flavour map' },
    { title: 'Generate', detail: 'SFX + voice generation and trims || client audio manager and event wiring' },
    { title: 'Music', detail: 'only when args.music' },
    { title: 'Ship', detail: 'integrate, sounds.html, commit, push' },
  ],
}

const ROOT = 'C:/Users/antho/OneDrive/Documents/WarMechForge/warmechforge'
const WHIRR = 'C:/Users/antho/OneDrive/Documents/WarMForge/whirr-machine'
const TOKEN = 'C:/Users/antho/OneDrive/Documents/WarMechForge/Tokens.txt'
const ATTR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
const CEILING = (args && args.creditCeiling) || 52100 // account character_count must stay below this (25k budget from 27,120 used on 2026-10-08)
const MUSIC = !!(args && args.music)
const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'summary', 'files', 'issues'] }

const COMMON = `Project root: ${ROOT} (git repo, main, public on GitHub Pages at /warmechforge/). Windows; absolute paths, the cwd resets. Run long commands in the FOREGROUND. Orient from ${ROOT}/STATUS.md and docs/BATTLETECH-HANDOFF.md Part D.4 only (lines 442-512), plus files named. SECRET: the ElevenLabs key is in ${TOKEN} as one line EL=sk_... Load it only inside the same shell command: ELEVENLABS_API_KEY="$(sed 's/^EL=//' '${TOKEN}' | tr -d '\\r\\n ')" npx tsx tools/gen-audio.ts ... — NEVER echo, log, write or commit it. CREDIT CEILING: the account's character_count (GET https://api.elevenlabs.io/v1/user/subscription) must never exceed ${CEILING}; check before each batch and stop if it would. Another workflow is concurrently editing src/engine, src/ai, src/data, src/client/ui (FirePanel/MovePanel/start screen) and tests: touch only files you own, stage commits by exact path, never git add -A, never edit package.json except adding the @breezystack/lamejs devDependency. All prompts and narrator lines in our own words; never imitate MechWarrior/HBS sounds or the MechWarrior 'Betty' voice. Final output is raw JSON.`

phase('Tools')
const tools = await agent(`${COMMON}
You own: tools/gen-audio.ts, tools/compose-audio.ts, tools/measure-audio.ts, tools/audio-manifest.json, tools/audio-src/**, src/client/audio/manifest.ts, src/client/weaponFlavour.ts, tests/client/weaponFlavour.test.ts, public/sounds.html, package.json (devDependency @breezystack/lamejs only; npm install allowed for it).
1. Copy ${WHIRR}/tools/{gen-audio,compose-audio,measure-audio}.ts and ${WHIRR}/public/sounds.html; adapt paths/names (base path /warmechforge/). Keep the idempotent skip, per-run budget (RUN_BUDGET), CREDIT_CEILING env, --kind, --only, --dry.
2. tools/audio-manifest.json (mirrored by src/client/audio/manifest.ts) with ~60 items per brief D.4's BattleTech list: footsteps by weight class (light/medium/heavy/assault), torso-twist servo whine, jump-jet ignition/thrust/landing, fall crash, stand-up; one sound per weapon flavour (small/medium/large laser beams, ER laser crackle, pulse laser stutter, heavy laser thrum, X-pulse, PPC discharge, snub/light PPC, autocannon report, LB-X shotgun blast, Ultra AC double report, rotary AC roar, ProtoMech AC, Gauss capacitor whine + slug crack, LRM ripple salvo, SRM/Streak launch whoosh, MML, missile impact cluster, machine gun), physicals (punch, kick, charge impact, DFA), damage (armor clang, internal crunch, critical alarm stab, limb blown off, ammo explosion, engine breach, destroyed 'Mech big explosion + debris, cockpit hit sparks), heat (original heat-warning tone, shutdown power-down, startup power-up, coolant vent hiss), UI (click, 2d6 dice rattle, turn bell); narrator voice lines (Initiative, Movement phase, Ranged attacks, Physical attacks, Heat phase, Critical hit!, Ammunition explosion!, Shutdown!, 'Mech destroyed, Victory, Defeat) and a second cockpit-computer voice (calm synthetic female or male, original lines: 'Heat level critical', 'Reactor shutdown imminent', 'Armor breach', 'Weapon destroyed', 'Systems online'). Pick two ElevenLabs voices by listing /v1/voices (one gravelly narrator, one cool computer), model eleven_flash_v2_5. Prompt lessons: describe the mechanism, state exclusions ("no music, no voices"), promptInfluence 0.45-0.75, SFX 0.5-1.5 s, explosions 1.2-3 s, guns "single sharp report, fast attack". Music items (kind music, NOT generated now): title theme 75 s loopable, battle loop A and B 150 s, victory and defeat stingers 12 s, two candidates each (-a/-b); direction: gritty military-industrial orchestral, heavy synth bass, taiko and anvil percussion, low brass, driving machine pulse, no vocals, not imitating any BattleTech/MechWarrior soundtrack.
3. src/client/weaponFlavour.ts: map every weapon id in src/data/core/weapons.json to one flavour (longest slug match) and export the flavour list; a test fails if any weapon has no flavour.
4. public/sounds.html: grouped SFX / voice / music, one plays at a time, ids shown so the owner can name redos.
Return JSON: ok, summary (<=80 words incl. item counts, voice ids), files, issues.`, { label: 'audio-tools', phase: 'Tools', schema: RESULT, model: 'sonnet' })

phase('Generate')
const [gen, wire] = await parallel([
  () => agent(`${COMMON}
You own: public/audio/** (except public/audio/music/**), tools/audio-src/**, tools/audio-manifest.json (prompt edits only), src/client/audio/trims.ts.
1. Check the subscription; then generate all sfx and voice items (NOT music) with tools/gen-audio.ts --kind=sfx,voice and CREDIT_CEILING=${CEILING}.
2. npx tsx tools/measure-audio.ts on everything; target RMS 0.15-0.18, guns crest >= 8. Regenerate (edit prompt, delete the mp3, rerun) clips that are clearly wrong (silence, music in an SFX, voices where none wanted, gun with crest ~2): max 1 regen round. Write per-asset multipliers (<= 1) to src/client/audio/trims.ts as export const TRIMS: Record<string, number>.
3. Report credits used (subscription delta) and the account total.
Return JSON: ok, summary (<=80 words incl. credits used and total), files, issues.`, { label: 'audio-generate', phase: 'Generate', schema: RESULT, model: 'sonnet' }),
  () => agent(`${COMMON}
You own: src/client/audio/** (except manifest.ts and trims.ts; import TRIMS from './trims' and create a placeholder trims.ts ONLY if it does not exist yet), tests/client/audio*.test.ts. Copy ${WHIRR}/src/client/audio/{manager,audio,beatAudio,eventSounds,music,settings,useAudioSettings,SoundSettings,index}.ts(x) and adapt them.
Build: Web Audio manager unlocked on first click; buses master/sfx/voice/music with persisted volumes + mute; limiter on sfx; music bus about -14 dB, ducked -6 dB under voice lines, 2 s crossfades; music via <audio> elements (title on start screen, battle loops alternating in game, victory/defeat stingers) that fails silently when no files exist yet. Throttling (simultaneous shots layered with detune jitter). eventSounds.ts / beatAudio.ts: map presentation beats (src/client/presentation/beats.ts) and engine events to sounds using src/client/weaponFlavour.ts (footsteps per weight class and hex step, twist whine, jets, each weapon flavour on fire, impacts by armor/internal, crits, explosions, falls, heat warning tone at projected heat >= 14 for the human's 'Mech, shutdown/startup, dice rattle, turn bell) and narrator/cockpit lines (phases, crits, ammo explosions, destroyed, victory/defeat; cockpit lines only for the human side's 'Mech). Missing files fail silently.
Hook it up with the smallest possible edits outside your files: one import + one call in the presentation director (src/client/presentation/director.ts) to play beats, an unlock call on first pointer down (App), and mount <SoundSettings/> as a section in the existing settings popover (src/client/ui/SettingsPopover.tsx: additive JSX only). List the exact outside files and lines you touched in issues.
Run typecheck and your tests. Return JSON: ok, summary, files, issues.`, { label: 'audio-wire', phase: 'Generate', schema: RESULT, model: 'sonnet' }),
])

let music = null
if (MUSIC) {
  phase('Music')
  music = await agent(`${COMMON}
You own: public/audio/music/**, tools/audio-manifest.json (music prompt edits only), public/audio/CREDITS.md.
1. Check the subscription; if the plan cannot use the Music API, record it and stop (ok=false).
2. Generate ONE candidate first (title-a), measure its cost from the subscription delta, compute how many of the rest fit under the ceiling ${CEILING}, and generate in priority order: title-a, battle-a-a, victory-a, defeat-a, battle-b-a, then the -b alternates. A 502 still costs credits: do not retry blindly.
3. Measure loudness; trim music well under SFX.
4. public/audio/CREDITS.md: music and SFX generated with ElevenLabs for this project.
Return JSON: ok, summary (<=80 words: tracks, credits per track, total now), files, issues.`, { label: 'music', phase: 'Music', schema: RESULT, model: 'sonnet' })
}

phase('Ship')
const ship = await agent(`${COMMON}
Integrate audio. You may edit any file under src/client/audio, tools/ (audio tools only), public/audio, public/sounds.html, src/client/weaponFlavour.ts and the specific outside files the audio-wire agent listed. npm run typecheck, npm test, npm run build green (if a failure is in a file another workflow owns and unrelated to audio, report it and do not fix). Verify headlessly with Playwright (PW_PORT=4185, ?test=1, start a game, play/skip a few beats) that sounds load without console errors (count via a test hook or the network log), and that /warmechforge/sounds.html lists and plays every generated file. Update STATUS.md (Audio section only) and HANDOFF.md (one line in the Morning summary: owner should audition at https://dragoonant.github.io/warmechforge/sounds.html and name ids to redo${MUSIC ? '' : '; music not generated yet (needs owner OK, about 12k credits)'}). Stage by exact paths (tools/gen-audio.ts tools/compose-audio.ts tools/measure-audio.ts tools/audio-manifest.json tools/audio-src public/audio public/sounds.html src/client/audio src/client/weaponFlavour.ts tests/client/weaponFlavour.test.ts tests/client/audio*.test.ts tools/workflows/w6-audio.js package.json package-lock.json STATUS.md HANDOFF.md + the outside files touched); confirm no token, .env or PDF is staged; commit "M6: SFX, narrator and cockpit voice, audio manager" + blank line + "${ATTR}"; git pull --rebase; git push origin main; gh run watch the Pages run --exit-status.
Return JSON: ok, summary (<=100 words incl. credits used and account total), files, issues.`, { label: 'audio-ship', phase: 'Ship', schema: RESULT, effort: 'high' })

const s = r => r && { ok: r.ok, summary: r.summary, issues: r.issues.slice(0, 6) }
return { tools: s(tools), gen: s(gen), wire: s(wire), music: s(music), ship: s(ship) }
