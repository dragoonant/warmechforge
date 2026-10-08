// Polish pass, played through the real UI: the end screen with a mini record sheet per 'Mech (bot vs bot, instant speed), Rematch and
// Back to setup, the threat overlay toggle, record-sheet hover tooltips, the new How to Play tabs, the auto-camera, and the
// Low graphics frame-rate audit (?fps). Screenshots land in e2e-out/polish-*.png.
import { expect, test, type Page } from '@playwright/test'

const OUT = 'e2e-out'
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` })

test.setTimeout(240_000)
test.use({ actionTimeout: 10_000 })

async function boot(page: Page, query: string): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(`./?test=1&${query}`)
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 30_000 })
}

test('end screen: damage per location per Mech, kills, heat, cause, three ways on', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await boot(page, 'scenario=intro&control=bot,bot&bot=easy&seed=11&speed=0')
  await expect(page.getByTestId('end-screen')).toBeVisible({ timeout: 200_000 })
  await expect(page.getByTestId('end-cause')).toContainText(/won by|draw/i)
  const minis = page.locator('[data-testid^="end-mini-"][data-fate]')
  expect(await minis.count()).toBe(4)
  // every damage number on a mini sheet adds up to that Mech's damage taken
  const sums = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="end-mini-"][data-fate]')].map((fig) => {
    const total = [...fig.querySelectorAll('g[data-damage]')].reduce((n, g) => n + Number(g.getAttribute('data-damage')), 0)
    const taken = Number(fig.querySelector('[data-testid^="end-mini-taken-"]')?.textContent)
    return { total, taken }
  }))
  for (const s of sums) expect(s.total).toBe(s.taken)
  await shot(page, 'polish-end')
  await expect(page.getByTestId('end-back')).toHaveText('Back to setup')

  // Rematch: same forces and seed, a new game opens and the screen closes
  await page.getByTestId('end-rematch').click()
  await expect(page.getByTestId('end-screen')).toBeHidden({ timeout: 20_000 })
  expect(errors).toEqual([])
})

test('how to play: equipment and skirmish tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('./?test=1')
  await page.getByTestId('start-help').click()
  await page.getByTestId('help-tab-gear').click()
  const panel = page.getByTestId('help-overlay')
  for (const w of ['LB-X', 'Ultra', 'Gauss', 'PPC capacitor', 'MASC', 'ECM', 'Targeting computer', 'Ferro-lamellor']) await expect(panel).toContainText(w)
  await shot(page, 'polish-howto')
  await page.getByTestId('help-tab-skirmish').click()
  await expect(panel).toContainText('Even BV')
  await shot(page, 'polish-howto-skirmish')
})

test('threat overlay toggle, record-sheet tooltips, board scale', async ({ page }) => {
  await boot(page, 'scenario=intro&control=human,bot&bot=easy&seed=7&speed=0')
  await page.mouse.click(800, 450) // skip the establishing shot
  await page.waitForTimeout(800)
  // T and the toolbar button toggle the same flag
  await page.keyboard.press('t')
  await expect(page.getByTestId('topbar-threat')).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(300)
  await page.getByTestId('topbar-threat').click()
  await expect(page.getByTestId('topbar-threat')).toHaveAttribute('aria-pressed', 'false')

  // pick a 'Mech so its record sheet opens, then a hovered weapon row shows its numbers
  await page.locator('[data-testid^="roster-unit-"]').first().click()
  const row = page.locator('[data-testid^="sheet-weapon-"]').first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.hover()
  const tip = page.getByTestId('tip')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText(/Damage \d+/)
  await expect(tip).toContainText(/Reach:/)
  await shot(page, 'polish-tooltip')
  // a crit slot
  await page.getByText('Critical slots', { exact: true }).click()
  await page.getByTestId('sheet-crits').locator('summary').first().click()
  const slot = page.locator('[data-testid^="sheet-crit-"]').first()
  await slot.hover()
  await expect(tip).toContainText(/slot 1/)
  // a heat-scale row
  const thr = page.locator('[data-testid^="heat-threshold-"]').first()
  if (await thr.count()) { await thr.hover(); await expect(tip).toContainText(/heat \d+/) }
  await page.mouse.move(800, 300)
  await shot(page, 'polish-board')
})

test('follow action: the camera frames a bot move and yields to the player', async ({ page }) => {
  await boot(page, 'scenario=intro&control=bot,bot&bot=easy&seed=3&speed=1')
  // the establishing shot owns the camera first: wait for it, skip it with a click, wait until it is done
  await expect(page.getByText('Click anywhere to skip')).toBeVisible({ timeout: 20_000 })
  await page.mouse.click(800, 450)
  await expect(page.getByText('Click anywhere to skip')).toBeHidden({ timeout: 10_000 })
  const eye = () => page.evaluate(() => { const c = (window as unknown as { __boardCam?: { screen(x: number, y: number, z: number): { x: number; y: number } } }).__boardCam; return c ? c.screen(0, 0, 0) : null })
  await page.waitForFunction(() => !!(window as unknown as { __boardCam?: unknown }).__boardCam, null, { timeout: 20_000 })
  const before = await eye()
  // with Follow action on, the board centre leaves the screen centre once a bot 'Mech moves
  await page.waitForFunction(() => {
    const c = (window as unknown as { __boardCam: { screen(x: number, y: number, z: number): { x: number; y: number } } }).__boardCam.screen(0, 0, 0)
    return Math.hypot(c.x - 800, c.y - 450) > 30
  }, null, { timeout: 60_000 })
  expect(before).toBeTruthy()
  await page.waitForTimeout(700)
  // the player grabs the camera (wheel): no reframing for the next second or two
  await page.mouse.move(800, 450)
  await page.mouse.wheel(0, -200)
  await page.waitForTimeout(150)
  const held = await eye()
  await page.waitForTimeout(1200)
  const still = await eye()
  expect(Math.hypot(still!.x - held!.x, still!.y - held!.y)).toBeLessThan(6)
})

test('low graphics: no shop, trees simplified, smooth while the bots play', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('wmf.settings', JSON.stringify({ graphics: 'low', speed: 1 })) } catch { /* ignore */ } })
  await boot(page, 'scenario=intro&control=bot,bot&bot=easy&seed=9&fps')
  // Low graphics forces the plain surround: no establishing shot, no shop hint
  await expect(page.getByText('Click anywhere to skip')).toBeHidden()
  const samples: number[] = []
  const t0 = Date.now()
  while (Date.now() - t0 < 14_000) {
    const text = (await page.getByTestId('fps-meter').textContent()) ?? ''
    const m = /(\d+) fps/.exec(text)
    if (m) samples.push(Number(m[1]))
    await page.waitForTimeout(500)
  }
  console.log('low graphics fps samples:', samples.join(' '))
  await shot(page, 'polish-low')
  expect(samples.length).toBeGreaterThan(2)
  const sorted = [...samples].sort((x, y) => x - y)
  expect(sorted[Math.floor(sorted.length / 2)]!).toBeGreaterThanOrEqual(30)
})

test('board look: figures at the default camera, water close up', async ({ page }) => {
  await boot(page, 'scenario=intro&control=bot,bot&bot=easy&seed=5&speed=0')
  await page.waitForFunction(() => (window.__game?.state()?.turn ?? 0) >= 2 && window.__game?.presentedIdle(), null, { timeout: 120_000 })
  // hold the game where it is: the HUD and the establishing shot out of the way
  await page.addStyleTag({ content: '.hud, .coach, .menu-fab, .help-fab { visibility: hidden !important }' })
  await page.waitForTimeout(500)
  await page.keyboard.press('0') // the default (overview) camera
  await page.waitForTimeout(900)
  await shot(page, 'polish-board-default')
  // water close up, through the camera hook
  await page.evaluate(() => {
    const cam = (window as unknown as { __boardCam: { set(p: [number, number, number], t: [number, number, number]): void } }).__boardCam
    cam.set([2.5, 4.2, 6.5], [-0.8, 0, 0.6])
  })
  await page.waitForTimeout(500)
  await shot(page, 'polish-water')
})

test('threat overlay over a live board', async ({ page }) => {
  await boot(page, 'scenario=intro&control=bot,bot&bot=easy&seed=3&speed=1')
  await expect(page.getByText('Click anywhere to skip')).toBeVisible({ timeout: 20_000 })
  await page.mouse.click(800, 450)
  // wait until all four 'Mechs stand on the board (the first Movement Phase is over)
  await page.waitForFunction(() => {
    const st = window.__game?.presented()
    return !!st && st.phase === 'rangedAttack' && Object.values(st.units).filter((u) => u.pos).length >= 4
  }, null, { timeout: 90_000 })
  await page.addStyleTag({ content: '.hud, .coach, .menu-fab, .help-fab { visibility: hidden !important }' })
  await page.keyboard.press('0')
  await page.keyboard.press('t')
  await page.waitForTimeout(1200)
  await shot(page, 'polish-threat')
  await expect(page.getByTestId('topbar-threat')).toHaveAttribute('aria-pressed', 'true')
})
