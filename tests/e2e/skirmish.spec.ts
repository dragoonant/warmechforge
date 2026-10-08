// M5 skirmish any-vs-any: pick 'Mechs, variants and pilots per side on the start screen, use Even BV, choose a Core Box map,
// then watch two bots fight on Scorched Oasis. Picks use exact values and exact option text (never substrings: "Mad Cat Mk II"
// must not match another chassis). Screenshots: e2e-out/skirmish-setup.png and e2e-out/scorched-oasis.png.
import { expect, test, type Page } from '@playwright/test'
import { snap } from './policy'

const OUT = 'e2e-out'
test.setTimeout(300_000)

const pick = (page: Page, side: 'A' | 'B', n: number, what: string) => page.getByTestId(`pick-${side}-${n}-${what}`)

test('skirmish picker: any-vs-any lineups on a Core Box map', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  const botTrouble: string[] = []
  page.on('console', (m) => { const t = m.text(); if (/AiFallback|\[ai worker\]|\[bot\] watchdog/.test(t)) botTrouble.push(t) })
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('./?test=1')
  await expect(page.getByTestId('start-screen')).toBeVisible()

  await page.getByTestId('start-mission-skirmish').click()
  await expect(page.getByTestId('pick-A')).toBeVisible()
  await expect(page.getByTestId('pick-B')).toBeVisible()
  // the map list: the four Core Box maps, then the dev map
  const mapNames = await page.getByTestId('start-map').locator('option').allTextContents()
  expect(mapNames).toEqual(['Scorched Oasis', 'Arid Canyons', 'Headwater Crossing', 'Sodden Hills', 'Test Canyons (dev map)'])
  await page.getByTestId('start-map').selectOption('map.scorched-oasis')

  // side A (ours): Mad Cat Mk II 2 (stock) with a 3/4 pilot, and a Vulture Mk IV A; two 'Mechs
  while (await page.getByTestId('pick-A-2-row').count()) await pick(page, 'A', 2, 'remove').click()
  await pick(page, 'A', 0, 'chassis').selectOption({ label: 'Mad Cat Mk II' })
  await pick(page, 'A', 0, 'variant').selectOption('mech.mad-cat-mk-ii.2')
  await expect(pick(page, 'A', 0, 'variant').locator('option:checked')).toHaveText('2 (stock) · BV 2,822')
  await pick(page, 'A', 0, 'gunnery').selectOption('3')
  await pick(page, 'A', 0, 'piloting').selectOption('4')
  await pick(page, 'A', 1, 'chassis').selectOption({ label: 'Vulture Mk IV' })
  await pick(page, 'A', 1, 'variant').selectOption('mech.vulture-mk-iv.a')
  await expect(pick(page, 'A', 1, 'variant').locator('option:checked')).toHaveText('A (stock) · BV 2,177')
  await expect(page.getByTestId('pick-A-total')).toHaveText(/^2 'Mechs · 150 t · BV [\d,]+$/)

  // side B (the bot): Regent A, Uziel UZL-8S (stock), Hollander BZK-F3 (stock)
  while (await page.getByTestId('pick-B-3-row').count()) await pick(page, 'B', 3, 'remove').click()
  await pick(page, 'B', 0, 'chassis').selectOption({ label: 'Regent' })
  await pick(page, 'B', 0, 'variant').selectOption('mech.regent.a')
  await expect(pick(page, 'B', 0, 'variant').locator('option:checked')).toHaveText('A · BV 3,412')
  await pick(page, 'B', 1, 'chassis').selectOption({ label: 'Uziel' })
  await pick(page, 'B', 1, 'variant').selectOption('mech.uziel.uzl-8s')
  await pick(page, 'B', 2, 'chassis').selectOption({ label: 'Hollander' })
  await pick(page, 'B', 2, 'variant').selectOption('mech.hollander.bzk-f3')
  await expect(page.getByTestId('pick-B-2-bv')).toHaveText('35 t · BV 953')

  // Even BV changes the bot side's pilots; the totals end up close
  const bvOf = async (side: 'A' | 'B') => Number((await page.getByTestId(`pick-${side}-total`).textContent())!.replace(/.*BV /, '').replace(/,/g, ''))
  const gap0 = Math.abs((await bvOf('A')) - (await bvOf('B')))
  await page.getByTestId('pick-even-bv').click()
  const gap1 = Math.abs((await bvOf('A')) - (await bvOf('B')))
  expect(gap1).toBeLessThan(gap0)
  await expect(pick(page, 'A', 0, 'gunnery')).toHaveValue('3') // our side untouched
  await page.screenshot({ path: `${OUT}/skirmish-setup.png` })

  // watch: both sides to the bot, fixed seed
  await page.getByTestId('start-control-A-bot').click()
  await page.getByTestId('start-seed').fill('11')
  await page.getByTestId('start-go').click()
  await expect(page.getByTestId('hud')).toBeVisible()
  const setup = await page.evaluate(() => {
    const s = window.__game!.state()!
    return { map: s.board.mapId, units: s.unitOrder.map((id) => s.units[id]!.name) }
  })
  expect(setup.map).toBe('map.scorched-oasis')
  expect(setup.units).toEqual(['Mad Cat Mk II 2', 'Vulture Mk IV A', 'Regent A', 'Uziel UZL-8S', 'Hollander BZK-F3'])
  await page.waitForTimeout(900)
  await page.mouse.click(800, 450) // skip the establishing shot
  await page.evaluate(() => window.__game!.speed(4))
  // let the bots bring every 'Mech onto the board and trade fire
  const t0 = Date.now()
  for (;;) {
    const s = await snap(page)
    if (s.over || (s.turn >= 3 && s.phase === 'movement')) break
    if (Date.now() - t0 > 200_000) throw new Error(`stuck: ${JSON.stringify(s)}`)
    await page.waitForTimeout(500)
  }
  await page.keyboard.press('0') // overview of the whole sheet
  await page.waitForTimeout(1200)
  await page.addStyleTag({ content: '.hud, .coach, .menu-fab, .help-fab { visibility: hidden !important }' })
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/scorched-oasis.png` })
  expect(errors.filter((e) => !/THREE\.|WebGL|GPU stall|X4122/.test(e))).toEqual([])
  expect(botTrouble).toEqual([])
})
