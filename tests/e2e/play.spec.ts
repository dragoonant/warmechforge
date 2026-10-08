// M3 vertical slice, played through the real UI: start screen -> How to Play -> start the intro mission vs the random bot ->
// the human moves (walk / run / jump + facing), twists, fires, kicks when it can, until a 'Mech is destroyed or turn 4.
// The rest of the battle is then fast-forwarded (both sides handed to the bot via a save) to reach the end screen.
// window.__game is used only to read state and to fast-forward. Screenshots land in e2e-out/ for review.
import { expect, test, type Page } from '@playwright/test'
import { answerGeneric, commitFire, confirmMove, enabled, playMove, playPhysical, prepareFire, snap, waitForHuman } from './policy'

const OUT = 'e2e-out'
const STOP_TURN = 4
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` })
const hideHud = (page: Page) => page.addStyleTag({ content: '.hud, .coach, .menu-fab, .help-fab { visibility: hidden !important }' })
const showHud = (page: Page) => page.evaluate(() => { document.querySelectorAll('style').forEach((s) => { if (s.textContent?.includes('.hud, .coach')) s.remove() }) })

test.setTimeout(360_000)

test('play the intro mission against the bot through the UI', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.setViewportSize({ width: 1600, height: 900 })
  // fresh profile: game shop surroundings (the default), tips on
  await page.goto('./?test=1')

  // ---- start screen
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await expect(page.getByTestId('title')).toHaveText('WarMechForge')
  await expect(page.getByTestId('fan-notice')).toContainText('Unofficial fan project, not affiliated with or endorsed by Catalyst Game Labs, Topps or Microsoft.')
  await shot(page, 'start')

  // ---- How to Play
  await page.getByTestId('start-help').click()
  await expect(page.getByTestId('help-overlay')).toBeVisible()
  for (const tab of ['goal', 'turn', 'move', 'shoot', 'heat', 'melee', 'controls']) await expect(page.getByTestId(`help-tab-${tab}`)).toBeVisible()
  await page.getByTestId('help-tab-move').click()
  await shot(page, 'howto')
  await page.getByTestId('help-close').click()
  await expect(page.getByTestId('help-overlay')).toBeHidden()

  // ---- start: intro mission, we are the Eris Lance (human), the enemy is the random bot; fixed seed for a repeatable game
  await page.getByTestId('start-mission-intro').click()
  await page.getByTestId('start-seed').fill('7')
  await page.getByTestId('start-go').click()
  await expect(page.getByTestId('hud')).toBeVisible()
  await expect(page.locator('canvas').first()).toBeVisible()
  // the establishing shot opens wide inside the game shop
  await page.waitForTimeout(1200)
  await shot(page, 'shop-wide')
  await page.mouse.click(800, 450) // any click skips it
  await page.waitForTimeout(900)
  await page.evaluate(() => window.__game!.speed(4))

  const me = 'A'
  let tookMove = false, tookFire = false, tookSheet = false, tookMid = false, tookBoard = false, tookShop = false
  const did: string[] = []
  let modeIx = 0
  for (let step = 0; step < 300; step++) {
    const s = await waitForHuman(page, STOP_TURN)
    if (s.over || s.turn > STOP_TURN) break
    const destroyed = await page.$$eval('[data-testid^="mech-"][data-destroyed]', (e) => e.length)
    if (destroyed > 0) break
    // the topbar always says whose decision it is
    await expect(page.getByTestId('topbar-decision')).toContainText(/Your decision|Eris/)

    if (!tookMid && s.turn >= 2 && s.kind === 'move') {
      await shot(page, 'midgame'); tookMid = true
    }
    if (!tookBoard && s.turn >= 2 && s.kind === 'move') {
      // the hex board with the 'Mechs, HUD hidden, from the player's usual angle
      // camera key 3 follows the acting 'Mech: a close look at the tiles, woods, cliffs and figures
      await page.keyboard.press('3'); await page.waitForTimeout(800)
      await hideHud(page); await page.waitForTimeout(150); await shot(page, 'board'); await showHud(page); tookBoard = true
      await page.keyboard.press('0'); await page.waitForTimeout(800)
    }
    if (!tookShop && s.turn >= 2 && s.kind === 'declareFire') { await shot(page, 'shop-play'); tookShop = true }

    switch (s.kind) {
      case 'move': {
        const mode = (['walk', 'run', 'jump'] as const)[modeIx++ % 3]!
        did.push(`T${s.turn} ${s.unit} ${await playMove(page, mode, me)}`)
        if (!tookMove && await enabled(page.getByTestId('move-confirm'))) {
          await expect(page.getByTestId('move-strip')).toContainText(/MP/)
          await shot(page, 'move'); tookMove = true
        }
        await confirmMove(page)
        break
      }
      case 'standUp':
        await page.locator('[data-testid^="stand-"].hud-btn-primary').first().click()
        did.push(`T${s.turn} ${s.unit} stand up`)
        break
      case 'torsoTwist': {
        const side = s.turn % 2 ? 'right' : 'left'
        if (await enabled(page.getByTestId(`fire-twist-${side}`))) await page.getByTestId(`fire-twist-${side}`).click()
        await page.getByTestId('fire-twist-confirm').click()
        did.push(`T${s.turn} ${s.unit} twist ${side}`)
        break
      }
      case 'declareFire': {
        await prepareFire(page)
        await expect(page.getByTestId('fire-heat-total')).toContainText(/Heat now \d+ \+ moved \d+ \+ weapons \d+/)
        if (!tookFire && await enabled(page.getByTestId('fire-confirm'))) {
          await expect(page.getByTestId('fire-sentence')).toContainText(/Target \d+|Fire \d+ weapons/)
          await shot(page, 'fire-prompt'); tookFire = true
        }
        if (!tookSheet) {
          // the acting 'Mech's record sheet on the right rail
          await page.getByTestId(`roster-unit-${s.unit}`).click().catch(() => {})
          await page.waitForTimeout(200)
          await expect(page.locator(`[data-testid="sheet-root-${s.unit}"]`)).toBeVisible()
          await page.getByTestId('rail-right').screenshot({ path: `${OUT}/record-sheet.png` }); tookSheet = true
        }
        await commitFire(page)
        did.push(`T${s.turn} ${s.unit} fire`)
        break
      }
      case 'declarePhysical':
        did.push(`T${s.turn} ${s.unit} physical ${await playPhysical(page)}`)
        break
      default:
        await answerGeneric(page)
        did.push(`T${s.turn} ${s.kind}`)
    }
    await page.waitForTimeout(200)
  }
  console.log(did.join('\n'))
  expect(tookMove, 'a move was staged and shown').toBe(true)
  expect(tookFire, 'a fire prompt was shown').toBe(true)
  expect(tookSheet, 'a record sheet was shown').toBe(true)
  if (!tookMid) await shot(page, 'midgame')
  if (!tookBoard) { await hideHud(page); await shot(page, 'board'); await showHud(page) }
  if (!tookShop) await shot(page, 'shop-play')

  // ---- fast-forward the rest: hand both sides to the bot through a save, instant presentation, then read the end screen
  const s = await snap(page)
  if (!s.over) {
    await page.evaluate(() => {
      const g = window.__game!
      const save = g.save()!
      g.speed(0)
      g.load({ ...save, controllers: { A: 'bot', B: 'bot' } })
    })
  }
  await expect(page.getByTestId('end-screen')).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('end-cause')).not.toBeEmpty()
  await shot(page, 'end')
  expect(errors.filter((e) => !/THREE\.|WebGL|GPU stall|X4122/.test(e))).toEqual([])
})
