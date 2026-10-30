// push-scan.mjs - the secret scan of an outgoing range, shared by the Supervisor's push of the product repositories (push-mains.mjs) and the push gate of the runtime
// repository (scripts/guards/release-push-gate.mjs, `starci release push`). Findings name the file, line and pattern, never the value. Its imports stay light on purpose: the
// runtime push hook is bundled with the hfs package (scripts/hfs/sync-runtime.mjs) and must not drag the supervisor in.
import path from 'node:path';
import { safeRemove } from '../api/fs/safe-remove.mjs';
import { makeTempDir } from '../api/fs/make-temp-dir.mjs';
import { diff as gitDiff } from '../api/git/diff.mjs';
import { show as gitShow } from '../api/git/show.mjs';
import { artifactHoldReason } from '../machine/artifact-hold.mjs';
import { FORBIDDEN_FILES, secretHits, secretHitsInFile } from '../lib/secret-patterns.mjs';
import { slash } from '../lib/path-key.mjs';
import { isSopsEnvelope, setCommand } from '../lib/sops-envelope.mjs';
import { forEachFileLine } from '../lib/read-text.mjs';

/** One finding of the scan: the file, line (null for a whole-file rule) and pattern name - never the value. */
export interface ScanFinding { file: string | null; line: number | null; pattern: string }
/** scanRange's answer. */
export interface ScanRangeResult { ok: boolean; error?: string; findings: ScanFinding[]; files?: string[] }
type ScanGitVerb = 'diff' | 'show';
interface EncState { file: string; line: number | null; added: string[]; findings: ScanFinding[] }
type EncText = (file: string) => string | null;
type KeepHit = (file: string, line: number) => boolean;

const SCAN_GIT = { diff: gitDiff, show: gitShow };
/** The scan's git runner: `args[0]` names the scripts/api/git call file it runs, in `cwd`: {ok, stdout, stderr, error}. */
function git([verb, ...args]: [verb: ScanGitVerb, ...args: string[]], { cwd }: { cwd: string }): { ok: boolean; stdout: string; stderr: string; error: string | null } {
  const r = SCAN_GIT[verb](args, { cwd, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: String(r.stdout ?? '').trim(), stderr: String(r.stderr ?? '').trim(), error: r.error?.message ?? null };
}

/**
 * Scan a unified diff (added lines only) and its file list. Returns [{file, line, pattern}] - never the value.
 * `files` are the changed paths (status A/M/R); deleted paths are not scanned.
 */
export function scanDiff({ diff = '', files = [] }: { diff?: string; files?: string[] } = {}): ScanFinding[] {
  const scanner = diffScanner(files);
  for (const raw of String(diff).split(/\r?\n/)) scanner.line(raw);
  return scanner.findings;
}

/** scanDiff one line at a time: feed each diff line to `line(raw)`; `findings` accumulates.
 *  A `*.enc` file is held back until its diff ends and passes only when it is a sops-encrypted file with no
 *  plaintext value (scripts/lib/sops-envelope.mjs isSopsEnvelope) - judged on the whole file at the pushed commit
 *  when `encText(file)` can read it (a --unified=0 diff of an edited sops YAML holds only its changed lines), else
 *  on its added lines. Anything else in a `.enc` file is scanned like any other file, and a `.enc` under
 *  `.starcistacks/` that is not a sops envelope refuses the push by itself (sops-not-envelope). */
function diffScanner(files: string[] = [], { encText = null, keepHit = null }: { encText?: EncText | null; keepHit?: KeepHit | null } = {}) {
  const findings: ScanFinding[] = [];
  for (const file of files) for (const rule of FORBIDDEN_FILES) if (rule.test(slash(file))) findings.push({ file, line: null, pattern: rule.name });
  let file: string | null = null, line = 0, enc: EncState | null = null;
  const flushEnc = () => {
    if (enc && !isSopsEnvelope((encText ? encText(enc.file) : null) ?? enc.added.join('\n'))) {
      findings.push(...enc.findings);
      // .starcistacks holds sops twins only: anything else there (a JSON key the value rules cannot see, a
      // plaintext value next to the sops block) refuses the push by itself.
      if (/(^|\/)\.starcistacks\//i.test(enc.file)) findings.push({ file: enc.file, line: enc.line, pattern: 'sops-not-envelope' });
    }
    enc = null;
  };
  return {
    get findings(): ScanFinding[] { flushEnc(); return findings; },
    line(raw: string): void {
      if (raw.startsWith('+++ ')) {
        flushEnc();
        file = raw.slice(4).replace(/^b\//, '');
        if (/\.enc(?:\.yaml)?$/i.test(file)) enc = { file, line: null, added: [], findings: [] };
        return;
      }
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (hunk) { line = Number(hunk[1]); return; }
      if (raw.startsWith('+')) {
        const text = raw.slice(1);
        if (enc) { enc.added.push(text); enc.line ??= line; }
        (enc ? enc.findings : findings).push(...addedLineFindings(file, line, text, keepHit));
        line += 1;
      } else if (!raw.startsWith('-')) line += 1;
    },
  };
}

/** Every added line is scanned first; an optional whole-file judgement can then retain or drop its hits. */
function addedLineFindings(file: string | null, line: number, text: string, keepHit: KeepHit | null): ScanFinding[] {
  const patterns = secretHits(file?.replace(/\.tpl$/, ''), text);
  if (!patterns.length || (keepHit && !keepHit(file ?? '', line))) return [];
  return patterns.map((pattern: string) => ({ file, line, pattern }));
}

/** Only badge-bearing paths use cached post-images; an unreadable post-image keeps every diff hit. */
function badgeHitFilter(readText: EncText): KeepHit {
  const linesByFile = new Map<string, Set<number> | null>();
  return (file, line) => {
    if (!/(?:^|\/)(?:README\.md|\.starcistacks\/application-stacks\.yaml)$/.test(file)) return true;
    if (!linesByFile.has(file)) {
      const text = readText(file);
      const manifestText = /(?:^|\/)README\.md$/.test(file) ? readText(path.posix.join(path.posix.dirname(file), '.starcistacks/application-stacks.yaml')) ?? undefined : undefined;
      linesByFile.set(file, text === null ? null : new Set(secretHitsInFile(file, text, { manifestText }).map((hit: { line: number }) => hit.line)));
    }
    const lines = linesByFile.get(file);
    return lines === null || (lines?.has(line) ?? false);
  };
}

/** Read each committed post-image once; a NUL commit prefix protects its leading whitespace from the git runner's trim. */
function postImageReader(cwd: string, to: string): EncText {
  const texts = new Map<string, string | null>();
  return (file) => {
    if (!texts.has(file)) {
      const result = git(['show', '--format=%x00', '--no-patch', to, `${to}:${file}`], { cwd });
      const readable = result.ok && result.stdout.startsWith('\0\n');
      texts.set(file, readable ? result.stdout.slice(2) : null);
    }
    return texts.get(file) ?? null;
  };
}

/** The one fix a refused plaintext test credential gets (owner ruling push-scan-test-secrets-encrypted): the product
 *  repository's own .starcistacks + sops convention, or a value generated per run. */
const TEST_SECRET_HINT = `move it to .starcistacks/<stack>/secrets/test/<name> and encrypt it with the repository's own command (${setCommand('<name>', '<stack>')}; commit only the .enc, read it with testSecret() from scripts/uat/test-secret.mjs) or generate it per run; never a plaintext literal`;
export const scanHint = (findings: Array<{ pattern: string }> = []): string | null => (findings.some((f) => f.pattern === 'assigned-secret') ? TEST_SECRET_HINT : null);

/** Scan the range `from..to` of `cwd`: {ok, findings, files}. The diff is written to a temp file and read
 *  in chunks, never held whole in a spawn buffer (a 64 MB overflow read as `scan failed: git diff failed`). */
export function scanRange({ cwd, from, to }: { cwd: string; from: string; to: string }): ScanRangeResult {
  const names = git(['diff', '--name-only', '--diff-filter=ACMR', `${from}..${to}`], { cwd });
  if (!names.ok) return { ok: false, error: names.stderr || names.error || 'git diff failed', findings: [] };
  const files = names.stdout.split(/\r?\n/).filter(Boolean);
  const dir = makeTempDir('starci-push-scan-');
  const out = path.join(dir, 'range.diff');
  try {
    const diff = git(['diff', '--no-color', '--unified=0', '--diff-filter=ACMR', `--output=${out}`, `${from}..${to}`], { cwd });
    if (!diff.ok) return { ok: false, error: diff.stderr || diff.error || 'git diff failed', findings: [] };
    const encText: EncText = (f) => { const r = git(['show', `${to}:${f}`], { cwd }); return r.ok ? r.stdout : null; };
    const scanner = diffScanner(files, { encText, keepHit: badgeHitFilter(postImageReader(cwd, to)) });
    forEachFileLine(out, (l: string) => scanner.line(l));
    return { ok: scanner.findings.length === 0, findings: scanner.findings, files };
  } finally { safeRemove(dir, { hold: artifactHoldReason }); }
}
