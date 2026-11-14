// copies.mts - how `starci app data` reaches a copy repository: a checkout under the harness state base (never inside the app repository), a
// git driver of @starci/seed over it, and the one age identity lookup of the harness (`decryptionIdentity`, the lookup `secret` and the stack's
// sealed members use). The identity travels as an OpenContext handle; its value is never printed and never part of a message.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createGitDriver } from '@starci/seed/git';
import type { CopyRef, DriverAdapter, OpenContext } from '@starci/seed';
import { starciLocalRoot } from '../runtime/engine/runtime-root.mjs';
import { decryptionIdentity } from '../runtime/scripts/hfs/secret-init.mjs';
import type { AgeHost } from '../runtime/scripts/hfs/secret-init.mjs';
import { refusal } from '../stack/errors.mjs';
import type { VerbContext } from '../release/index.mjs';

/** The branch a copy repository keeps its snapshots on. */
export const COPY_BRANCH = 'main';

/** A git driver over a checkout of one copy repository, with what a verb needs to refresh and address it. */
export interface OpenCopy {
  readonly driver: DriverAdapter;
  readonly checkout: string;
  readonly repository: string;
  readonly name: string;
  /** Clones the checkout, or fast-forwards it to the remote; a repository that cannot be reached is a refusal. */
  refresh(): void;
  /** The full commit of `commit` (a prefix is fine) in the checkout, or null when the repository has no such commit. */
  resolve(commit: string): string | null;
  /** The reference of the copy at `commit` (read from its manifest), or null when it holds no manifest. */
  refAt(commit: string): CopyRef | null;
  /** The plaintext manifest of the copy at `commit` (it holds no value), or null when the commit holds none. */
  manifestAt(commit: string): CopyManifest | null;
}

/** What `starci app data` reads of a copy's manifest.json: the plaintext header, the sets and the file index of the git driver (sealed bytes per file). */
export interface CopyManifest {
  readonly takenAt: string;
  readonly exportDigest: string;
  readonly purpose: string;
  readonly source: { readonly environment: string };
  readonly sets: readonly { readonly store: string; readonly set: string; readonly items: number }[];
  readonly files: Readonly<Record<string, { readonly bytes: number }>>;
}

const gitEnvironment = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/^SOPS_AGE_KEY/iu.test(entry[0])));

/** The checkout directory of a repository: `<state base>/data/<project>/<repository name>`, refused inside the app repository (the state base is the harness's, never the app's). */
export function checkoutOf(ctx: VerbContext, project: string, name: string): string {
  const target = path.join(starciLocalRoot(ctx.env), 'data', project, name);
  let ancestor = path.resolve(target);
  const tail: string[] = [];
  while (!fs.existsSync(ancestor)) { tail.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const resolved = path.join(fs.realpathSync(ancestor), ...tail);
  const relative = path.relative(fs.realpathSync(ctx.cwd), resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw refusal('DATA_CHECKOUT_INSIDE_REPO', 'the copy checkout must lie outside the app repository: the harness state base is inside it');
  return resolved;
}

/** Opens a copy repository through the git driver; `env` is the environment the git and sops children run in (never an age identity). */
export function openCopy(ctx: VerbContext, project: string, destination: { repository: string; name: string }): OpenCopy {
  const checkout = checkoutOf(ctx, project, destination.name);
  const env = gitEnvironment(ctx.env);
  const git = (args: readonly string[]) => spawnSync('git', [...args], { cwd: checkout, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 28 });
  const driver = createGitDriver({ id: destination.name, checkout, remote: destination.repository, branch: COPY_BRANCH, env });
  return {
    driver, checkout, repository: destination.repository, name: destination.name,
    refresh() {
      fs.mkdirSync(checkout, { recursive: true });
      const fresh = !fs.existsSync(path.join(checkout, '.git'));
      const run = fresh
        ? spawnSync('git', ['clone', '-q', '-b', COPY_BRANCH, destination.repository, '.'], { cwd: checkout, env: { ...process.env, ...env }, encoding: 'utf8' })
        : git(['pull', '-q', '--ff-only', 'origin', COPY_BRANCH]);
      if (!run.error && run.status === 0) return;
      // A repository that answers and holds no ref has no copy yet: that is an empty list, not an unreachable repository.
      const listed = spawnSync('git', ['ls-remote', destination.repository], { cwd: checkout, env: { ...process.env, ...env }, encoding: 'utf8' });
      if (listed.error || listed.status !== 0 || listed.stdout.trim() !== '') throw refusal('DATA_COPY_UNREACHABLE', `the copy repository ${destination.name} cannot be ${fresh ? 'cloned' : 'updated'} (git exit ${String(run.status)}); output withheld`);
      if (fresh) { git(['init', '-q', '-b', COPY_BRANCH]); git(['remote', 'add', 'origin', destination.repository]); }
    },
    resolve(commit) {
      if (!/^[0-9a-f]{4,40}$/u.test(commit)) return null;
      const found = git(['rev-parse', '--verify', '-q', `${commit}^{commit}`]);
      return found.status === 0 ? found.stdout.trim() : null;
    },
    manifestAt(commit) {
      const shown = git(['show', `${commit}:manifest.json`]);
      if (shown.status !== 0) return null;
      try {
        const manifest = JSON.parse(shown.stdout) as Partial<CopyManifest> & { source?: { environment?: unknown } };
        if (typeof manifest.exportDigest !== 'string' || typeof manifest.takenAt !== 'string' || !Array.isArray(manifest.sets)) return null;
        return { takenAt: manifest.takenAt, exportDigest: manifest.exportDigest, purpose: String(manifest.purpose ?? ''), source: { environment: String(manifest.source?.environment ?? '') }, sets: manifest.sets, files: manifest.files ?? {} };
      } catch { return null; }
    },
    refAt(commit) {
      const manifest = this.manifestAt(commit);
      return manifest === null ? null : { driver: destination.name, kind: 'git', locator: commit, exportDigest: manifest.exportDigest, takenAt: manifest.takenAt };
    },
  };
}

/**
 * The identity a sealed copy opens with, as the OpenContext handle the driver takes: the harness's one lookup (`decryptionIdentity`: the
 * environment, the app's `.claude/secret.env`, its main checkout's, the harness CLI's, then sops' keys.txt). Nothing but the age variables
 * leaves it. No identity found is a refusal that names the places looked, never a value.
 */
export function openIdentity(ctx: VerbContext, host: AgeHost | null): OpenContext {
  const selection = decryptionIdentity(ctx.cwd, ctx.env, { host });
  if (selection.source === null) throw refusal('DATA_IDENTITY_MISSING', `no age identity opens a sealed copy on this machine (looked: ${selection.looked.join(', ')}): the owner puts the environment's identity in SOPS_AGE_KEY of the harness secret.env`);
  const env = Object.fromEntries(Object.entries(selection.env).filter((entry): entry is [string, string] => /^SOPS_AGE_KEY(?:_FILE)?$/iu.test(entry[0]) && typeof entry[1] === 'string' && entry[1] !== ''));
  return { identity: { kind: 'age-identity', env } };
}
