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
 * stand-in for the harness's `starci deps check` that exits with `depsExit`.
 */
export function repository(t: Pick<TestContext, 'after'>, hookText: string, { depsExit = 0 }: { depsExit?: number } = {}): PrePushRepository {
  const root = mkdtemp(t, 'hfs-pre-push-');
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'a.txt'), 'first');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-q', '-m', 'first');
  const older = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'a.txt'), 'second');
  git(root, 'commit', '-qam', 'second');
  const head = git(root, 'rev-parse', 'HEAD');
  const pkg = path.join(root, 'node_modules', '@starci', 'hfs');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ type: 'module', exports: { './runtime/scripts/guards/release-push-gate.mjs': './gate.mjs' } }));
  const gate = pathToFileURL(path.resolve(import.meta.dirname, '../../runtime/scripts/guards/release-push-gate.mjs')).href;
  fs.writeFileSync(path.join(pkg, 'gate.mjs'), `export { main } from ${JSON.stringify(gate)};\n`);
  const harness = path.join(root, 'node_modules', 'starci-harness', 'dist');
  fs.mkdirSync(harness, { recursive: true });
  fs.writeFileSync(path.join(harness, 'main.js'), `if (process.argv[2] !== 'deps' || process.argv[3] !== 'check') process.exit(2);\nif (${depsExit} !== 0) console.error('DEPS_PIN_UNPUBLISHED: stand-in');\nprocess.exit(${depsExit});\n`);
  const hook = path.join(root, 'pre-push.sh');
  fs.writeFileSync(hook, hookText);
  return { root, hook, head, older };
}

/** Execute the generated shell with Git's ref-list input and a bounded child lifetime. */
export function push({ root, hook }: Pick<PrePushRepository, 'root' | 'hook'>, lines: readonly (readonly string[])[]): SpawnSyncReturns<string> {
  const result = spawnSync('sh', [hook], { cwd: root, input: lines.map(line => line.join(' ')).join('\n') + '\n', encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

export const ref = (name: string, sha: string, remote: string = ZERO): RefLine => [name, sha, name, remote];
