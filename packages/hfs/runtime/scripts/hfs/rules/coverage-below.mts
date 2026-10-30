// R273: an explicitly supplied lcov report proves 100% per measured logic file in either edition.
// The denominator is the existing slot-derived coverage scope, never the source records present in the report.
// lcov carries lines, functions and branches; the unit runner also enforces its statement threshold.
import fs from 'node:fs';
import path from 'node:path';
import { coverageScope, measuredBy } from '../coverage-scope.mjs';
import { editionRuleParams, effectiveSlot, slotInEdition } from '../edition-slots.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { found } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

export const HFS_COVERAGE_BELOW = 'HFS_COVERAGE_BELOW';
const METRICS = ['lines', 'functions', 'branches'];
const SUMMARY: Record<string, string[]> = { LF: ['lines', 'found'], LH: ['lines', 'hit'], FNF: ['functions', 'found'], FNH: ['functions', 'hit'], BRF: ['branches', 'found'], BRH: ['branches', 'hit'] };
const SPEC = /(?:\.(?:spec|test)|-spec)\.ts$/;
const countOf = (value: Parsed) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const slash = (value: Parsed) => path.posix.normalize(String(value).replaceAll('\\', '/'));

const emptyRecord = (source: Parsed) => ({ source, lines: new Map(), functions: new Map(), branches: new Map(), summary: {}, problems: [] });
const addHits = (map: Parsed, key: string, hits: Parsed) => map.set(key, Math.min(Number.MAX_SAFE_INTEGER, (map.get(key) ?? 0) + hits));
const parseProblem = (record: Parsed, line: Parsed, tag: string) => record.problems.push(`invalid ${tag} at lcov line ${line}`);

function lineData(record: Parsed, value: Parsed, line: number) {
  const [number, count] = value.split(',');
  const hits = countOf(count ?? '');
  if (countOf(number) === null || Number(number) < 1 || hits === null) parseProblem(record, line, 'DA');
  else addHits(record.lines, String(Number(number)), hits);
}

function functionData(record: Parsed, tag: string, value: Parsed, line: number) {
  const at = value.indexOf(',');
  const count = countOf(value.slice(0, at));
  let name = value.slice(at + 1);
  // FN permits an optional end line before the function name; FNDA's names may themselves contain commas.
  if (tag === 'FN' && /^\d+,/.test(name)) name = name.slice(name.indexOf(',') + 1);
  if (at < 0 || count === null || !name || (tag === 'FN' && count < 1)) parseProblem(record, line, tag);
  else if (tag === 'FN') { if (!record.functions.has(name)) record.functions.set(name, 0); }
  else addHits(record.functions, name, count);
}

function branchData(record: Parsed, value: Parsed, line: number) {
  const parts = value.split(',');
  const hits = parts[3] === '-' ? 0 : countOf(parts[3] ?? '');
  if (parts.length !== 4 || parts.slice(0, 3).some((part: Parsed) => countOf(part) === null) || Number(parts[0]) < 1 || hits === null) parseProblem(record, line, 'BRDA');
  else addHits(record.branches, parts.slice(0, 3).map(Number).join(','), hits);
}

function summaryData(record: Parsed, tag: string, value: Parsed, line: number) {
  const count = countOf(value);
  if (count === null || Object.hasOwn(record.summary, tag)) parseProblem(record, line, tag);
  else record.summary[tag] = count;
}

function recordData(record: Parsed, tag: string, value: Parsed, line: number, problems: Parsed) {
  if (!['DA', 'FN', 'FNDA', 'BRDA', ...Object.keys(SUMMARY)].includes(tag)) return;
  if (!record) { problems.push(`${tag} outside a source record at lcov line ${line}`); return; }
  if (tag === 'DA') lineData(record, value, line);
  else if (tag === 'FN' || tag === 'FNDA') functionData(record, tag, value, line);
  else if (tag === 'BRDA') branchData(record, value, line);
  else summaryData(record, tag, value, line);
}

/** Parse conventional lcov records without executing or reading any referenced source path. */
function parseLcov(text: string) {
  const records: Parsed[] = [];
  const problems = [];
  let current: Parsed = null;
  const flush = () => {
    if (current) records.push(current);
    current = null;
  };
  for (const [index, raw] of String(text).replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'end_of_record') { flush(); continue; }
    const colon = line.indexOf(':');
    const tag = line.slice(0, colon);
    const value = line.slice(colon + 1);
    if (tag === 'SF') {
      flush();
      if (!value || value.includes('\0')) problems.push(`invalid SF at lcov line ${index + 1}`);
      else current = emptyRecord(value);
      continue;
    }
    recordData(current, tag, value, index + 1, problems);
  }
  flush();
  if (!records.length) problems.push('lcov has no source records');
  return { records, problems };
}

/** Apply the same edition data view as the slot resolver before deriving the coverage scope. */
function manifestOfEdition(manifest: Parsed, edition: string) {
  return {
    ...manifest,
    slots: manifest.slots.filter((slot: Parsed) => slotInEdition(manifest, slot, edition)).map((slot: Parsed) => effectiveSlot(slot, 'be', edition)),
    ruleParams: { ...manifest.ruleParams, be: editionRuleParams(manifest.ruleParams.be, edition) },
  };
}

function inventory({ files, all, repo, manifest }: { files: string[]; all: string[]; repo: Repo; manifest: Parsed }) {
  const prefix = repo.profile === 'app' || repo.sides ? 'be/' : '';
  const effective = manifestOfEdition(manifest, repo.edition ?? 'full');
  const scope = coverageScope(effective, repo.providers ?? repo.sides?.be?.providers ?? []);
  const measures = measuredBy(scope);
  const candidates = [...new Set((all ?? files ?? []).map(slash))].filter((file) => file.startsWith(prefix) && file.endsWith('.ts') && !SPEC.test(file)).sort(byCodeUnit);
  const measured: Parsed[] = [];
  const unmeasured: Parsed[] = [];
  for (const file of candidates) (measures(file.slice(prefix.length)) ? measured : unmeasured).push(file);
  return { measured, unmeasured, unmeasuredScopes: scope.none.map((entry: Parsed) => `${prefix}${entry}`), scope, prefix };
}

function sourcePath(source: Parsed) {
  if (source.startsWith('file:')) {
    try {
      const uri = new URL(source);
      source = decodeURIComponent(uri.pathname).replace(/^\/([a-z]:\/)/i, '$1');
    } catch { return null; }
  }
  return slash(source);
}

function matchesSource(source: Parsed, file: string, prefix: string) {
  const relative = prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file;
  const choices = [file, relative, ...(prefix ? [] : [`be/${file}`])];
  const windows = /^[a-z]:\//i.test(source) || source.startsWith('//');
  const absolute = source.startsWith('/') || windows;
  const key = windows ? source.toLowerCase() : source;
  return choices.some((choice) => {
    const candidate = windows ? choice.toLowerCase() : choice;
    return key === candidate || (absolute && key.endsWith(`/${candidate}`));
  });
}

function recordsByFile(records: Parsed, measured: Parsed, prefix: string) {
  const mapped = new Map<string, Parsed[]>(measured.map((file: string): [string, Parsed[]] => [file, []]));
  const problems = [];
  for (const record of records) {
    const source = sourcePath(record.source);
    const matches = source === null ? [] : measured.filter((file: string) => matchesSource(source, file, prefix));
    if (matches.length > 1) problems.push(`lcov source ${record.source} matches more than one measured file`);
    else if (matches.length === 1) mapped.get(matches[0]!)!.push(record);
  }
  return { mapped, problems };
}

function metricOf(record: Parsed, metric: Parsed) {
  const tags = Object.keys(SUMMARY).filter((tag) => SUMMARY[tag]![0] === metric);
  const [foundTag = '', hitTag = ''] = tags;
  const details = record[metric];
  const found = (details.size > 0 || record.summary[foundTag] === 0) ? details.size : record.summary[foundTag];
  const hit = details.size ? [...details.values()].filter((count) => count > 0).length : record.summary[hitTag];
  const problems = [];
  if (found === undefined || hit === undefined) problems.push(`${metric} coverage is unavailable`);
  else if (hit > found) problems.push(`${metric} hits exceed the denominator`);
  if (details.size) {
    if (record.summary[foundTag] !== undefined && record.summary[foundTag] !== found) problems.push(`${foundTag} disagrees with its records`);
    if (record.summary[hitTag] !== undefined && record.summary[hitTag] !== hit) problems.push(`${hitTag} disagrees with its records`);
  }
  return { found, hit, problems, detailed: details.size > 0 };
}

function measuredMetric(records: Parsed, metric: Parsed) {
  const values = records.map((record: Parsed) => metricOf(record, metric));
  const problems = values.flatMap((value: Parsed) => value.problems);
  const details = new Map();
  for (const record of records) for (const [key, hits] of record[metric]) addHits(details, key, hits);
  // Detailed test-name records merge by line/function/branch identity. Without identities, every summary must prove 100%.
  const hasOnlyDetails = values.every((value: Parsed) => value.detailed || value.found === 0);
  const valid = values.every((value: Parsed) => !value.problems.length);
  const worst = values.reduce((lowest: Parsed, value: Parsed) => {
    const rate = (entry: Parsed) => entry.found === 0 ? 1 : (entry.hit ?? 0) / (entry.found ?? 1);
    return rate(value) < rate(lowest) || (rate(value) === rate(lowest) && value.found > lowest.found) ? value : lowest;
  });
  const found = hasOnlyDetails ? details.size : (worst.found ?? 0);
  const hit = hasOnlyDetails ? [...details.values()].filter((count) => count > 0).length : (worst.hit ?? 0);
  let percent = null;
  if (valid) percent = found === 0 ? 100 : 100 * hit / found;
  if (valid && hit !== found) problems.push(`${metric} ${hit}/${found} (${(100 * hit / found).toFixed(2)}%) is below 100%`);
  return { metric: { found, hit, percent }, problems };
}

function measuredResult(file: string, records: Parsed) {
  const problems = records.flatMap((record: Parsed) => record.problems);
  const metrics: Record<string, Parsed> = {};
  if (!records.length) return { path: file, metrics, problems: ['no lcov source record for this measured logic file'], ok: false };
  for (const metric of METRICS) {
    const result = measuredMetric(records, metric);
    metrics[metric] = result.metric;
    problems.push(...result.problems);
  }
  return { path: file, metrics, problems: [...new Set(problems)], ok: problems.length === 0 };
}

/**
 * Read-only R273 report for an app or be side. `lcov` injects report text; `coverageFrom` selects a path relative to repoRoot.
 * Only an explicit report enables the check; ordinary app check does not infer a stale report from coverage/lcov.info.
 */
export function coverageBelowReport({ repoRoot, files, all, repo, manifest, coverageFrom, lcov }: { repoRoot?: string; files?: string[]; all?: string[]; repo?: Repo; manifest?: Parsed; coverageFrom?: string; lcov?: string } = {}) {
  const enabled = coverageFrom !== undefined || lcov !== undefined;
  const reportPath = typeof coverageFrom === 'string' && coverageFrom ? slash(coverageFrom) : '<lcov>';
  const empty: Record<string, Parsed> = { ok: true, enabled, reportPath, metrics: METRICS, measured: [], unmeasured: [], unmeasuredScopes: [], results: [], findings: [] };
  if (!enabled || !repo || !['app', 'be'].some((value) => value === repo.profile)) return empty;
  const boundary = inventory({ files: files!, all: all!, repo, manifest });
  const report: Record<string, Parsed> = { ...empty, ...boundary };
  const reportFailure = (message: string) => { report.findings.push(found(HFS_COVERAGE_BELOW, reportPath, message)); };
  if (lcov === undefined) {
    if (typeof coverageFrom !== 'string' || !coverageFrom) reportFailure('--coverage-from needs an lcov file path');
    else {
      try { lcov = fs.readFileSync(path.resolve(repoRoot!, coverageFrom), 'utf8'); }
      catch (error) { reportFailure(`lcov report cannot be read (${(error as NodeJS.ErrnoException).code ?? 'read failure'}); provide a fresh unit coverage report`); }
    }
  }
  if (lcov !== undefined) {
    const parsed = parseLcov(lcov);
    const { mapped, problems } = recordsByFile(parsed.records, boundary.measured, boundary.prefix);
    for (const problem of [...parsed.problems, ...problems]) reportFailure(problem);
    report.results = boundary.measured.map((file) => measuredResult(file, mapped.get(file)));
    for (const result of report.results.filter((entry: Parsed) => !entry.ok)) report.findings.push(found(HFS_COVERAGE_BELOW, result.path, `${result.path}: ${result.problems.join('; ')}; measured logic files require 100% lines, functions and branches`, { coverage: result.metrics }));
  }
  report.ok = report.findings.length === 0;
  return report;
}

/** Synchronous finder for the alpha.15 registry; explicit coverage reports may also be passed through extraFindings. */
export const coverageBelowFindings = (context: Parsed) => coverageBelowReport(context).findings;
