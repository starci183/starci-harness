import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SpawnSyncReturns } from 'node:child_process';
import type { TestContext } from 'node:test';
import { mkdtemp } from './tmpdir.mjs';

export type RefLine = readonly [name: string, sha: string, name2: string, remote: string];
export interface PrePushRepository { root: string; hook: string; head: string; older: string }

export const ZERO = '0'.repeat(40);
export const git = (cwd: string, ...args: string[]): string => {
  const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};

/**
 * Install a package-resolution wrapper so the rendered hook runs the actual bundled gate in a disposable Git repository, beside a
 * stand-in for the harness's `starci deps check --push-refs <the hook's stdin>` that exits with `depsExit` and its `starci app check --env prod --level full` that exits with `freshExit`.
 * The fast level of a landing on dev (`app check --env prod --level dev --push-refs <stdin>`) is the CLI's deps check (off when `depsMode` is off) then the check: it exits
 * with `depsExit`, else `freshExit`. Its `starci lane into` prints `landInto`, the integration branch the lanes land into; without it the stand-in
 * refuses the verb, as a CLI older than it does.
 */
export function repository(t: Pick<TestContext, 'after'>, hookText: string, { depsExit = 0, freshExit = 0, depsMode = 'blocking', landInto }: { depsExit?: number; freshExit?: number; depsMode?: 'blocking' | 'off'; landInto?: string } = {}): PrePushRepository {
  const root = mkdtemp(t, 'hfs-pre-push-');
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'a.txt'), 'first');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-q', '-m', 'first');
  const older = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'a.txt'), 'second');
  git(root, 'commit', '-qam', 'second');
  const head = git(root, 'rev-parse', 'HEAD');
  git(root, 'branch', 'dev');
  const pkg = path.join(root, 'node_modules', '@starci', 'hfs');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ type: 'module', exports: { './runtime/scripts/guards/release-push-gate.mjs': './gate.mjs' } }));
  const gate = pathToFileURL(path.resolve(import.meta.dirname, '../../runtime/scripts/guards/release-push-gate.mjs')).href;
  fs.writeFileSync(path.join(pkg, 'gate.mjs'), `export { main } from ${JSON.stringify(gate)};\n`);
  const harness = path.join(root, 'node_modules', 'starci-harness', 'dist');
  fs.mkdirSync(harness, { recursive: true });
  fs.writeFileSync(path.join(harness, 'main.js'), [
    "const verb = process.argv.slice(2).join(' ');",
    `if (verb === 'app check --env prod --level full') { console.log('app check judged branch: ' + (process.env.STARCI_JUDGED_BRANCH || '(the checkout)') + ', push gate: ' + (process.env.STARCI_PUSH_GATE || '(not set)') + ', level full'); if (${freshExit} !== 0) console.error('HFS_CHECK_CACHE_UNWARMED: stand-in'); process.exit(${freshExit}); }`,
    "const fast = process.argv.slice(2);",
    `if (fast.slice(0, 7).join(' ') === 'app check --env prod --level dev --push-refs' && fast.length === 8) { console.log('app check level dev, push refs: ' + fast[7].split(/\\r?\\n/).join(' | ')); if ('${depsMode}' === 'off') console.log('deps: off by declaration (gates of .starcistacks/application-stacks.yaml), not run'); else if (${depsExit} !== 0) { console.error('DEPS_PIN_UNPUBLISHED: stand-in'); process.exit(${depsExit}); } process.exit(${freshExit}); }`,
    `if (verb === 'app check --profile --gate deps') { console.log('${depsMode}'); process.exit(0); }`,
    `if (verb === 'lane into') { ${landInto === undefined ? 'process.exit(2);' : `console.log(${JSON.stringify(landInto)}); process.exit(0);`} }`,
    "const args = process.argv.slice(2);",
    "if (args[0] !== 'deps' || args[1] !== 'check' || args[2] !== '--push-refs' || !(args[3] || '').includes(' refs/') || args.length !== 4) process.exit(2);",
    `if (${depsExit} !== 0) console.error('DEPS_PIN_UNPUBLISHED: stand-in');`,
    `process.exit(${depsExit});`,
    '',
  ].join('\n'));
  const hook = path.join(root, 'pre-push.sh');
  fs.writeFileSync(hook, hookText);
  return { root, hook, head, older };
}

/** Execute the generated shell with Git's ref-list input and a bounded child lifetime. */
export function push({ root, hook }: Pick<PrePushRepository, 'root' | 'hook'>, lines: readonly (readonly string[])[]): SpawnSyncReturns<string> {
  const result = spawnSync('sh', [hook], { cwd: root, input: lines.map(line => line.join(' ')).join('\n') + '\n', encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

export const ref = (name: string, sha: string, remote: string = ZERO): RefLine => [name, sha, name, remote];
