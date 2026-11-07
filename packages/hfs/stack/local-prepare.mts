// local-prepare.mts - `starci app stack prepare --env <dev env> [--execute]` (PROJECT-STACKS-6): checks the host, opens the dev custody, runs the
// declared setup commands (install, codegen) and builds or pulls the compose images. A dry run reports the table and the plan and changes nothing.
// It refuses on a missing prerequisite, a held port, a missing sealed value or an identity this machine lacks, and never generates a replacement.
import fs from 'node:fs';
import path from 'node:path';
import type { StackContext } from './context.mjs';
import { StackError } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { missingKeys, missingStep, neededKeys, openCustody } from './local-custody.mjs';
import type { Custody } from './local-custody.mjs';
import { hostPrerequisites, tableLines } from './local-host.mjs';
import type { Prerequisite } from './local-host.mjs';
import { commandDigest, compose, composeValues, runCommand, runEnvironment, stateOf } from './local-run.mjs';
import type { LocalDeps } from './local-run.mjs';
import { readRecord, writeRecord } from './local-state.mjs';

/** The prerequisite table of the environment as rows and printed lines. */
export async function preflight(ctx: StackContext, local: LocalConfig, deps: LocalDeps): Promise<{ rows: Prerequisite[]; lines: string[]; ok: boolean }> {
  const rows = await hostPrerequisites(ctx, local, { repoRoot: local.repoRoot, stateDir: stateOf(ctx, local), secretsDir: local.secretsDir }, deps);
  return { rows, lines: tableLines(rows), ok: rows.every((row) => row.ok) };
}

/** The refusal result of a failed preflight: the table with its owner steps, then the code. */
export const hostRefusal = (lines: string[]): ActionResult => ({ ok: false, lines, refused: { code: 'STACK_LOCAL_HOST', message: 'this machine is missing what the environment needs; run the owner steps above, then retry' } });

/** Runs the setup commands (install, codegen); a command with `skipIfExists` that finds its marker is skipped. */
export async function runSetup(ctx: StackContext, local: LocalConfig, custody: Custody | null): Promise<string[]> {
  const out: string[] = [];
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  for (const run of local.setup) {
    if (run.skipIfExists && fs.existsSync(path.join(local.repoRoot, run.cwd, run.skipIfExists))) { out.push(`setup ${run.name}: skipped (${run.skipIfExists} exists)`); continue; }
    await runCommand(ctx, local, run, runEnvironment(ctx, local, run, custody, null));
    record.receipts.setup[run.name] = { at: new Date(ctx.now()).toISOString(), digest: commandDigest(run) };
    out.push(`setup ${run.name}: done`);
  }
  writeRecord(dir, record);
  return out;
}

/** Builds the images that have a build context and pulls the rest. */
export async function prepareImages(ctx: StackContext, local: LocalConfig, custody: Custody | null): Promise<string[]> {
  const values = composeValues(local, custody);
  const build = await compose(ctx, local, ['build'], { values, heavy: true, label: 'compose build' });
  const pull = await compose(ctx, local, ['pull', '--ignore-buildable', '--quiet'], { values, heavy: true, label: 'compose pull' });
  const lines = [build.status === 0 ? 'images: built' : `images: build failed (${(build.stderr.trim().split(/\r?\n/u)[0] ?? '').slice(0, 160)})`];
  lines.push(pull.status === 0 ? 'images: pulled' : `images: pull failed (${(pull.stderr.trim().split(/\r?\n/u)[0] ?? '').slice(0, 160)})`);
  if (build.status !== 0 || pull.status !== 0) throw new StackError('STACK_LOCAL_IMAGES', lines.join('; '), 1);
  return lines;
}

/** `prepare` for a dev environment. */
export async function prepareLocal(ctx: StackContext, local: LocalConfig, { execute = false }: { execute?: boolean } = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  const host = await preflight(ctx, local, deps);
  if (!host.ok) return hostRefusal(host.lines);
  const lines = [...host.lines];
  const missing = missingKeys(local);
  lines.push(`custody: ${neededKeys(local).length} key(s) read from ${local.env}${missing.length ? `; missing ${missing.join(', ')} (${missingStep(local, missing)})` : ', all sealed'}`);
  if (!execute) {
    lines.push(...local.setup.map((run) => `plan setup ${run.name}: ${run.argv.join(' ')}`), 'plan images: docker compose build and pull', 'dry run: nothing was changed; arm it with --execute');
    return { ok: missing.length === 0, lines, data: { rows: host.rows } };
  }
  const custody = openCustody(ctx, local);
  lines.push(`custody: ${custody.values.size} key file(s) written to the host-local directory`);
  lines.push(...await runSetup(ctx, local, custody), ...await prepareImages(ctx, local, custody));
  return { ok: true, lines, data: { rows: host.rows } };
}
