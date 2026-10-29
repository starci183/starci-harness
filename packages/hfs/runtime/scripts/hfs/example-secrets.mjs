// Runtime examples keep names only; checks receive disposable copies with fresh sealed members.
import fs from 'node:fs';
import { memberFile } from '../lib/sealed-member.mjs';
import { safeRemove } from '../api/fs/safe-remove.mjs';
import os from 'node:os';
import path from 'node:path';
import { runProgram } from '../api/process/run-program.mjs';
import { init as initGit } from '../api/git/init.mjs';
import { add as addGit } from '../api/git/add.mjs';
import { revParseQuery } from '../api/git/rev-parse-query.mjs';
import { mergeBase } from '../api/git/merge-base.mjs';
import { writeTree } from '../api/git/write-tree.mjs';
import { commitTree } from '../api/git/commit-tree.mjs';
import { updateRef } from '../api/git/update-ref.mjs';
import { stringifyYaml } from '../../engine/yaml.mjs';
import { isMain } from '../lib/is-main.mjs';
import { readEnv } from '../lib/env.mjs';
import { withoutGitLocalEnv } from '../lib/git.mjs';
import { resolveRealTool } from '../api/process/resolve-real-tool.mjs';
import { generateAppIdentity } from './secret-bootstrap-crypto.mjs';
import { declaredSealedMembers, materializeDeclaredPlaceholders } from './sealed-members.mjs';

const SKIPPED = new Set(['.git', '.claude', '.secrets', '.aws', '.codex', '.agents', 'node_modules', '.next', '.turbo', 'dist', 'coverage']);
const PATH_RULE = String.raw`\.starcistacks[/\\][^/\\]+[/\\]secrets[/\\][^/\\]+\.enc(?:\.yaml)?$`;

function writePublicRecipient(repoRoot, recipient) {
  fs.writeFileSync(path.join(repoRoot, '.sops.yaml'), stringifyYaml({
    creation_rules: [{ path_regex: PATH_RULE, age: recipient }],
  }));
  const stacks = path.join(repoRoot, '.starcistacks');
  for (const entry of fs.readdirSync(stacks, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(stacks, entry.name, 'backup.recipient');
    if (fs.existsSync(file)) fs.writeFileSync(file, `${recipient}\n`);
  }
}

/** Generate genuine sealed members; the fresh private identity is confined to os.tmpdir and removed before return. */
export async function materializeExample(repoRoot, { createIdentity = generateAppIdentity, sops } = {}) {
  const declared = declaredSealedMembers(repoRoot);
  if (!declared.length) return { members: [] };
  if (declared.some(({ env, slug }) => fs.existsSync(memberFile(path.join(repoRoot, '.starcistacks', env, 'secrets'), slug))))
    throw new Error('example materialization requires a disposable copy without existing sealed members');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-example-age-'));
  try {
    const selected = createIdentity();
    try {
      fs.writeFileSync(path.join(directory, 'identity.txt'), selected.identity, { mode: 0o600, flag: 'wx' });
    } finally {
      selected.identity.fill(0);
    }
    writePublicRecipient(repoRoot, selected.recipient);
    return materializeDeclaredPlaceholders(repoRoot, { recipient: selected.recipient, sops });
  } finally {
    safeRemove(directory, { hold: () => null });
  }
}

const COMMITTER = { 'user.name': 'starci', 'user.email': 'l4@starci.invalid' };
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const ok = (r) => !r.error && r.status === 0 && Boolean(String(r.stdout ?? '').trim());

/**
 * The lint base the copy's size-growth ratchet measures against: the source app's subtree at the source repository's
 * lint baseline (STARCI_BASE_REF, then origin/main, then main),
 * re-committed inside the copy so `merge-base` and `git show` resolve here. The source objects are reached through an
 * objects alternate, never copied. An app absent at the baseline bases on the empty tree: every file is new.
 * Returns the synthetic base commit sha, or null when the source sits in no repository. Missing repository baselines fail explicitly.
 */
function sealedLintBase(repoRoot, source, env) {
  const query = { cwd: source, env };
  const top = revParseQuery(['--show-toplevel'], query);
  if (!ok(top)) return null;
  const common = revParseQuery(['--git-common-dir'], query);
  if (!ok(common)) return null;
  const candidates = [...(env.STARCI_BASE_REF ? [env.STARCI_BASE_REF] : []), 'origin/main', 'main'];
  let baseSha = null;
  for (const ref of candidates) {
    baseSha = mergeBase(source, 'HEAD', ref);
    if (baseSha) break;
  }
  if (!baseSha) throw new Error('sealed lint baseline unavailable: set STARCI_BASE_REF to a source commit sharing history with HEAD, or fetch origin/main or main');
  const relative = path.relative(top.stdout.trim(), path.resolve(source)).split(path.sep).join('/');
  const tree = revParseQuery(['--verify', '--quiet', relative && !relative.startsWith('..') ? `${baseSha}:${relative}` : `${baseSha}^{tree}`], query);
  const baseTree = ok(tree) ? tree.stdout.trim() : EMPTY_TREE;
  const info = path.join(repoRoot, '.git', 'objects', 'info');
  fs.mkdirSync(info, { recursive: true });
  fs.appendFileSync(path.join(info, 'alternates'), `${path.resolve(source, common.stdout.trim()).split(path.sep).join('/')}/objects\n`);
  const base = commitTree([baseTree, '-m', 'sealed lint base'], { cwd: repoRoot, env, config: COMMITTER });
  if (!ok(base)) throw new Error('could not commit the lint base of the isolated example git tree');
  return base.stdout.trim();
}

function trackExample(repoRoot, source) {
  const env = withoutGitLocalEnv(process.env);
  if (!initGit(repoRoot, { env }).ok) throw new Error('could not initialize the isolated example git tree');
  // The linked node_modules (linkExampleDependencies: a junction on Windows, a symlink elsewhere) is the install, never a tracked entry: git treats a
  // symlink as a file, which the app's `node_modules/` (directory) ignore line does not match, so on Linux `git add -A` tracked it (HFS_TRACKED_MUST_BE_IGNORED,
  // HFS_ROOT_ENTRY_FORBIDDEN in every examples.yml lint since the link). The copy's own exclude file ignores it in any form.
  fs.appendFileSync(path.join(repoRoot, '.git', 'info', 'exclude'), ['', '# the linked install of the example (example-secrets.mjs)', 'node_modules', ''].join('\n'));
  const staged = addGit(['-A', '--', '.'], { cwd: repoRoot, env });
  if (staged.error || staged.status !== 0) throw new Error('could not stage the isolated example git tree');
  // The isolated tree is committed (and based on the source's lint baseline) so the size-growth ratchet reads a real
  // recorded size instead of failing "baseline unavailable" in every sealed lint, as it did on a historyless tree.
  const base = sealedLintBase(repoRoot, source, env);
  const tree = writeTree([], { cwd: repoRoot, env });
  if (!ok(tree)) throw new Error('could not write the isolated example git tree');
  const committed = commitTree([tree.stdout.trim(), ...(base ? ['-p', base] : []), '-m', 'sealed snapshot'], { cwd: repoRoot, env, config: COMMITTER });
  if (!ok(committed)) throw new Error('could not commit the isolated example git tree');
  const moved = updateRef(repoRoot, 'HEAD', committed.stdout.trim());
  if (!moved.ok) throw new Error('could not point the isolated example git tree at its snapshot commit');
  return base;
}

function safeExampleSource(source, { preserveCoverage = false } = {}) {
  const name = path.basename(source);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) return false;
  if (SKIPPED.has(name) && !(preserveCoverage && name === 'coverage')) return false;
  if (/\.enc(?:\.yaml)?$/u.test(name) || /\.(?:agekey|pem|key)$/iu.test(name)) return false;
  if (['secret.env', 'secrets.env', 'keys.txt'].includes(name)) return false;
  if (name === '.env.example' || name.endsWith('.env.example')) return true;
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) return false;
  if (stat.isDirectory()) return true;
  const parts = source.split(path.sep);
  return !parts.includes('secrets') || ['.gitignore', 'README.md'].includes(name);
}

function pruneEmptyDirectories(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirectories(path.join(directory, entry.name));
  }
  if (!fs.readdirSync(directory).length) fs.rmdirSync(directory);
}

/** Await callback(tempExamplePath, lintBaseRef), return its result, and remove the os.tmpdir-based copy even on failure. */
export async function withMaterializedExample(repoRoot, exampleRelativePath, callback, { materialize = materializeExample, linkDependencies = false, preserveCoverage = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-example-'));
  const source = path.resolve(repoRoot, exampleRelativePath);
  const app = path.join(directory, 'examples', path.basename(source));
  try {
    fs.writeFileSync(path.join(directory, 'hfs.json'), JSON.stringify({ kind: 'runtime' }));
    fs.cpSync(source, app, {
      recursive: true,
      filter: (file) => safeExampleSource(file, { preserveCoverage }),
    });
    pruneEmptyDirectories(app);
    if (linkDependencies) linkExampleDependencies(source, app);
    await materialize(app);
    const lintBaseRef = trackExample(app, source);
    return await callback(app, lintBaseRef);
  } finally {
    safeRemove(directory, { hold: () => null });
  }
}

// Runtime example command execution shares the same isolated materialization as the source check.
function linkExampleDependencies(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.name === 'node_modules') {
      fs.mkdirSync(target, { recursive: true });
      fs.symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir');
    } else if (entry.isDirectory() && safeExampleSource(from)) {
      linkExampleDependencies(from, to);
    }
  }
}

function commandLaunch(command, args) {
  const npm = /^(npm|npx)(?:\.cmd)?$/iu.exec(command);
  if (process.platform !== 'win32' || !npm) return { file: command, args };
  const entry = npm[1].toLowerCase() + '-cli.js';
  const resolved = resolveRealTool(npm[1]);
  const npmExecPath = readEnv('npm_execpath');
  const candidates = [
    npmExecPath && path.join(path.dirname(npmExecPath), entry),
    resolved && path.join(path.dirname(resolved), 'node_modules', 'npm', 'bin', entry),
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', entry),
  ];
  const cli = candidates.find((file) => file && fs.existsSync(file));
  if (!cli) throw new Error('the example runner could not locate the installed npm CLI entry point');
  return { file: process.execPath, args: [cli, ...args] };
}

// The copy's own lint base replaces any STARCI_BASE_REF of the caller, which names a ref of the source repository, not of the copy.
function commandEnvironment(lintBaseRef) {
  const env = withoutGitLocalEnv(process.env);
  const out = Object.fromEntries(Object.entries(env).filter(([name]) => !/^SOPS_AGE_KEY(?:_FILE)?$/iu.test(name)));
  if (lintBaseRef) out.STARCI_BASE_REF = lintBaseRef;
  return out;
}

/** Run an installed app command in a sealed temporary copy, returning its exit code and preserving report artifacts. */
async function runMaterializedCommand(repoRoot, command, args = [], { run = runProgram } = {}) {
  return withMaterializedExample(repoRoot, '.', (app, lintBaseRef) => {
    const launch = commandLaunch(command, args);
    const result = run(launch.file, launch.args, { cwd: app, env: commandEnvironment(lintBaseRef), stdio: 'inherit', windowsHide: true });
    const reports = path.join(app, 'reports');
    if (fs.existsSync(reports)) fs.cpSync(reports, path.join(repoRoot, 'reports'), { recursive: true });
    if (result.error) throw new Error('the example check command could not start');
    return result.status ?? 1;
  }, { linkDependencies: true, preserveCoverage: true });
}

async function main(argv) {
  if (argv[0] === '--run' && argv[1] && argv[2] === '--' && argv[3])
    return runMaterializedCommand(path.resolve(argv[1]), argv[3], argv.slice(4));
  if (argv.length !== 1) throw new Error('usage: example-secrets.mjs <disposable-copy> | --run <example> -- <command> [args]');
  const result = await materializeExample(path.resolve(argv[0]));
  process.stdout.write(`example sealed members generated: ${result.members.length}\n`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
