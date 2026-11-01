import { defineConfig } from '@playwright/test';

// The render proof: every story of the built Storybook, in both families, light and dark, at 1920 and 390, device scale factor 2.
// Baselines live in proof/baselines and are committed. They are unreviewed: they detect change and approve nothing; only
// proof/approved.json names approved pictures. A picture may differ by 0.05% (anti-aliasing only: the PagePanes layout instability is fixed in the Page fill measure; 160 of 160 repeats were identical at zero tolerance). A changed picture fails the run and is reported as changed. Baselines are taken in the pinned Playwright image (Linux), the one CI runs in.
export default defineConfig({
  testDir: 'proof',
  snapshotPathTemplate: 'proof/baselines/{projectName}/{arg}{ext}',
  outputDir: 'proof/results',
  reporter: [['line'], ['./proof/reporter.ts'], ['html', { outputFolder: 'proof/report', open: 'never' }]],
  workers: 4,
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.0005 } },
  use: { baseURL: 'http://127.0.0.1:6007', deviceScaleFactor: 2, reducedMotion: 'reduce' },
  projects: [
    { name: '1920', use: { viewport: { width: 1920, height: 1080 } } },
    { name: '390', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'node scripts/serve-static.mts storybook-static 6007', url: 'http://127.0.0.1:6007/iframe.html', reuseExistingServer: false },
});
