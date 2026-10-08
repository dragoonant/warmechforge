// Establishing-shot check: frames at 0.5s, 3.5s, 6.8s, then a skip test. node shootEst.mjs [port]
import { chromium } from '@playwright/test'
const port = process.argv[2] ?? '5199'
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const url = `http://localhost:${port}/src/client/environment/dev/shop.html?view=est`
await page.goto(url)
const t0 = Date.now()
const cam = () => page.evaluate(() => { const c = document.querySelector('canvas'); return c ? 'ok' : 'none' })
await page.waitForTimeout(2500)
await page.screenshot({ path: 'e2e-out/shop-est-1.png' })
await page.waitForTimeout(4500)
await page.screenshot({ path: 'e2e-out/shop-est-2.png' })
await page.waitForTimeout(9000)
await page.screenshot({ path: 'e2e-out/shop-est-3.png' })
console.log('ran', Date.now() - t0, await cam())
// skip test
await page.goto(url)
await page.waitForTimeout(2200)
await page.mouse.click(640, 360)
await page.waitForTimeout(1500)
await page.screenshot({ path: 'e2e-out/shop-est-skipped.png' })
await browser.close()
