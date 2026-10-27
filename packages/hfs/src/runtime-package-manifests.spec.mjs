// Pre-pack admission: a path named by a shipped manifest that the archive lacks is red before npm packs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestAdmission, REQUIRED_MANIFESTS } from '../runtime/scripts/lib/runtime-package-manifests.mjs';

const EXAMPLES = `examples:
  - id: api
    path: full-app
    files:
      - be/a.ts
    entrypoint: be/a.ts
    projects:
      - be/tsconfig.json
    tests:
      - be/a.spec.ts
`;
const SCHEMAS = `schemas:
  - id: urn:x
    file: modules/schemas/x.schema.yaml
moduleLocalDocumentKinds:
  - id: starci/local@1
    files: [modules/kernel/local.yaml]
`;
const knowledge = (body) => `schema: starci/knowledge-source@1\nid: k\n${body}`;
const SOURCES = {
  'examples/index.yaml': EXAMPLES,
  'modules/schemas/index.yaml': SCHEMAS,
  'knowledge/index.yaml': knowledge('branches:\n  - id: b\n    path: grammars/index.yaml\n'),
  'knowledge/grammars/index.yaml': knowledge('families:\n  - id: f\n    authority: f/family.yaml\n    index: f/index.yaml\n'),
  'knowledge/grammars/f/index.yaml': knowledge('topics:\n  - title: T\n    path: t.md\n'),
  'knowledge/patterns/be/index.yaml': knowledge('topics:\n  - title: P\n    path: p.yaml\n'),
};
const FILES = ['examples/full-app/be/a.ts', 'examples/full-app/be/tsconfig.json', 'examples/full-app/be/a.spec.ts',
  'modules/schemas/x.schema.yaml', 'modules/kernel/local.yaml', 'knowledge/grammars/index.yaml', 'knowledge/grammars/f/family.yaml',
  'knowledge/grammars/f/index.yaml', 'knowledge/grammars/f/t.md', 'knowledge/patterns/be/p.yaml'];
const run = ({ sources = SOURCES, drop = [], add = [] } = {}) =>
  manifestAdmission({ root: 'unused', selected: [...Object.keys(sources), ...FILES, ...add].filter((file) => !drop.includes(file)), readFile: (file) => sources[file] });

test('every manifest, required or derived from the selection, yields references and the whole tree is admitted', () => {
  const result = run();
  assert.equal(result.red, undefined);
  assert.deepEqual(Object.keys(result.counts).sort(), Object.keys(SOURCES).sort());
  for (const [file, count] of Object.entries(result.counts)) assert.ok(count > 0, `${file} yields references`);
  assert.equal(result.references, 4 + 2 + 1 + 2 + 1 + 1);
});

test('the required manifest set is pinned exactly', () => {
  assert.deepEqual([...REQUIRED_MANIFESTS], ['examples/index.yaml', 'modules/schemas/index.yaml', 'knowledge/index.yaml']);
});

test('a dangling path is red in each kind of manifest', () => {
  const cases = [
    ['examples/index.yaml', EXAMPLES.replace('- be/a.ts\n    entrypoint', '- be/orders-list.input.ts\n    entrypoint'), /orders-list\.input\.ts/],
    ['modules/schemas/index.yaml', SCHEMAS.replace('x.schema.yaml', 'gone.schema.yaml'), /gone\.schema\.yaml/],
    ['modules/schemas/index.yaml', SCHEMAS.replace('local.yaml', 'gone.yaml'), /modules\/kernel\/gone\.yaml/],
    ['knowledge/index.yaml', SOURCES['knowledge/index.yaml'].replace('grammars/index.yaml', 'nope/index.yaml'), /knowledge\/nope\/index\.yaml/],
    ['knowledge/patterns/be/index.yaml', knowledge('topics:\n  - title: P\n    path: does-not-ship.yaml\n'), /does-not-ship\.yaml/],
    ['knowledge/grammars/index.yaml', SOURCES['knowledge/grammars/index.yaml'].replace('f/index.yaml', 'f/missing-index.yaml'), /missing-index\.yaml/],
    ['knowledge/grammars/index.yaml', SOURCES['knowledge/grammars/index.yaml'].replace('f/family.yaml', 'f/gone.yaml'), /f\/gone\.yaml/],
  ];
  for (const [file, text, pattern] of cases) {
    const result = run({ sources: { ...SOURCES, [file]: text } });
    assert.match(result.red ?? '', pattern, file);
  }
});

test('a path that escapes the package never resolves', () => {
  const result = run({ sources: { ...SOURCES, 'modules/schemas/index.yaml': SCHEMAS.replace('modules/schemas/x.schema.yaml', '../outside.yaml') } });
  assert.match(result.red, /outside\.yaml/);
});

test('a required manifest missing from the selection is red, not skipped', () => {
  for (const file of REQUIRED_MANIFESTS) assert.match(run({ drop: [file] }).red, new RegExp(`required manifest.*${file.replaceAll('.', '\.')}`));
});

test('a manifest whose reference keys vanish is red instead of checking nothing', () => {
  for (const file of Object.keys(SOURCES)) {
    const emptied = file.startsWith('knowledge/') ? knowledge('title: renamed keys\nitems:\n  - path: x.md\n') : 'unknown:\n  - a\n';
    assert.match(run({ sources: { ...SOURCES, [file]: emptied } }).red ?? '', /yields no file references/, file);
  }
});

test('an unreadable manifest is unrun, and an index of another schema is not a knowledge manifest', () => {
  const broken = manifestAdmission({ root: 'unused', selected: [...Object.keys(SOURCES), ...FILES], readFile: () => { throw new Error('gone'); } });
  assert.match(broken.unrun, /unreadable/);
  const other = run({ sources: { ...SOURCES, 'knowledge/other/index.yaml': 'schema: something/else@1\ntopics: []\n' } });
  assert.equal(other.red, undefined);
  assert.equal(other.counts['knowledge/other/index.yaml'], undefined);
});
