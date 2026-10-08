// M9 playtest follow-ups through the real UI: clicking your own hex and keeping your facing must not drop the 'Mech prone.
import { expect, test, type Page } from '@playwright/test'
import { answerGeneric, commitFire, confirmMove, playMove, playPhysical, prepareFire, waitForHuman } from './policy'

test.setTimeout(240_000)

async function boot(page: Page, query: string): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(`./?test=1&${query}`)
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 30_000 })
  await page.mouse.click(800, 450)
}

test('own hex + same facing is not offered as a move, and a turn in place does not knock the Mech down', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await boot(page, 'scenario=intro&control=human,bot&bot=easy&seed=7&speed=0')
  // play on until a unit that is already on the board gets its move decision
  let s = await waitForHuman(page, 6)
  for (let i = 0; i < 60; i++) {
    const onBoard = await page.evaluate(() => { const g = window.__game!; const pd = g.pending(); return pd?.kind === 'move' && !!pd.unitId && !!g.state()!.units[pd.unitId]!.pos })
    if (onBoard || s.over) break
    if (s.kind === 'move') { await playMove(page, 'walk', 'A'); await confirmMove(page) }
    else if (s.kind === 'torsoTwist') await page.getByTestId('fire-twist-confirm').click()
    else if (s.kind === 'declareFire') { await prepareFire(page); await commitFire(page) }
    else if (s.kind === 'declarePhysical') await playPhysical(page)
    else await answerGeneric(page)
    await page.waitForTimeout(200)
    s = await waitForHuman(page, 6)
  }
  expect(s.kind).toBe('move')
  const me = await page.evaluate(() => { const st = window.__game!.state()!; const id = window.__game!.pending()!.unitId!; const u = st.units[id]!; return { id, facing: u.facing, hex: null as string | null } })
  const hexId = await page.evaluate((id) => document.querySelector(`[data-testid="mech-${id}"]`)?.getAttribute('data-hex') ?? null, me.id)
  await page.getByTestId('move-mode-walk').click()
  await page.waitForTimeout(500)
  const label = hexId ?? me.hex
  expect(label).toBeTruthy()
  await page.getByTestId(`hex-${label}`).dispatchEvent('click')
  await page.waitForTimeout(250)
  if (await page.getByTestId(`move-facing-${me.facing}`).count()) await expect(page.getByTestId(`move-facing-${me.facing}`)).toBeDisabled()
  // turning to another facing (if the hex is offered at all) never ends prone
  const open = await page.$$eval('[data-testid^="move-facing-"]:not([disabled])', (els) => els.map((e) => e.getAttribute('data-testid')!))
  if (open.length) {
    await page.getByTestId(open[0]!).click()
    await page.getByTestId('move-confirm').click()
    await page.waitForTimeout(500)
    const prone = await page.evaluate((id) => window.__game!.state()!.units[id]!.prone, me.id)
    expect(prone).toBe(false)
  }
  expect(errors).toEqual([])
})
