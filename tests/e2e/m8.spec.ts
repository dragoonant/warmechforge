// M8 client: skirmish options (turn limit, forced withdrawal, AI picks a force) and the player controls for special equipment
// (Ultra AC "2 shots", PPC capacitor "Charge", "Vent coolant pod", MASC chip), played through the real UI.
// Screenshots: e2e-out/m8-*.png.
import { expect, test, type Page } from '@playwright/test'
import { answerGeneric, enabled, playMove, playPhysical, prepareFire, waitForHuman } from './policy'

const OUT = 'e2e-out'
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` })
test.setTimeout(420_000)

test('skirmish setup: turn limit, forced withdrawal and the AI force picker', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('./?test=1')
  await page.getByTestId('start-mission-skirmish').click()
  await expect(page.getByTestId('pick-B')).toBeVisible()
  // the three new controls
  const limit = page.getByTestId('start-turn-limit')
  await expect(limit.locator('option')).toHaveText(['No limit', '8 turns', '12 turns', '16 turns'])
  await expect(limit).toHaveValue('none')
  await expect(page.getByTestId('start-withdrawal')).not.toBeChecked()
  await limit.selectOption('12')
  await page.getByTestId('start-withdrawal').check()
  await page.getByTestId('start-seed').fill('alpha')

  // we keep one Regent A; the AI fills the enemy side from the whole roster to within 10% of our BV
  const pick = (side: 'A' | 'B', n: number, what: string) => page.getByTestId(`pick-${side}-${n}-${what}`)
  while (await page.getByTestId('pick-A-1-row').count()) await pick('A', 1, 'remove').click()
  await pick('A', 0, 'chassis').selectOption({ label: 'Regent' })
  await pick('A', 0, 'variant').selectOption('mech.regent.a')
  const bvOf = async (side: 'A' | 'B') => Number((await page.getByTestId(`pick-${side}-total`).textContent())!.replace(/.*BV /, '').replace(/,/g, ''))
  await page.getByTestId('pick-ai-force').click()
  const mine = await bvOf('A'), theirs = await bvOf('B')
  expect(Math.abs(theirs - mine)).toBeLessThanOrEqual(mine * 0.1)
  const first = await page.getByTestId('pick-B').innerText()
  await shot(page, 'm8-skirmish-options')

  // the same seed and press count give the same force again (pressing once more rolls the next one)
  await page.reload()
  await page.getByTestId('start-mission-skirmish').click()
  await page.getByTestId('start-seed').fill('alpha')
  while (await page.getByTestId('pick-A-1-row').count()) await pick('A', 1, 'remove').click()
  await pick('A', 0, 'chassis').selectOption({ label: 'Regent' })
  await pick('A', 0, 'variant').selectOption('mech.regent.a')
  await page.getByTestId('pick-ai-force').click()
  expect(await page.getByTestId('pick-B').innerText()).toBe(first)

  // the choices reach the engine
  await page.getByTestId('start-turn-limit').selectOption('12')
  await page.getByTestId('start-withdrawal').check()
  await page.getByTestId('start-go').click()
  await expect(page.getByTestId('hud')).toBeVisible()
  const setup = await page.evaluate(() => { const s = window.__game!.state()!; return { turnLimit: s.setup.turnLimit, forcedWithdrawal: s.setup.forcedWithdrawal } })
  expect(setup).toEqual({ turnLimit: 12, forcedWithdrawal: true })
  expect(errors).toEqual([])
})

test('special equipment: 2 shots, Charge, Vent coolant pod and the MASC chip', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('./?test=1&speed=0')
  await expect(page.getByTestId('start-screen')).toBeVisible()
  // Regent A (three PPC capacitors, coolant pod), Solitaire 2 (MASC), Vulture Mk IV A (Ultra AC) against two bots' worth of armour
  const rej = await page.evaluate(() => window.__game!.newGame({
    mission: 'mission.skirmish', map: 'map.test-canyons', seed: 'm8-gear', controllers: { A: 'human', B: 'bot' }, bot: { tier: 'easy' },
    lineups: [
      { name: 'Gear Lance', units: [{ mech: 'mech.regent.a', gunnery: 4, piloting: 5 }, { mech: 'mech.solitaire.2', gunnery: 4, piloting: 5 }, { mech: 'mech.vulture-mk-iv.a', gunnery: 4, piloting: 5 }] },
      { name: 'Target Lance', units: [{ mech: 'mech.uziel.uzl-8s', gunnery: 4, piloting: 5 }, { mech: 'mech.hollander.bzk-f3', gunnery: 4, piloting: 5 }] },
    ],
  }))
  expect(rej).toBeNull()
  await page.getByTestId('start-continue').click() // the game is in memory: Continue opens it
  await expect(page.getByTestId('hud')).toBeVisible()
  await page.waitForTimeout(900)
  await page.mouse.click(800, 450)
  await page.waitForTimeout(600)

  const nameOf = (id: string | null) => page.evaluate((u) => (u ? window.__game!.state()!.units[u]!.name : ''), id)
  const done = { masc: false, ppc: false, uac: false, sheet: false }
  let enteringShot = false
  const did: string[] = []
  let ppcUnit: string | null = null

  for (let step = 0; step < 260 && !(done.masc && done.ppc && done.uac && done.sheet); step++) {
    const s = await waitForHuman(page, 14)
    if (s.over || s.turn > 14) break
    const name = await nameOf(s.unit)
    switch (s.kind) {
      case 'move': {
        if (name.startsWith('Solitaire') && !done.masc && await enabled(page.getByTestId('move-mode-run'))) {
          await page.getByTestId('move-mode-run').click()
          const chip = page.getByTestId('move-masc')
          await expect(chip).toBeVisible()
          if (await chip.isDisabled()) {
            // the move that brings a 'Mech onto the map cannot use MASC (the engine offers no MASC reach then): say so in plain words
            await expect(page.getByTestId('move-masc-note')).toContainText(/Not on the move that brings this 'Mech onto the map/)
            if (!enteringShot) { await shot(page, 'm8-masc-entering'); enteringShot = true }
            did.push(`T${s.turn} ${name} MASC blocked while entering`)
            did.push(`T${s.turn} ${name} ${await playMove(page, 'run', 'A')}`)
            if (await enabled(page.getByTestId('move-confirm'))) await page.getByTestId('move-confirm').click()
            else if (await enabled(page.getByTestId('move-mode-stand'))) await page.getByTestId('move-mode-stand').click()
            break
          }
          await expect(page.getByTestId('move-masc-note')).toContainText(/Run up to \d+ MP instead of \d+/)
          await expect(page.getByTestId('move-masc-note')).toContainText(/\d+\+ to avoid/)
          const before = await page.evaluate(() => window.__game!.ui().move.masc)
          expect(before).toBe(false)
          const hexesWalkRun = await page.$$eval('[data-testid^="hex-"]', (e) => e.length)
          await chip.click()
          await expect(chip).toHaveAttribute('aria-pressed', 'true')
          await expect(page.getByTestId('move-masc-risk')).toContainText(/wrecked/)
          await page.waitForTimeout(500)
          const hexesMasc = await page.$$eval('[data-testid^="hex-"]', (e) => e.length)
          expect(hexesMasc).toBeGreaterThanOrEqual(hexesWalkRun)
          await shot(page, 'm8-masc-chip')
          did.push(`T${s.turn} ${name} run with MASC ${await playMove(page, 'run', 'A')}`)
          if (await enabled(page.getByTestId('move-confirm'))) await page.getByTestId('move-confirm').click()
          else await page.getByTestId('move-mode-stand').click()
          await page.waitForTimeout(400)
          const mascUsed = await page.evaluate((u) => Object.values(window.__game!.state()!.units[u!]!.escalating).some((e) => e.usedThisTurn), s.unit)
          done.masc = mascUsed
          break
        }
        did.push(`T${s.turn} ${name} ${await playMove(page, 'run', 'A')}`)
        if (await enabled(page.getByTestId('move-confirm'))) await page.getByTestId('move-confirm').click()
        else if (await enabled(page.getByTestId('move-mode-stand'))) await page.getByTestId('move-mode-stand').click()
        break
      }
      case 'standUp':
        await page.locator('[data-testid^="stand-"].hud-btn-primary').first().click()
        break
      case 'torsoTwist':
        await page.getByTestId('fire-twist-confirm').click()
        break
      case 'declareFire': {
        await prepareFire(page)
        const charge = page.locator('[data-testid^="fire-charge-"][aria-pressed]')
        const rapid = page.locator('[data-testid^="fire-rapid-"]')
        if (!done.ppc && (await charge.count()) > 0 && name.startsWith('Regent')) {
          const hasTargets = (await page.locator('[data-testid^="fire-target-"]').count()) > 0
          if (hasTargets) {
            const heatBefore = Number(await page.getByTestId('fire-heat-total').getAttribute('data-end'))
            await expect(page.getByTestId('fire-pod')).toBeEnabled()
            await charge.first().click()
            await expect(charge.first()).toHaveAttribute('aria-pressed', 'true')
            await expect(page.getByTestId('fire-charge-note')).toContainText('+5 damage next turn, +5 heat now, cannot fire this turn')
            // the charging PPC drops out of the shot list
            const mount = (await charge.first().getAttribute('data-testid'))!.replace('fire-charge-', '')
            await expect(page.getByTestId(`fire-weapon-${mount}`)).toBeDisabled()
            await expect(page.getByTestId(`fire-why-${mount}`)).toContainText('charging')
            await expect(page.getByTestId('fire-heat-total')).toContainText(/equipment 5/)
            const withCharge = Number(await page.getByTestId('fire-heat-total').getAttribute('data-end'))
            await page.getByTestId('fire-pod').click()
            await expect(page.getByTestId('fire-pod')).toHaveAttribute('aria-pressed', 'true')
            await expect(page.getByTestId('fire-pod-note')).toContainText(/Venting the coolant pod: this turn ends at \d+ heat instead of \d+|would not change this turn's end heat/)
            const withPod = Number(await page.getByTestId('fire-heat-total').getAttribute('data-end'))
            expect(withPod).toBeLessThanOrEqual(withCharge)
            expect(withCharge).toBeGreaterThanOrEqual(heatBefore)
            await shot(page, 'm8-fire-ppc-pod')
            await page.getByTestId('fire-confirm').click()
            ppcUnit = s.unit
            await page.waitForTimeout(600)
            expect(await page.evaluate(() => window.__game!.rejection())).toBeNull()
            const booked = await page.evaluate((u) => {
              const st = window.__game!.state()!
              const ms = Object.values(st.units[u!]!.mounts)
              return { caps: ms.filter((m) => m.item === 'cl.eq.ppc-capacitor' && m.firedTurn === st.turn).length, pod: ms.filter((m) => m.item === 'cl.eq.coolant-pod' && m.firedTurn === st.turn).length }
            }, s.unit)
            expect(booked).toEqual({ caps: 1, pod: 1 })
            done.ppc = true
            did.push(`T${s.turn} ${name} charged a PPC and vented the pod`)
            break
          }
        }
        if (!done.uac && (await rapid.count()) > 0 && name.startsWith('Vulture') && (await page.locator('[data-testid^="fire-target-"]').count()) > 0) {
          const id = (await rapid.first().getAttribute('data-testid'))!
          const mount = id.replace('fire-rapid-', '')
          const heatOne = Number(await page.getByTestId('fire-heat-total').getAttribute('data-end'))
          if (!(await page.getByTestId(`fire-weapon-${mount}`).isChecked())) await page.getByTestId(`fire-weapon-${mount}`).check()
          const binsBefore = await page.evaluate((u) => Object.values(window.__game!.state()!.units[u!]!.bins).filter((b) => /ultra/.test(b.ammo)).reduce((n, b) => n + b.shots, 0), s.unit)
          await rapid.first().click()
          await expect(rapid.first()).toHaveAttribute('aria-pressed', 'true')
          await expect(page.getByTestId(`fire-line-${mount}`)).toContainText(/per shot, about [\d.]+ of 2 hit/)
          const heatTwo = Number(await page.getByTestId('fire-heat-total').getAttribute('data-end'))
          expect(heatTwo).toBeGreaterThan(heatOne - 1)
          await shot(page, 'm8-fire-uac-2shots')
          await page.getByTestId('fire-confirm').click()
          await page.waitForTimeout(800)
          expect(await page.evaluate(() => window.__game!.rejection())).toBeNull()
          // the engine accepted a declaration that carries the double tap for that mount
          const declared = await page.evaluate(([u, m]) => {
            const acts = window.__game!.save()!.file.actions as { type: string; unitId?: string; shots?: { mountId: string; rapidShots?: number }[] }[]
            const last = [...acts].reverse().find((a) => a.type === 'declareFire' && a.unitId === u)
            return last?.shots?.find((x) => x.mountId === m)?.rapidShots ?? null
          }, [s.unit, mount])
          expect(declared).toBe(2)
          void binsBefore
          done.uac = true
          did.push(`T${s.turn} ${name} fired the Ultra AC twice`)
          break
        }
        if (ppcUnit && !done.sheet) {
          // the next turn the charged capacitor shows on the record sheet
          const chargedNow = await page.evaluate((u) => { const st = window.__game!.state()!; return Object.values(st.units[u]!.mounts).some((m) => m.item === 'cl.eq.ppc-capacitor' && m.firedTurn === st.turn - 1) }, ppcUnit)
          if (chargedNow) {
            await page.getByTestId(`roster-unit-${ppcUnit}`).click().catch(() => {})
            await page.waitForTimeout(250)
            await expect(page.getByTestId('sheet-equipment')).toBeVisible()
            await expect(page.getByTestId('sheet-equipment')).toContainText(/capacitor: charged/i)
            await expect(page.getByTestId('sheet-equipment')).toContainText(/coolant pod: used/i)
            await page.getByTestId(`sheet-root-${ppcUnit}`).screenshot({ path: `${OUT}/m8-record-sheet.png` })
            done.sheet = true
          }
        }
        if (await enabled(page.getByTestId('fire-confirm'))) await page.getByTestId('fire-confirm').click()
        else await page.getByTestId('fire-hold').click()
        break
      }
      case 'declarePhysical':
        await playPhysical(page)
        break
      default:
        await answerGeneric(page)
    }
    await page.waitForTimeout(150)
  }
  console.log(did.join('\n'), JSON.stringify(done))
  expect(done).toEqual({ masc: true, ppc: true, uac: true, sheet: true })
  expect(errors.filter((e) => !/THREE\.|WebGL|GPU stall|X4122/.test(e))).toEqual([])
})
