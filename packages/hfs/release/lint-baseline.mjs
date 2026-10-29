// lint-baseline.mjs - the lint row of an urgent release judged against a baseline release tag (`release push --urgent --lint-baseline <tag>`,
// owner ruling urgent-lint-baseline 2026-10-29: an app whose lint backlog predates the release ships when the release adds no finding of its own).
// The managed lint (`npm run lint`, which ends in `starci app lint`) runs twice, each writing its findings as a Sonar Generic Issue Import file
// (`-- --sonar <file>`): at HEAD, and at the baseline tag in a throwaway `git worktree` that borrows HEAD's installs (each node_modules folder is
// linked in as a directory junction, unlinked before the worktree is removed, never deleted through). A finding is the same finding when its
// engine, rule, file and message match (lines move); a finding left over is then matched on engine, rule and message alone (a file that moved).
// What HEAD holds beyond the baseline is new: zero new findings is green, any is red, and a lint that could not run on either side is red. The
// row names both counts and both reports with their sha256, and the new findings go to lint-new.json beside the record, so the back-fill's full
// gate (which this changes nothing in) still sees the whole backlog.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refusal } from '../stack/errors.mjs';
import { git, runGate } from './gate.mjs';

/** The owner's ruling a baseline-judged lint row cites. */
export const LINT_BASELINE_RULING = 'owner ruling urgent-lint-baseline 2026-10-29: an urgent release whose lint is red only with findings its baseline tag already had ships; a new finding is red';
const LINK_DEPTH = 3;
const NEW_SHOWN = 50;

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The findings of a Sonar Generic Issue Import file as { engine, rule, file, line, message }, or null when it is missing or unreadable. */
export function sonarFindings(file) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!doc || !Array.isArray(doc.issues)) return null;
  return doc.issues.map((issue) => ({
    engine: String(issue.engineId ?? ''), rule: String(issue.ruleId ?? ''), file: String(issue.primaryLocation?.filePath ?? ''),
    line: issue.primaryLocation?.textRange?.startLine ?? null, message: String(issue.primaryLocation?.message ?? ''),
  }));
}

/** The findings of `head` the `baseline` does not hold: matched on engine, rule, file and message, then the rest on engine, rule and message. */
export function newFindings(head, baseline) {
  const take = (pool, key) => { const left = pool.get(key) ?? 0; if (left === 0) return false; pool.set(key, left - 1); return true; };
  const exact = (finding) => `${finding.engine}\u0000${finding.rule}\u0000${finding.file}\u0000${finding.message}`;
  const loose = (finding) => `${finding.engine}\u0000${finding.rule}\u0000${finding.message}`;
  const exactPool = new Map();
  for (const finding of baseline) exactPool.set(exact(finding), (exactPool.get(exact(finding)) ?? 0) + 1);
  const unmatched = head.filter((finding) => !take(exactPool, exact(finding)));
  const loosePool = new Map();
  for (const finding of baseline) {
    const left = exactPool.get(exact(finding)) ?? 0;
    if (left > 0) { exactPool.set(exact(finding), left - 1); loosePool.set(loose(finding), (loosePool.get(loose(finding)) ?? 0) + 1); }
  }
  return unmatched.filter((finding) => !take(loosePool, loose(finding)));
}

/** Every node_modules folder of `root` within LINK_DEPTH levels (never inside one), app-relative. */
function installFolders(root) {
  const found = [];
  const walk = (rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.git') continue;
      const child = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.name === 'node_modules') found.push(child);
      else if (depth < LINK_DEPTH) walk(child, depth + 1);
    }
  };
  walk('', 0);
  return found;
}

/** Removes a link made by this module: the link alone, never what it points at. */
function unlink(link) {
  try { fs.unlinkSync(link); } catch { try { fs.rmdirSync(link); } catch { /* already gone */ } }
}

/** The lint of `gate` with its findings written to `report`: { row, findings } (findings null when the lint could not run). */
function lintTo(ctx, gate, { name, report, dir, platform }) {
  fs.rmSync(report, { force: true });
  const row = runGate(ctx, { ...gate, name, command: [...gate.command, '--', '--sonar', report] }, { dir, platform, credentialNames: [] });
  const ran = row.pass || row.detail === 'exit 1';
  return { row, findings: ran ? sonarFindings(report) : null };
}

/**
 * The lint row of an urgent release against `tag`: { name, command, pass, detail, log, logSha256, baseline }. Refuses a tag that is not a
 * commit. `dir` is the record folder of HEAD, where both reports, both logs and lint-new.json are written.
 */
export function baselineLint(ctx, gate, { tag, dir, platform }) {
  const commit = git(ctx, ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], { allowFail: true });
  if (commit.code !== 0 || commit.stdout === '') throw refusal('RELEASE_URGENT_LINT_BASELINE_TAG', `--lint-baseline ${tag} names no commit`);
  fs.mkdirSync(dir, { recursive: true });
  const headReport = path.join(dir, 'lint-head.sonar.json');
  const head = lintTo(ctx, gate, { name: 'lint', report: headReport, dir, platform });
  const row = (pass, detail, baseline = null) => ({ ...head.row, pass, detail, baseline: baseline && { tag, commit: commit.stdout, ruling: LINT_BASELINE_RULING, ...baseline } });
  if (head.findings === null) return row(false, `the lint at HEAD could not run (${head.row.detail})`);
  if (head.findings.length === 0) return row(true, 'no finding at HEAD', { findings: 0, headFindings: 0, newFindings: 0 });
  const tree = path.join(os.tmpdir(), `starci-lint-baseline-${randomBytes(4).toString('hex')}`);
  const links = [];
  const added = git(ctx, ['worktree', 'add', '--detach', tree, commit.stdout], { allowFail: true });
  if (added.code !== 0) return row(false, `the baseline worktree of ${tag} could not be made`);
  try {
    for (const rel of installFolders(ctx.cwd)) {
      const link = path.join(tree, rel);
      if (fs.existsSync(link) || !fs.existsSync(path.dirname(link))) continue;
      fs.symlinkSync(path.join(ctx.cwd, rel), link, 'junction');
      links.push(link);
    }
    const baseReport = path.join(dir, 'lint-baseline.sonar.json');
    const base = lintTo(Object.create(ctx, { cwd: { value: tree } }), gate, { name: 'lint-baseline', report: baseReport, dir, platform });
    if (base.findings === null) return row(false, `the lint at the baseline ${tag} could not run (${base.row.detail}; log ${base.row.log})`);
    const fresh = newFindings(head.findings, base.findings);
    fs.writeFileSync(path.join(dir, 'lint-new.json'), `${JSON.stringify(fresh, null, 2)}\n`);
    const counts = {
      findings: base.findings.length, headFindings: head.findings.length, newFindings: fresh.length,
      headReport, headReportSha256: sha256(headReport), baselineReport: baseReport, baselineReportSha256: sha256(baseReport), baselineLog: base.row.log,
      newShown: fresh.slice(0, NEW_SHOWN).map((finding) => `${finding.file}:${finding.line ?? '-'} ${finding.rule} ${finding.message}`),
    };
    const detail = `${head.findings.length} finding(s) at HEAD, ${base.findings.length} at ${tag}, ${fresh.length} new${fresh.length > 0 ? ` (${path.join(dir, 'lint-new.json')})` : ''}`;
    return row(fresh.length === 0, detail, counts);
  } finally {
    links.reverse().forEach(unlink);
    // A link still present would let the removal delete through it into HEAD's installs: the worktree then stays for a person to unlink.
    if (links.every((link) => !fs.existsSync(link))) git(ctx, ['worktree', 'remove', '--force', tree], { allowFail: true });
    else ctx.stderr?.(`lint baseline: ${tree} keeps a linked node_modules; unlink it (cmd /c rmdir <link>) before removing the worktree\n`);
  }
}
