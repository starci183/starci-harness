// urgent-release.mjs - the one-command urgent release (owner ruling urgent-typecheck-build, 2026-10-30):
//   starci app stack deploy --env <env> --urgent --reason "<text>" [--execute]
// with no --image and no --source-sha takes HEAD from the laptop to the server in one command, CI not involved:
//   1. the urgent release of HEAD (release/urgent.mjs: typecheck and the build, tag, one atomic push, the urgent record), skipped when HEAD
//      already has a pushed urgent record;
//   2. the images of that tag built and pushed on THIS machine's Docker (stack/build.mjs), which yields their digests;
//   3. the urgent deploy of those digests (stack/urgent-floor.mjs): backup, migrate preview then execute, deploy, verify, rollback on red.
// Steps 1 and 2 run before the deploy's Docker transport reaches the server, so nothing is ever built on the server. A dry run prints the
// urgent release plan and the build plan and stops: the deploy plan needs the digests the build makes.
import { buildImages } from './build.mjs';
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import { git, releaseDir, type ReleaseConfig } from '../release/gate.mjs';
import { loadReleaseConfig } from '../release/index.mjs';
import { readUrgent } from '../release/records.mjs';
import { releaseUrgentPush } from '../release/urgent.mjs';

/** What the one-command urgent release reads from the deploy options. */
export interface UrgentReleaseOptions {
  urgent?: boolean | undefined;
  sourceSha?: string | undefined;
  images?: Record<string, string> | undefined;
  execute?: boolean | undefined;
  reason?: string | undefined;
  role?: string | undefined;
  remote?: string | undefined;
}

/** The collaborators of the release (the specs inject stubs). */
export interface UrgentReleaseDeps {
  buildImages?: typeof buildImages;
  loadReleaseConfig?: (cwd: string) => ReleaseConfig;
  releaseUrgentPush?: (ctx: StackContext, releaseConfig: ReleaseConfig, options: { execute: boolean | undefined; reason: string; role: string | undefined; remote: string | undefined }) => Promise<ActionResult>;
}

/** What the release hands back: a result to print, or the images and commit the deploy continues with. */
export interface UrgentReleaseResult extends ActionResult {
  images?: Record<string, string>;
  sourceSha?: string;
}

/** True when an urgent deploy names neither images nor a source commit: the one-command form. */
export const oneCommand = (options: UrgentReleaseOptions): boolean => options.urgent === true && !options.sourceSha && Object.keys(options.images ?? {}).length === 0;

/**
 * Steps 1 and 2 on the local machine. options: { execute, reason, role, remote }. Returns { ok, lines, data } to print when it stops (a dry run,
 * a red step), or { ok: true, lines, images, sourceSha } for the deploy to continue with.
 */
export async function prepareUrgentRelease(ctx: StackContext, config: DeployConfig, options: UrgentReleaseOptions, deps: UrgentReleaseDeps = {}): Promise<UrgentReleaseResult> {
  const d = { buildImages, loadReleaseConfig, releaseUrgentPush, ...deps };
  const head: string = git(ctx, ['rev-parse', 'HEAD']).stdout;
  const lines = [`one-command urgent release of ${head.slice(0, 12)} (owner ruling urgent-typecheck-build): urgent release, local build and push, urgent deploy`];
  const record = readUrgent(releaseDir(ctx), head);
  if (record?.pushed === true) lines.push(`urgent release ${record.tag} of ${head.slice(0, 10)} already pushed: reused`);
  else {
    if (options.reason === undefined) throw refusal('STACK_URGENT_REASON_MISSING', 'the one-command urgent deploy releases HEAD first and says why: --reason "<text>"');
    const pushed = await d.releaseUrgentPush(ctx, d.loadReleaseConfig(ctx.cwd), { execute: options.execute, reason: options.reason, role: options.role, remote: options.remote });
    lines.push(...pushed.lines);
    if (!pushed.ok) return { ok: false, lines, data: { head, step: 'release', ...pushed.data } };
    if (options.execute !== true) {
      lines.push('then: the images of that tag are built and pushed on this machine (stack build --push), then the urgent deploy runs the floor on their digests.');
      return { ok: true, lines: [...lines, 'dry run: nothing tagged, built or deployed.'], data: { head, step: 'release', executed: false } };
    }
  }
  const built = await d.buildImages(ctx, config, { push: true, execute: options.execute === true });
  lines.push(...built.lines);
  if (!built.ok) return { ok: false, lines, data: { head, step: 'build', ...built.data } };
  if (options.execute !== true) return { ok: true, lines: [...lines, 'then: the urgent deploy runs the floor on the pushed digests.', 'dry run: nothing built or deployed.'], data: { head, step: 'build', executed: false } };
  const pushed = built.data as { images: Record<string, string>; sha: string }; // a pushed build always reports its digests and commit
  return { ok: true, lines, images: pushed.images, sourceSha: pushed.sha };
}
