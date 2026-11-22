// Every template hfs ships to an app holds no bypass of the harness's own checks: a hook, a workflow, a script or a config that
// `starci app sync` or `starci app scaffold` writes must pass HFS_BYPASS_MARKER (the tree rule) and `starci app check --staged`
// (the pre-commit guard) the moment the app adopts it, or every app's adopt commit is refused by the harness that wrote it.
// The templates are enumerated from what the renderer reads, never from a hand list:
//   - the managed targets: targetsOf(scope) for every scope with every slot counted (the inventory form), each rendered by render()
//     with every variable empty, and read at the app path it lands on;
//   - the managed targets of a real app declaration (renderTargets), written to a repository and judged by the tree rule whole,
//     so the variables sync fills in and the relaxed-gate-configuration half of the rule are read too;
//   - every other file under TEMPLATES_DIR (scaffold templates, partials), read as it is shipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATES_DIR, render, renderTargets, targetsOf } from '../sync/index.mjs';
import { SCOPES } from '../runtime/scripts/hfs/slot-manifest-shape.mjs';
import { bypassesIn } from '../runtime/scripts/lib/bypass-markers.mjs';
import { bypassMarkerFindings } from '../runtime/scripts/hfs/rules/bypass-markers.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const readTemplate = (name: string): string => fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8').replace(/\r\n/g, '\n');
/** Every variable a template names, present and empty: a variable-only line drops out, an inline one renders as nothing. */
const EMPTY_VARS: Record<string, string> = new Proxy({}, {
  get: () => '',
  has: () => true,
  getOwnPropertyDescriptor: () => ({ value: '', enumerable: true, configurable: true, writable: true }),
});
const atApp = (scope: string, file: string): string => (scope === 'app' ? file : `${scope}/${file}`);
const shown = (hits: { where: string; template: string; line: number; label: string; text: string }[]): string =>
  hits.map((hit) => `${hit.where} (templates/${hit.template}):${hit.line} spells ${hit.label}: ${hit.text}`).join('\n');

const managed = SCOPES.flatMap((scope) => targetsOf(scope).map((target) => ({ where: atApp(scope, target.path), template: target.template })));
const shippedFiles = (fs.readdirSync(TEMPLATES_DIR, { recursive: true }) as string[])
  .map((file) => file.split(path.sep).join('/'))
  .filter((file) => fs.statSync(path.join(TEMPLATES_DIR, file)).isFile());

test('the inventory reads the templates the renderer reads: every managed target, the husky hooks and the workflows among them', () => {
  assert.ok(managed.length >= 100, `${managed.length} managed targets`);
  for (const where of ['.husky/pre-commit', '.husky/pre-push', '.github/workflows/ci.yml']) assert.ok(managed.some((target) => target.where === where), where);
  for (const { template } of managed) assert.ok(shippedFiles.includes(template), template);
});

test('no managed template, rendered, spells a bypass marker at the path it lands on in the app', () => {
  const hits = managed.flatMap(({ where, template }) => bypassesIn(where, render(readTemplate(template), EMPTY_VARS, readTemplate))
    .map((hit) => ({ where, template, ...hit })));
  assert.deepEqual(hits, [], shown(hits));
});

test('the managed render of an app declaration passes HFS_BYPASS_MARKER whole: markers and relaxed gate configuration', (t) => {
  const root = mkdtemp(t, 'starci-shipped-');
  const targets = renderTargets(APP, PRESETS);
  for (const target of targets) {
    fs.mkdirSync(path.dirname(path.join(root, target.path)), { recursive: true });
    fs.writeFileSync(path.join(root, target.path), target.content);
  }
  const found = bypassMarkerFindings({ repoRoot: root, files: targets.map((target) => target.path) });
  assert.deepEqual(found.map((finding) => finding.message), []);
});

test('no other template hfs ships (scaffold templates, partials) spells a bypass marker', () => {
  const rendered = new Set(managed.map((target) => target.template));
  const hits = shippedFiles.filter((file) => !rendered.has(file)).flatMap((template) => {
    const where = template.replace(/\.(?:tpl|partial)$/, '');
    return bypassesIn(where, readTemplate(template)).map((hit) => ({ where, template, ...hit }));
  });
  assert.deepEqual(hits, [], shown(hits));
});
