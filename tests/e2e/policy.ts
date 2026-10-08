// Shared E2E click policy (50 §16): read the open decision through window.__game (read-only) and answer it by clicking the
// real UI like a new player would. Picks match exact test ids, never substrings.
import type { Locator, Page } from '@playwright/test'

export interface Snap { kind: string | null; player: string | null; human: boolean; idle: boolean; turn: number; phase: string; unit: string | null; id: string | null; over: boolean }

export const snap = (page: Page): Promise<Snap> => page.evaluate(() => {
  const g = window.__game!
  const s = g.state()
  const pd = g.pending()
  return {
    kind: pd?.kind ?? null, player: pd?.player ?? null, human: !!pd && g.controllers()[pd.player] === 'human', idle: g.presentedIdle(),
    turn: s?.turn ?? 0, phase: s?.phase ?? 'none', unit: pd?.unitId ?? null, id: pd?.id ?? null, over: s?.phase === 'ended',
  }
})

/** Wait until a human prompt is on screen (the dock is visible), the game ends, or `stopTurn` is reached. */
export async function waitForHuman(page: Page, stopTurn: number, timeoutMs = 90_000): Promise<Snap> {
  const t0 = Date.now()
  let idleHumanSince = 0
  while (Date.now() - t0 < timeoutMs) {
    const s = await snap(page)
    if (s.over || s.turn > stopTurn) return s
    if (s.human && s.idle) {
      if (await page.locator('.hud-dock:not(.hud-dock-wait)').first().isVisible().catch(() => false)) return s
      // a human decision with nothing on screen for 3 s is an invisible prompt: fail loudly
      idleHumanSince ||= Date.now()
      if (Date.now() - idleHumanSince > 3000) throw new Error(`human decision ${s.kind} has no visible prompt`)
    } else idleHumanSince = 0
    await page.waitForTimeout(150)
  }
  throw new Error(`no human prompt in ${timeoutMs} ms: ${JSON.stringify(await snap(page))}`)
}

export async function enabled(l: Locator): Promise<boolean> {
  return (await l.count()) > 0 && (await l.first().isVisible()) && (await l.first().isEnabled())
}

const ids = (page: Page, prefix: string, extra = ''): Promise<string[]> =>
  page.$$eval(`[data-testid^="${prefix}"]${extra}`, (els) => els.map((e) => e.getAttribute('data-testid')!))

/** Page pixels of a hex centre (the live camera). */
export const hexPx = (page: Page, label: string): Promise<{ x: number; y: number } | null> => page.evaluate((l) => window.__game!.hexToScreen(l), label)

/** Hexes of the living enemy 'Mechs (from the DOM proxies). */
export async function enemyHexes(page: Page, me: string): Promise<string[]> {
  return page.$$eval('[data-testid^="mech-"]', (els, owner) => els
    .filter((e) => e.getAttribute('data-owner') && e.getAttribute('data-owner') !== owner && !e.getAttribute('data-destroyed') && e.getAttribute('data-hex'))
    .map((e) => e.getAttribute('data-hex')!), me)
}

/**
 * Movement: pick the mode, click (on the canvas) the reachable hex nearest the closest enemy, pick a facing, confirm.
 * Returns a short description of what was done.
 */
export async function playMove(page: Page, mode: 'walk' | 'run' | 'jump', me: string): Promise<string> {
  const btn = page.getByTestId(`move-mode-${mode}`)
  const m = (await enabled(btn)) ? mode : 'walk'
  await page.getByTestId(`move-mode-${m}`).click()
  await page.waitForTimeout(700) // camera ease to the active unit
  const reach = (await ids(page, 'hex-')).filter((x) => /^hex-\d{4}$/.test(x)).map((x) => x.slice(4))
  const enemies = await enemyHexes(page, me)
  const ep = enemies.length ? await hexPx(page, enemies[0]!) : null
  // a click on a hex that holds a 'Mech picks the 'Mech, not the hex: leave occupied hexes alone
  const occupied = new Set(await page.$$eval('[data-testid^="mech-"][data-hex]', (els) => els.map((e) => e.getAttribute('data-hex')!)))
  const box = page.viewportSize()!
  const cands: { h: string; x: number; y: number; d: number }[] = []
  const pts = await page.evaluate((ls) => ls.map((l) => window.__game!.hexToScreen(l)), reach)
  for (let i = 0; i < reach.length; i++) {
    const h = reach[i]!, p = pts[i]
    if (occupied.has(h)) continue
    if (!p || p.x < 300 || p.x > box.width - 320 || p.y < 90 || p.y > box.height - 200) continue
    const d = ep ? Math.hypot(p.x - ep.x, p.y - ep.y) : p.y
    if (ep && d < 30) continue
    cands.push({ h, ...p, d })
  }
  cands.sort((x, y) => x.d - y.d)
  // a tall figure can stand over the hex behind it, so the click picks the figure: try the next hex when no facing picker opens
  let best = cands[0] ?? null
  let facings: string[] = []
  for (const c of cands.slice(0, 6)) {
    await page.mouse.click(c.x, c.y)
    await page.waitForTimeout(250)
    facings = await ids(page, 'move-facing-', ':not([disabled])')
    if (facings.length) { best = c; break }
  }
  if (!facings.length) {
    // the board's own DOM proxy for the hex always answers
    const h = best?.h ?? reach.find((x) => !occupied.has(x)) ?? reach[0]
    if (h) await page.getByTestId(`hex-${h}`).dispatchEvent('click')
    await page.waitForTimeout(250)
    facings = await ids(page, 'move-facing-', ':not([disabled])')
  }
  if (facings.length) await page.getByTestId(facings[Math.floor(facings.length / 2)]!).click()
  if (await enabled(page.getByTestId('move-confirm'))) return `${m} ${best?.h ?? reach[0]}`
  // nothing reachable on screen: stand still (always offered when the unit is on the board)
  if (await enabled(page.getByTestId('move-mode-stand'))) return 'stand'
  return 'none'
}

export async function confirmMove(page: Page): Promise<void> {
  if (await enabled(page.getByTestId('move-confirm'))) await page.getByTestId('move-confirm').click()
  else if (await enabled(page.getByTestId('move-mode-stand'))) await page.getByTestId('move-mode-stand').click()
}

/** Answer whatever generic prompt is open with its default (highlighted) button, else its first enabled button. */
export async function answerGeneric(page: Page): Promise<void> {
  const dock = page.locator('.hud-dock').first()
  const def = dock.locator('.hud-btn-default')
  if (await enabled(def)) { await def.first().click(); return }
  await dock.locator('button:not([disabled])').first().click()
}

/** Fire: pick the first target, tick every legal weapon, fire (or hold when nothing is legal). */
export async function prepareFire(page: Page): Promise<void> {
  const targets = await ids(page, 'fire-target-')
  if (targets.length) await page.getByTestId(targets[0]!).click()
  if (await enabled(page.getByTestId('fire-all'))) await page.getByTestId('fire-all').click()
  await page.waitForTimeout(150)
}
export async function commitFire(page: Page): Promise<void> {
  if (await enabled(page.getByTestId('fire-confirm'))) await page.getByTestId('fire-confirm').click()
  else await page.getByTestId('fire-hold').click()
}

/** Physical: kick when the engine allows it, else the first legal option, else none. */
export async function playPhysical(page: Page): Promise<string> {
  const targets = await ids(page, 'phys-target-')
  if (targets.length) await page.getByTestId(targets[0]!).click()
  const opts = await ids(page, 'phys-option-', ':not([disabled])')
  const pick = opts.find((o) => o.includes('kick')) ?? opts[0]
  if (pick) {
    await page.getByTestId(pick).check()
    if (await enabled(page.getByTestId('phys-confirm'))) { await page.getByTestId('phys-confirm').click(); return pick }
  }
  await page.getByTestId('phys-none').click()
  return 'none'
}
