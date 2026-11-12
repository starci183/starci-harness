import test from 'node:test';
import assert from 'node:assert/strict';
import { appScripts, imageApps } from '../sync/index.mjs';
import { loadSlotManifest, resolveAppDeclaration } from '../runtime/scripts/hfs/slots.mjs';

// The root scripts and the images of an app that holds a client cli beside its ops cli (BE-CLI-5): the root `cli` and `migrate`
// scripts are the ops cli's, the client cli gets `build:<app>` and neither a start script nor an image.

const manifest = loadSlotManifest();
const app = (apps: { name: string; kind: string; package?: string; bin?: string }[]) => resolveAppDeclaration(manifest, {
  hfs: 3,
  kind: 'app',
  project: 'shop',
  sides: {
    be: { apps, kinds: ['api', 'cli', 'client-cli'], connections: [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'database' }] },
    fe: { apps: [{ name: 'web', kind: 'next' }], grammar: 'core' },
  },
});
const scriptsOf = (text: string): Record<string, string> => JSON.parse(`{${text.replace(/,\s*$/, '')}}`);

const CORE = { name: 'core', kind: 'api' };
const OPS = { name: 'cli', kind: 'cli' };
const CLIENT = { name: 'relay-cli', kind: 'client-cli', package: '@acme/relay', bin: 'relay' };

test('the root cli and migrate scripts run the ops cli wherever the client cli is declared', () => {
  for (const apps of [[CORE, OPS, CLIENT], [CORE, CLIENT, OPS], [CLIENT, CORE, OPS]]) {
    const scripts = scriptsOf(appScripts(app(apps), undefined));
    assert.equal(scripts.cli, 'node be/dist/apps/cli/src/main.js');
    assert.equal(scripts.migrate, 'node be/dist/apps/cli/src/main.js migrate run');
  }
});

test('a client cli gets its package build and neither a start script nor an image', () => {
  const resolved = app([CORE, OPS, CLIENT]);
  const scripts = scriptsOf(appScripts(resolved, undefined));
  assert.equal(scripts['build:relay-cli'], 'cd be && tsc -p apps/relay-cli/tsconfig.build.json && tsc-alias -p apps/relay-cli/tsconfig.build.json');
  assert.equal(scripts['start:relay-cli'], undefined);
  assert.equal(scripts['docker:build:relay-cli'], undefined);
  assert.equal(scripts['docker:build'], 'npm run docker:build:core && npm run docker:build:cli && npm run docker:build:web');
  assert.deepEqual(imageApps(resolved, undefined).map((image) => image.name), ['core', 'cli', 'web']);
});
