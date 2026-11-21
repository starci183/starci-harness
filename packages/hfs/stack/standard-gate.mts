// standard-gate.mts - the seed step's gate over the seed-standards an environment loads (contexts/project/stacks.md PROJECT-STACKS-13): before
// the seed step applies, every `data.sets` seed-standard of the environment (a git destination, pinned by `commit`, no project-defined
// `completeness`) is read at its pinned commit, and when that commit carries an adapter/ the adapter is run over its raw/ twice and compared,
// byte for byte, with the committed manifest.json, data/, blobs/ and index/ (R434, rules/data-adapter.mts). A pin whose output drifts, or
// that cannot be read, is refused STACK_SEED_ADAPTER_DRIFT and nothing of the seed step applies. A verified pin is recorded in the seed
// receipts (scope `standard`, the set's id, the commit as its hash), so each pin is verified once: the same commit is never judged twice.
// The loader of standard-load.mts then applies each verified pin through the app's seed doors. This is the one path a standard takes into an
// app: the app reads no standard by any other way (R435).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pinRepository } from '@starci/seed/git';
import type { Runner } from '@starci/seed/git';
import { isPlainObject as plain } from '../runtime/engine/plain-object.mjs';
import { starciLocalRoot } from '../runtime/engine/runtime-root.mjs';
import { ADAPTER_DIR, ADAPTER_ENTRY, RAW_DIR, adapterDriftOf, committedOnDisk, withoutGitEnvironment } from '../runtime/scripts/hfs/rules/data-adapter.mjs';
import type { AdapterSpawn } from '../runtime/scripts/hfs/rules/data-adapter.mjs';
import { environmentLabel, repositoryName, resolveRepository } from '../runtime/scripts/hfs/rules/data-sets.mjs';
import type { Finding } from '../runtime/scripts/hfs/rules/rule-types.mjs';
import { readDeclaration } from '../release/index.mjs';
import { refusal } from './errors.mjs';
import { launch } from './local-host.mjs';

/** The receipt scope of a verified standard pin. */
export const STANDARD_SCOPE = 'standard';
/** How long installing a pinned adapter's dependencies may take. */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const COMMIT = /^[0-9a-f]{40}$/u;

/**
 * One seed-standard an environment loads: its set, its repository (with `{env}` resolved), the commit it is pinned to, the stores it fills and
 * whether the set declares `force: true` (a changed pin re-seeds once; standard-load.mts).
 */
export interface StandardPin { set: string; repository: string; name: string; commit: string; stores: readonly string[]; force: boolean }

/** What a verification found: whether the pinned commit carries an adapter, and the drift of its output (none: it matches). */
export interface PinVerdict { adapter: boolean; findings: readonly Finding[] }

/** Verifies one pin; throws when the pinned commit cannot be read. */
export type PinVerifier = (pin: StandardPin) => PinVerdict;

/** The seed-standards `env` loads, from `data.sets` of the app at `repoRoot`; a set R427 refuses, or one a project kind judges (`completeness`), is not here. */
export function standardPins(repoRoot: string, env: string): StandardPin[] {
  const doc = readDeclaration(repoRoot);
  const sets: unknown[] = plain(doc.data) && Array.isArray(doc.data.sets) ? doc.data.sets : [];
  const label = environmentLabel(doc.environments, env);
  return sets.flatMap((set): StandardPin[] => {
    if (!plain(set) || set.purpose !== 'seed-standard' || set.completeness !== undefined || typeof set.id !== 'string') return [];
    if (!Array.isArray(set.environments) || !set.environments.includes(env) || typeof set.commit !== 'string' || !COMMIT.test(set.commit)) return [];
    const destination = (Array.isArray(set.to) ? set.to : []).find((to: unknown) => plain(to) && to.driver === 'git' && typeof to.repository === 'string');
    if (destination === undefined) return [];
    const repository = resolveRepository(String(destination.repository), label);
    const stores = Array.isArray(set.stores) ? set.stores.filter((store: unknown): store is string => typeof store === 'string') : [];
    return [{ set: set.id, repository, name: repositoryName(repository), commit: set.commit, stores, force: set.force === true }];
  });
}

const short = (pin: StandardPin): string => `${pin.name}@${pin.commit.slice(0, 12)}`;

/**
 * The gate: per pin, kept when a receipt already holds its commit, planned in a dry run, else verified; a drifting or unreadable pin is
 * refused STACK_SEED_ADAPTER_DRIFT. Answers its lines and the pins it verified (whose receipts the seed step writes).
 */
export function standardGate({ pins, receipts, execute, verify }: { pins: readonly StandardPin[]; receipts: ReadonlyArray<{ scope: string; id: string; hash: string }>; execute: boolean; verify: PinVerifier }): { lines: string[]; verified: StandardPin[] } {
  const lines: string[] = [];
  const verified: StandardPin[] = [];
  for (const pin of pins) {
    const name = `seed ${STANDARD_SCOPE}/${pin.set}`;
    if (receipts.some((row) => row.scope === STANDARD_SCOPE && row.id === pin.set && row.hash === pin.commit)) { lines.push(`${name}: verified before (${short(pin)}, once per pin)`); continue; }
    if (!execute) { lines.push(`plan ${name}: verify ${short(pin)}, its adapter output against the committed standard when it carries an adapter (R434)`); continue; }
    let verdict: PinVerdict;
    try { verdict = verify(pin); } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'NPM_FAILED') throw refusal('STACK_SEED_ADAPTER_INSTALL', `${short(pin)} of the set ${pin.set}: npm ci of its adapter/ failed${(error as Error).message.includes(': ') ? ` (${(error as Error).message.slice((error as Error).message.indexOf(': ') + 2)})` : ''}; the adapter's dependencies must resolve from its lockfile (a dependency pinned to a version the registry does not serve fails here): fix adapter/package.json and its lockfile in the standard, commit, and pin that commit`);
      if (code === 'GIT_FAILED') throw refusal('STACK_SEED_STANDARD_UNREADABLE', `${short(pin)} of the set ${pin.set}: git could not check the pin out (${(error as Error).message}); nothing was seeded`);
      throw refusal('STACK_SEED_ADAPTER_DRIFT', `${short(pin)} of the set ${pin.set} cannot be read at its pin${typeof code === 'string' ? ` (${code})` : ''}: a standard is loaded only from a commit the bring-up can verify (R434)`);
    }
    if (verdict.findings.length > 0) {
      const named = verdict.findings.slice(0, 3).map((finding) => finding.message).join('; ');
      throw refusal('STACK_SEED_ADAPTER_DRIFT', `${short(pin)} of the set ${pin.set}: the adapter's output over raw/ drifts from the committed standard (${String(verdict.findings.length)} finding(s): ${named}); the pin is refused and nothing is seeded: pin a commit whose own check is green (R434, PROJECT-STACKS-13)`);
    }
    lines.push(`${name}: ${verdict.adapter ? 'the adapter output matches the committed standard' : 'no adapter, the committed standard stands'} (${short(pin)})`);
    verified.push(pin);
  }
  return { lines, verified };
}

/** What the real verifier runs: git and npm through `launch`, node for the adapter. */
export interface VerifierDeps { cache: string; platform?: NodeJS.Platform; spawn?: AdapterSpawn }

/** The git runner of a pin's mirror and of the seed driver over it: spawnSync with the caller's environment minus every GIT_* variable. */
export const pinRunner: Runner = (program, args, options) => {
  const done = spawnSync(program, [...args], { cwd: options.cwd, input: options.input, env: { ...withoutGitEnvironment(), ...options.env }, maxBuffer: 1 << 30, windowsHide: true });
  return { status: done.status, stdout: done.stdout, stderr: done.stderr };
};

const realSpawn: AdapterSpawn = (program, args, options) => spawnSync(program, [...args], { ...options, encoding: 'utf8', windowsHide: true });

/**
 * The verifier of the seed step: the pinned commit through `pinRepository` of @starci/seed/git (one bare mirror per repository under
 * `cache`, outside every repository); when it carries adapter/main.ts, a scratch checkout at the commit, the adapter's dependencies installed
 * from its lockfile (scripts off), and the drift check of R434 over its raw/.
 */
export function pinnedStandardVerifier({ cache, platform = process.platform, spawn = realSpawn }: VerifierDeps): PinVerifier {
  return (pin) => {
    const pinned = pinRepository({ repository: pin.repository, commit: pin.commit, cache, name: pin.name, run: pinRunner });
    if (pinned.readText(ADAPTER_ENTRY) === null) return { adapter: false, findings: [] };
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-standard-'));
    try {
      const tree = path.join(scratch, 'tree');
      const run = (command: string, args: readonly string[], cwd: string, timeout = INSTALL_TIMEOUT_MS): void => {
        const [program, argv] = launch(platform, command, args);
        const done = spawn(program, argv, { cwd, timeout, env: withoutGitEnvironment() });
        if (done.error !== undefined || done.status !== 0) {
          const said = String(done.stderr ?? '').split(/\r?\n/u).map((line) => line.trim()).filter((line) => /\b(?:ERR|error|E[0-9]{3}|fatal)\b/u.test(line)).slice(0, 2).join(' ').slice(0, 300);
          throw Object.assign(new Error(`${command} ${args[0] ?? ''} failed${said === '' ? '' : `: ${said}`}`), { code: `${command.toUpperCase()}_FAILED` });
        }
      };
      run('git', ['clone', '-q', '--no-checkout', path.join(cache, `${pin.name}.git`), tree], scratch);
      run('git', ['-c', 'advice.detachedHead=false', 'checkout', '-q', '--detach', pin.commit], tree);
      run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(tree, ADAPTER_DIR));
      fs.mkdirSync(path.join(tree, RAW_DIR), { recursive: true });
      return { adapter: true, findings: adapterDriftOf({ root: tree, rawDir: path.join(tree, RAW_DIR), committed: committedOnDisk(tree), scratch: path.join(scratch, 'out'), spawn }) };
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  };
}

/** The cache of pinned standards: `<state base>/data/standards`, the harness's, never an app's. */
export const standardCache = (env: NodeJS.ProcessEnv = process.env): string => path.join(starciLocalRoot(env), 'data', 'standards');
