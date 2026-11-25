// The managed .gitattributes `app sync` renders (templates/app/skeleton/.gitattributes): `.starcistacks/** text eol=lf` keeps the
// deploy data LF, and a binary file there (a brand reference image, a font) stays binary, so git never rewrites its bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { withoutGitLocalEnv } from '../runtime/scripts/lib/git.mjs';

const TEMPLATE = path.join(import.meta.dirname, '..', 'templates', 'app', 'skeleton', '.gitattributes');

test('the managed .gitattributes keeps binaries binary under the LF text rule of .starcistacks', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gitattributes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = withoutGitLocalEnv(process.env);
  execFileSync('git', ['-C', root, 'init', '-q'], { env, stdio: 'ignore' });
  fs.writeFileSync(path.join(root, '.gitattributes'), fs.readFileSync(TEMPLATE, 'utf8').replace('{{header}}', '# managed'));
  const attrs = (file: string): Record<string, string> => {
    const out = execFileSync('git', ['-C', root, 'check-attr', 'text', 'eol', 'diff', 'merge', '--', file], { env, encoding: 'utf8' });
    return Object.fromEntries(out.trim().split(/\r?\n/u).map((line) => { const [, name, value] = line.split(': '); return [name, value]; }));
  };
  for (const file of ['.starcistacks/brand/references/chip.png', '.starcistacks/brand/assets/logo.webp', '.starcistacks/images/web/font.woff2',
    'fe/apps/web/public/hero.jpg', '.starcistacks/prod/secrets/app.enc']) {
    const got = attrs(file);
    assert.equal(got.text, 'unset', `${file} is not text`);
    assert.equal(got.diff, 'unset', `${file} has no text diff`);
  }
  for (const file of ['.starcistacks/application-stacks.yaml', '.starcistacks/prod/README.md', 'scripts/deploy.sh']) {
    assert.deepEqual([attrs(file).text, attrs(file).eol], ['set', 'lf'], `${file} stays LF text`);
  }
  assert.equal(attrs('.starcistacks/cache/check/hfs/records.jsonl').merge, 'union', 'the check cache keeps its union merge');
});
