// proves: HFS_STATICS_FILE_KIND
// proves: HFS_STATICS_FILE_KIND
// proves: HFS_STATICS_KEY
// proves: HFS_STATICS_KEY
// proves: HFS_STATICS_FILE_SIZE
// proves: HFS_STATICS_FILE_SIZE
// proves: HFS_STATICS_TREE_SIZE
// proves: HFS_STATICS_TREE_SIZE
// proves: HFS_STATICS_PROMPT_ORPHAN
// proves: HFS_STATICS_PROMPT_ORPHAN
// proves: HFS_STATICS_PROMPT_SCHEMA
// proves: HFS_STATICS_PROMPT_SCHEMA
// R438: the shape of statics/ (rules/statics-shape.mts): the kinds, the kebab-case key, the sizes, the prompt sidecar. Each code has a good and a bad fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { staticsShapeFindings, STATICS_WARN_BYTES, STATICS_MAX_BYTES } from '../runtime/scripts/hfs/rules/statics-shape.mjs';

/** An app root holding `files` (path -> text or a byte count), judged as the app root of `edition`. */
function run(files: Record<string, string | number>, edition = 'lite'): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statics-shape-'));
  try {
    for (const [file, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), typeof body === 'number' ? Buffer.alloc(body) : body);
    }
    return staticsShapeFindings({ repoRoot: root, repo: { kind: 'app', edition }, isRoot: true, all: Object.keys(files) }).map((finding) => `${finding.code}:${finding.level}:${finding.path}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const PROMPT = 'model: m\nprompt: a calm empty state\n';

for (const edition of ['lite'] as const) {
  test(`a well-formed statics/ tree is clean`, () => {
    assert.deepEqual(run({ 'statics/.gitkeep': '', 'statics/illustrations/empty/customers-v2.png': 4, 'statics/illustrations/empty/customers-v2.prompt.yaml': PROMPT, 'statics/video/intro.webm': 4 }, edition), []);
    assert.deepEqual(run({ 'statics/.gitkeep': '' }, edition), []);
  });

  test(`HFS_STATICS_FILE_KIND is a file that is neither media nor a prompt sidecar`, () => {
    assert.deepEqual(run({ 'statics/docs/readme.md': 'x', 'statics/docs/data.json': '{}' }, edition), ['HFS_STATICS_FILE_KIND:error:statics/docs/readme.md', 'HFS_STATICS_FILE_KIND:error:statics/docs/data.json']);
  });

  test(`HFS_STATICS_KEY is a segment that is not lowercase kebab-case, an upper-case extension or a file outside an area folder`, () => {
    assert.deepEqual(run({ 'statics/Illustrations/empty.png': 1 }, edition), ['HFS_STATICS_KEY:error:statics/Illustrations/empty.png']);
    assert.deepEqual(run({ 'statics/art/My_Image.png': 1 }, edition), ['HFS_STATICS_KEY:error:statics/art/My_Image.png']);
    assert.deepEqual(run({ 'statics/art/empty.PNG': 1 }, edition), ['HFS_STATICS_KEY:error:statics/art/empty.PNG']);
    assert.deepEqual(run({ 'statics/empty.png': 1 }, edition), ['HFS_STATICS_KEY:error:statics/empty.png']);
  });

  test(`HFS_STATICS_FILE_SIZE warns above 2 MiB and fails above 10 MiB`, () => {
    assert.deepEqual(run({ 'statics/art/a.png': STATICS_WARN_BYTES }, edition), []);
    assert.deepEqual(run({ 'statics/art/a.png': STATICS_WARN_BYTES + 1 }, edition), ['HFS_STATICS_FILE_SIZE:warning:statics/art/a.png']);
    assert.deepEqual(run({ 'statics/art/a.png': STATICS_MAX_BYTES + 1 }, edition), ['HFS_STATICS_FILE_SIZE:error:statics/art/a.png']);
  });

  test(`HFS_STATICS_TREE_SIZE is a tree above 256 MiB`, () => {
    const files: Record<string, number> = {};
    for (let index = 0; index < 27; index += 1) files[`statics/art/big-${String(index)}.mp4`] = STATICS_MAX_BYTES;
    const found = run(files, edition);
    assert.ok(found.includes('HFS_STATICS_TREE_SIZE:error:statics'), found.join(','));
    assert.ok(!run({ 'statics/art/a.png': 5 }, edition).some((entry) => entry.startsWith('HFS_STATICS_TREE_SIZE')));
  });

  test(`HFS_STATICS_PROMPT_ORPHAN is a sidecar with no image of its name`, () => {
    assert.deepEqual(run({ 'statics/art/a.prompt.yaml': PROMPT }, edition), ['HFS_STATICS_PROMPT_ORPHAN:error:statics/art/a.prompt.yaml']);
    assert.deepEqual(run({ 'statics/art/a.prompt.yaml': PROMPT, 'statics/art/a.webp': 1 }, edition), []);
  });

  test(`HFS_STATICS_PROMPT_SCHEMA is a sidecar that is not YAML, not a mapping or has no prompt`, () => {
    const image = { 'statics/art/a.png': 1 };
    assert.deepEqual(run({ ...image, 'statics/art/a.prompt.yaml': 'prompt: [unclosed' }, edition), ['HFS_STATICS_PROMPT_SCHEMA:error:statics/art/a.prompt.yaml']);
    assert.deepEqual(run({ ...image, 'statics/art/a.prompt.yaml': '- a\n- b\n' }, edition), ['HFS_STATICS_PROMPT_SCHEMA:error:statics/art/a.prompt.yaml']);
    assert.deepEqual(run({ ...image, 'statics/art/a.prompt.yaml': 'model: m\n' }, edition), ['HFS_STATICS_PROMPT_SCHEMA:error:statics/art/a.prompt.yaml']);
    assert.deepEqual(run({ ...image, 'statics/art/a.prompt.yaml': 'prompt: ok\nsubject: s\nbasePrompt: {version: 2}\n' }, edition), []);
  });

  test(`a repository that is not an app, or a side, is not judged`, () => {
    assert.deepEqual(staticsShapeFindings({ repoRoot: os.tmpdir(), repo: { kind: 'package' }, isRoot: true, all: ['statics/x.md'] }), []);
    assert.deepEqual(staticsShapeFindings({ repoRoot: os.tmpdir(), repo: { kind: 'app', edition }, isRoot: false, all: ['statics/x.md'] }), []);
  });
}
