// urgent.mjs - `starci app release push --urgent --reason "<text>"`, the sanctioned urgent path (owner ruling urgent-release, 2026-10-29: an urgent
// deploy needs no CI). It runs only the fast local checks (typecheck and the build: owner ruling urgent-typecheck-build, 2026-10-30), or
// reuses a green row the gate already recorded for HEAD with the same command and an unchanged log; tags HEAD (annotated) and pushes the default
// branch and the tag in ONE atomic push through the repository's hook (never --no-verify, `git push --dry-run --atomic` first); then writes the
// URGENT record <git common dir>/starci-release/<HEAD>.urgent.json naming who (the caller's role), why (the reason), each check with its verdict and the
// commit. The candidate CI is not waited for. The full gate runs later on the same tag (`release gate --backfill <tag>`, gate.mjs), and the deploy
// safety floor (backup, migrate preview then execute, readiness, rollback) is never skipped (stack/urgent-floor.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { firstLine } from '../stack/context.mjs';
import { failure, refusal } from '../stack/errors.mjs';
import { assertUnmoved, git, inspect, releaseDir, runGate, summaryOf } from './gate.mjs';
import { assertNames, branchRefs, probe, tagRefs } from './push.mjs';
import { URGENT_RULING, URGENT_SCHEMA, greenRow, recordRow, writeUrgent } from './records.mjs';

/**
 * The fast local checks of an urgent release, by gate name, in the order they run: what can break production, the types and the build
 * (owner ruling urgent-typecheck-build, 2026-10-30). App check, lint and the tests wait for the back-fill (`release gate --backfill`).
 */
export const URGENT_CHECKS = Object.freeze(['typecheck', 'build', 'build-be', 'build-fe']);
const REASON_MAX = 500;

/** The reason, one line of plain text; an urgent release without one is refused. */
function reasonOf(value) {
  const reason = String(value ?? '').replaceAll(/\s+/gu, ' ').trim();
  if (reason === '') throw refusal('RELEASE_URGENT_REASON_MISSING', 'an urgent release says why: --reason "<text>"');
  if (reason.length > REASON_MAX) throw refusal('RELEASE_URGENT_REASON_MISSING', `--reason is one line of at most ${REASON_MAX} characters`);
  return reason;
}

/** The urgent checks this app declares, from its release gates, in URGENT_CHECKS order. */
function urgentGates(config) {
  const declared = URGENT_CHECKS.map((name) => config.gates.find((gate) => gate.name === name)).filter(Boolean);
  if (declared.length === 0) throw refusal('RELEASE_URGENT_NO_CHECKS', `the release gates declare none of ${URGENT_CHECKS.join(', ')}: an urgent release still runs its fast local checks`);
  return declared.map((gate) => ({ name: gate.name, gate, note: null }));
}

/** Runs (or reuses) each check in order and stops at the first red one. Returns the rows of the record. */
function runChecks(ctx, checks, { common, head, dir, platform }) {
  fs.mkdirSync(dir, { recursive: true });
  const rows = [];
  for (const check of checks) {
    if (!check.gate) {
      rows.push({ name: check.name, command: null, pass: true, reused: false, detail: check.note, log: null, logSha256: null });
      continue;
    }
    const command = check.gate.command.join(' ');
    const reused = greenRow(common, head, check.name, command);
    if (reused) {
      rows.push({ ...reused, reused: true, ...(check.note ? { note: check.note } : {}) });
      continue;
    }
    const row = runGate(ctx, check.gate, { dir, platform, credentialNames: [] });
    recordRow(common, head, row);
    rows.push({ ...row, reused: false, ...(check.note ? { note: check.note } : {}) });
    if (!row.pass) break;
  }
  return rows;
}

const checkLine = (row) => (row.command === null ? `SKIP ${row.name} (${row.detail})` : `${row.reused ? 'REUSED ' : ''}${summaryOf(row)}`);

function planOf(checks) {
  return ['urgent checks (each must pass; a green row recorded for HEAD with the same command and log is reused):',
    ...checks.map((check) => `  ${check.name.padEnd(10)} ${check.gate ? check.gate.command.join(' ') : '(nothing to run)'}${check.note ? `  [${check.note}]` : ''}`)];
}

/**
 * `starci app release push --urgent`. options: { execute, remote, reason, role, platform }. Dry run prints the checks, the tag and the push it would
 * make; --execute runs them, tags, pushes atomically and writes the urgent record. A red check is RELEASE_URGENT_CHECK_RED: nothing tagged, nothing pushed.
 */
export async function releaseUrgentPush(ctx, config, options = {}) {
  const reason = reasonOf(options.reason);
  if (options.lintBaseline !== undefined) throw refusal('RELEASE_URGENT_LINT_BASELINE_RETIRED', 'an urgent release no longer lints (owner ruling urgent-typecheck-build): lint runs in the back-fill, so --lint-baseline has nothing to judge');
  const role = options.role ?? 'unset';
  const remote = options.remote ?? 'origin';
  const branch = config.defaultBranch;
  assertNames(remote, branch);
  const facts = inspect(ctx, config, {});
  const { head, chosen } = facts;
  const common = releaseDir(ctx);
  const dir = path.join(common, head.slice(0, 12));
  const checks = urgentGates(config);
  const out = [...facts.out, `urgent         ${URGENT_RULING}`, `reason         ${reason}`, `role           ${role}`, ...planOf(checks)];
  const data = { head, tag: chosen.tag, remote, branch, urgent: true, reason, role, checks: [], pushed: false };
  if (facts.red.length > 0) return { ok: false, lines: [...out, ...facts.red.map((item) => `RED: ${item}`), 'nothing run, nothing pushed.'], data: { ...data, red: facts.red } };
  const red = [];
  const refs = [...branchRefs(ctx, { head, remote, branch }, red).refs, ...(chosen.state === 'on-head' ? tagRefs(ctx, { remote, tag: chosen.tag }, red) : [`refs/tags/${chosen.tag}`])];
  out.push(`plan           git tag -a ${chosen.tag}${chosen.state === 'on-head' ? ' (already on HEAD)' : ''}, then git push --atomic ${remote} ${refs.join(' ') || '(nothing)'}; no candidate CI`);
  if (red.length > 0) return { ok: false, lines: [...out, ...red.map((item) => `RED: ${item}`), 'nothing run, nothing pushed.'], data: { ...data, red } };
  if (options.execute !== true) return { ok: true, lines: [...out, 'dry run: no check run, nothing tagged or pushed. ready; re-run with --execute.'], data };
  const rows = runChecks(ctx, checks, { common, head, dir, platform: options.platform ?? process.platform });
  data.checks = rows;
  out.push(...rows.map(checkLine));
  const failed = rows.find((row) => !row.pass);
  if (failed) throw failure('RELEASE_URGENT_CHECK_RED', `${failed.name} is red (${failed.detail}; log ${failed.log}): nothing tagged, nothing pushed`);
  assertUnmoved(ctx, head);
  if (chosen.state !== 'on-head') git(ctx, ['tag', '-a', chosen.tag, '-m', `URGENT release ${chosen.tag} on ${head.slice(0, 12)} by ${role}: ${reason} (fast local checks only; back-fill: starci app release gate --backfill ${chosen.tag})`, head]);
  if (refs.length > 0) {
    const hook = probe(ctx, remote, refs, red);
    out.push(...hook.lines);
    if (red.length > 0) return { ok: false, lines: [...out, ...red.map((item) => `RED: ${item}`), `nothing pushed; ${chosen.tag} stays local.`], data };
    const run = git(ctx, ['push', '--atomic', remote, ...refs], { allowFail: true });
    if (run.code !== 0) return { ok: false, lines: [...out, `push failed: ${firstLine(run.stderr)}; ${chosen.tag} stays local.`], data };
  }
  const record = {
    schema: URGENT_SCHEMA, head, tag: chosen.tag, createdAt: new Date(ctx.now()).toISOString(), producedBy: 'starci app release push --urgent',
    role, reason, ruling: URGENT_RULING, remote, branch, refs, pushed: true, checks: rows, backfill: null,
  };
  writeUrgent(common, record);
  return { ok: true, lines: [...out, `pushed to ${remote}: ${refs.join(' ') || '(already there)'}`, `URGENT record written: ${path.join(common, `${head}.urgent.json`)}`, `back-fill later: starci app release gate --backfill ${chosen.tag} --execute (in a clean checkout of ${chosen.tag})`], data: { ...data, pushed: true, record: path.join(common, `${head}.urgent.json`) } };
}
