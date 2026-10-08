import { defineConfig, devices } from '@playwright/test'

// PW_PORT lets a run avoid a port another project already holds.
const PORT = Number(process.env.PW_PORT ?? 4173)
// Production base path (see vite.config.ts) — the preview server serves the
// build under this sub-path, matching GitHub Pages.
const BASE_URL = `http://localhost:${PORT}/warmechforge/`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  // Use the real GPU where there is one (Windows dev box): software WebGL starves the main thread and slows every timed beat.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'] } } }],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
