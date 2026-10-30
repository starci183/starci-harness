#!/usr/bin/env node
/**
 * Runs every story's play function headless, once per family, against a running Storybook.
 *
 *   node scripts/run-plays.mts [--url http://localhost:6006] [--family core,offset-pop] [--filter <substring>]
 *
 * Each story loads in the preview iframe with the family set through `globals`. A story whose
 * parameters name a viewport (`viewport.defaultViewport`, or a story-level `globals.viewport`) is
 * reloaded at that size; everything else runs at 1440x900. A story passes when the preview channel
 * emits `storyFinished` with no exception before it: in Storybook 10 a failed play still renders
 * the story and is reported only on the channel. Exit code 1 lists the failures.
 */
import { chromium, type Page } from 'playwright';

declare global {
  interface Window {
    __grammarPlay: { errors: string[]; finished: boolean };
    __STORYBOOK_ADDONS_CHANNEL__: { emit: (name: string, ...payload: unknown[]) => unknown } | undefined;
    __STORYBOOK_PREVIEW__:
      | {
          storyStoreValue?: {
            loadStory: (arg: { storyId: string }) => Promise<{
              parameters?: {
                viewport?: {
                  defaultViewport?: string;
                  options?: Record<string, { styles?: { width: string; height: string } }>;
                };
              };
              storyGlobals?: { viewport?: { value?: string } };
              globals?: { viewport?: { value?: string } };
            }>;
          };
        }
      | undefined;
  }
}

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1]!;
};
const base = option('url', 'http://localhost:6006').replace(/\/$/, '');
const families = option('family', 'core,offset-pop').split(',');
const filter = option('filter', '');

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  mobile1: { width: 320, height: 568 },
  mobile2: { width: 414, height: 896 },
  tablet: { width: 834, height: 1112 },
};
const DESKTOP = { width: 1440, height: 900 };

// Parsed input boundary: index.json is Storybook output; the cast names the fields the filter below reads.
const index = (await (await fetch(`${base}/index.json`)).json()) as { entries: Record<string, { id: string; type: string }> };
const ids = Object.values(index.entries)
  .filter((entry) => entry.type === 'story' && entry.id.includes(filter))
  .map((entry) => entry.id);

/** Runs in the page before the preview boots: records the channel's verdict events. */
const recordVerdicts = () => {
  window.__grammarPlay = { errors: [], finished: false };
  const hook = () => {
    const channel = window.__STORYBOOK_ADDONS_CHANNEL__;
    if (channel === undefined) {
      setTimeout(hook, 5);
      return;
    }
    const emit = channel.emit.bind(channel);
    channel.emit = (name, ...payload) => {
      if (['playFunctionThrewException', 'storyThrewException', 'storyErrored', 'storyMissing'].includes(name)) {
        const [error] = payload as [{ message?: string; title?: string; description?: string }?];
        window.__grammarPlay.errors.push(`${name}: ${error?.message ?? error?.title ?? error?.description ?? JSON.stringify(error)}`);
      }
      if (name === 'storyFinished') window.__grammarPlay.finished = true;
      return emit(name, ...payload);
    };
  };
  hook();
};

const settle = async (page: Page) => {
  await page.waitForFunction(
    () => window.__grammarPlay?.finished === true || (window.__grammarPlay?.errors.length ?? 0) > 0,
    undefined,
    { timeout: 30000, polling: 100 },
  );
  // An exception arrives before storyFinished; wait for the finish so the verdict is complete.
  await page.waitForFunction(() => window.__grammarPlay.finished === true, undefined, { timeout: 5000, polling: 100 }).catch(() => undefined);
  const errors = await page.evaluate(() => window.__grammarPlay.errors);
  return errors.length === 0 ? 'completed' : `errored: ${errors.join(' | ')}`;
};

const viewportOf = async (page: Page, id: string) =>
  page.evaluate(async (storyId) => {
    const store = window.__STORYBOOK_PREVIEW__?.storyStoreValue;
    if (store === undefined) return undefined;
    const story = await store.loadStory({ storyId });
    const parameters = story.parameters?.viewport ?? {};
    const named = story.storyGlobals?.viewport?.value ?? story.globals?.viewport?.value ?? parameters.defaultViewport;
    if (named === undefined) return undefined;
    const custom = parameters.options?.[named]?.styles;
    if (custom !== undefined) return { width: parseInt(custom.width, 10), height: parseInt(custom.height, 10) };
    return named;
  }, id);

const browser = await chromium.launch();
const failures: string[] = [];
let passed = 0;

for (const family of families) {
  const page = await browser.newPage({ viewport: DESKTOP });
  await page.addInitScript(recordVerdicts);
  for (const id of ids) {
    const url = `${base}/iframe.html?id=${id}&viewMode=story&globals=grammarFamily:${family}`;
    let outcome;
    try {
      await page.setViewportSize(DESKTOP);
      await page.goto(url, { waitUntil: 'load' });
      outcome = await settle(page);
      const viewport = await viewportOf(page, id);
      const size = typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport;
      if (size !== undefined) {
        await page.setViewportSize(size);
        await page.goto(url, { waitUntil: 'load' });
        outcome = await settle(page);
      }
    } catch (error) {
      outcome = `timeout (${(error as Error).message.split('\n')[0]})`;
    }
    if (outcome === 'completed') {
      passed += 1;
    } else {
      failures.push(`${family} ${id}`);
      console.log(`FAIL ${family} ${id}: ${outcome.slice(0, 2000)}`);
    }
  }
  await page.close();
}

await browser.close();
console.log(`\n${passed} passed, ${failures.length} failed (${ids.length} stories x ${families.length} families)`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  ${failure}`);
  process.exitCode = 1;
}
