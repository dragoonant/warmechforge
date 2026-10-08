// node src/client/environment/dev/shoot.mjs [port] [views...]  -> e2e-out/shop-<view>.png (needs `vite --port <port>` running)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const port = process.argv[2] ?? '5199'
const views = process.argv.slice(3).length ? process.argv.slice(3) : ['wide', 'mid', 'play']
mkdirSync('e2e-out', { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)) })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
for (const v of views) {
  const [name, extra] = v.split('|')
  const url = `http://localhost:${port}/src/client/environment/dev/shop.html?${extra ?? 'view=' + name}`
  await page.goto(url)
  await page.waitForFunction(() => window.__shopReady === true, null, { timeout: 90000 })
  await page.waitForTimeout(1500)
  const out = `e2e-out/shop-${name.replace(/[^a-z0-9]+/gi, '-')}.png`
  await page.screenshot({ path: out })
  console.log('saved', out)
}
await browser.close()
