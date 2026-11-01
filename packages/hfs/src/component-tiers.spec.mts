import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkComponentLayers, checkGrammarLibraries } from '../runtime/scripts/hfs/architecture/component-tiers.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';

const MATRIX = {
  leaf: { mayImport: ['leaf'] },
  branch: { mayImport: ['leaf', 'branch'] },
  composite: { mayImport: ['leaf', 'branch', 'composite'] },
  frame: { mayImport: ['leaf', 'branch', 'composite', 'frame'] },
};

/** A temporary repository holding the given files, removed when the test ends. */
function tree(t: TestContext, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'component-tiers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const ids = (result: { violations: { ruleId: string }[] }) => result.violations.map(violation => violation.ruleId);

test('1. a library whose imports point down is green and counts its edges', (t) => {
  const root = tree(t, {
    'packages/ui/src/core/leaf/Text/index.tsx': 'export const Text = () => <span data-tier="leaf" />;\n',
    'packages/ui/src/core/branch/Input/index.tsx': 'import { Text } from "../../leaf/Text/index.js";\nexport const Input = () => <i data-tier="branch"><Text /></i>;\n',
    'packages/ui/src/core/frame/Stack/index.tsx': 'import { Input } from "../../branch/Input/index.js";\nexport const Stack = () => <b data-tier="frame"><Input /></b>;\n',
  });
  const result = checkGrammarLibraries({ root, matrix: MATRIX });
  assert.deepEqual(result.violations, []);
  assert.equal(result.coverage.status, 'checked');
  assert.equal(result.coverage.edgesChecked, 2);
});

test('2. a leaf importing a branch is FE_GRAMMAR_TIER_DIRECTION, a type-only import included', (t) => {
  const root = tree(t, {
    'packages/ui/src/core/leaf/Button/index.tsx': 'import type { TooltipProps } from "../../branch/Tooltip/index.js";\nexport const Button = (p: TooltipProps) => <b data-tier="leaf" />;\n',
    'packages/ui/src/core/branch/Tooltip/index.tsx': 'export type TooltipProps = { x: 1 };\nexport const Tooltip = () => <i data-tier="branch" />;\n',
  });
  const result = checkGrammarLibraries({ root, matrix: MATRIX });
  assert.deepEqual(ids(result), ['FE_GRAMMAR_TIER_DIRECTION']);
  assert.equal(result.violations[0]?.path, 'packages/ui/src/core/leaf/Button/index.tsx');
  assert.match(result.violations[0]?.message ?? '', /a leaf may import only leaf/);
});

test('2. a shared module under src/core does not hide the climb', (t) => {
  const root = tree(t, {
    'packages/ui/src/core/leaf/Icon/index.tsx': 'import { shared } from "../../shared.js";\nexport const Icon = () => shared;\n',
    'packages/ui/src/core/shared.tsx': 'import { Card } from "./frame/Card/index.js";\nexport const shared = Card;\n',
    'packages/ui/src/core/frame/Card/index.tsx': 'export const Card = () => <div data-tier="frame" />;\n',
  });
  const result = checkGrammarLibraries({ root, matrix: MATRIX });
  assert.deepEqual(ids(result), ['FE_GRAMMAR_TIER_DIRECTION']);
  assert.match(result.violations[0]?.message ?? '', /through packages\/ui\/src\/core\/shared\.tsx/);
});

test('3. a data-tier stamp must equal the folder', (t) => {
  const root = tree(t, {
    'packages/ui/src/core/leaf/Dot/index.tsx': 'export const Dot = () => <i data-tier="atom" />;\n',
    'packages/ui/src/core/composite/Row/index.tsx': 'export const Row = () => <i {...{ "data-tier": "composition" }} />;\n',
    'packages/ui/src/core/frame/Ok/index.tsx': 'export const Ok = () => <i data-tier="frame" />;\n',
  });
  const result = checkGrammarLibraries({ root, matrix: MATRIX });
  assert.deepEqual(ids(result), ['FE_GRAMMAR_TIER_STAMP', 'FE_GRAMMAR_TIER_STAMP']);
});

test('3. a repository with no grammar library is not applicable; stories and specs are not judged', (t) => {
  const none = tree(t, { 'src/index.ts': 'export {};\n' });
  assert.equal(checkGrammarLibraries({ root: none, matrix: MATRIX }).coverage.status, 'not-applicable');
  const root = tree(t, {
    'packages/ui/src/core/leaf/Text/index.tsx': 'export const Text = () => <i data-tier="leaf" />;\n',
    'packages/ui/src/core/leaf/Text/Text.stories.tsx': 'import { Card } from "../../frame/Card/index.js";\nexport default Card;\n',
    'packages/ui/src/core/frame/Card/index.tsx': 'export const Card = () => <div data-tier="frame" />;\n',
  });
  assert.deepEqual(checkGrammarLibraries({ root, matrix: MATRIX }).violations, []);
});

test('4. a component tree imports only the layers after its own', (t) => {
  const layers = ['blocks', 'frames', 'composites', 'branches', 'leaves'];
  const root = tree(t, {
    'app/src/components/blocks/Page/index.tsx': 'import { Row } from "../../composites/Row/index.js";\nexport const Page = Row;\n',
    'app/src/components/composites/Row/index.tsx': 'import { Dot } from "../../leaves/Dot/index.js";\nexport const Row = Dot;\n',
    'app/src/components/leaves/Dot/index.tsx': 'import { Row } from "../../composites/Row/index.js";\nexport const Dot = Row;\n',
  });
  const result = checkComponentLayers({ root, layers });
  assert.deepEqual(ids(result), ['FE_TIER_DIRECTION']);
  assert.equal(result.violations[0]?.path, 'app/src/components/leaves/Dot/index.tsx');
  assert.match(result.violations[0]?.message ?? '', /a leaves component may import only the layers after it/);
});

test('5. the slot manifest carries tiers.grammar and refuses a tier it does not name', () => {
  const manifest = loadSlotManifest();
  const grammar = (manifest.tiers as Record<string, Record<string, { mayImport: string[] }>>).grammar;
  assert.deepEqual(Object.keys(grammar ?? {}), ['leaf', 'branch', 'composite', 'frame']);
  assert.deepEqual(grammar?.leaf?.mayImport, ['leaf']);
  assert.deepEqual(grammar?.frame?.mayImport, ['leaf', 'branch', 'composite', 'frame']);
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const hasTree = fs.existsSync(path.join(repoRoot, 'packages', 'grammar', 'src', 'core', 'leaf')) && fs.existsSync(path.join(repoRoot, 'app', 'src', 'components'));

test('6. the grammar package and the desktop app of this repository pass their tier check', { skip: !hasTree }, () => {
  const manifest = loadSlotManifest();
  const matrix = (manifest.tiers as Record<string, Record<string, { mayImport: string[] }>>).grammar as Record<string, { mayImport: string[] }>;
  const grammar = checkGrammarLibraries({ root: path.join(repoRoot, 'packages', 'grammar'), matrix });
  assert.deepEqual(grammar.violations.map(violation => `${violation.ruleId} ${violation.message}`), []);
  const layers = (manifest.slots.find(slot => slot.id === 'fe.components') as { layers?: string[] }).layers as string[];
  const app = checkComponentLayers({ root: path.join(repoRoot, 'app'), layers });
  assert.deepEqual(app.violations.map(violation => violation.message), []);
  assert.equal(app.coverage.status, 'checked');
});
