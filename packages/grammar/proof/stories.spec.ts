import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const index: { entries: Record<string, { id: string; type: string }> } = JSON.parse(readFileSync('storybook-static/index.json', 'utf8'));
const approved: string[] = JSON.parse(readFileSync('proof/approved.json', 'utf8'));
const stories = Object.values(index.entries).filter((entry) => entry.type === 'story');

// An approved id that names no story would silently approve nothing (`--grep @approved` matches no test): it fails the run.
test('every approved id names a story of the built Storybook', () => {
  const dead = approved.filter((id) => !stories.some((story) => story.id === id));
  expect(dead, `proof/approved.json names ${dead.join(', ')}, which is not a story id; point it at the renamed story`).toEqual([]);
});

for (const family of ['core', 'offset-pop']) {
  for (const theme of ['light', 'dark']) {
    for (const story of stories) {
      test(`${family} ${theme} ${story.id}${approved.includes(story.id) ? ' @approved' : ''}`, async ({ page }) => {
        // One instant for every run: a countdown or a relative time draws the same words whenever the proof runs.
        await page.clock.setFixedTime(new Date('2026-01-01T00:00:00Z'));
        await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=grammarFamily:${family};grammarTheme:${theme}`);
        await page.locator('.sb-show-main').waitFor();
        // A lazy chunk such as Mermaid has landed before the picture is taken.
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${family}-${theme}-${story.id}.png`, { fullPage: true });
      });
    }
  }
}
