// canon-copy-drift.mjs - HFS_CANON_COPY_DRIFT (R253): a handful of scaffolded files are hash-sensitive canon,
// not files to edit. The drift judgement is one sha256 against the bytes of the be/skeleton template the file was
// scaffolded from - the file equals canon, or it has drifted. That template is the one of the @starci/hfs version the app
// pins (its lockfile's resolution of node_modules/@starci/hfs, else an exact package.json pin), never a newer hfs that
// happens to run the check: a skeleton change reaches an app only when the app raises its hfs. This package's own
// templates serve when it is that version or the app pins none; else an installed copy at the pinned version does; with
// neither at hand the copy is left to the app's own run of its pinned hfs. A finding carries the path and both hashes,
// never file content.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { found } from './read.mjs';

const CANON_COPY = 'HFS_CANON_COPY_DRIFT';
const OWN_ROOT = path.resolve(import.meta.dirname, '../../../..');
const OWN_TEMPLATE_ROOTS = [
  path.resolve(import.meta.dirname, '../../../packages/hfs/templates'),
  path.join(OWN_ROOT, 'templates'),
];
const TEMPLATE_DIR = 'be/skeleton/';
const HFS_LOCK_KEY = 'node_modules/@starci/hfs';
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// The three managed files the standard's secret-custody law pins byte-for-byte.
const CANON_PATHS = [
  'src/modules/platform/config/env-source.config.ts',
  'src/modules/platform/http-security/origin.guard.ts',
  'src/modules/platform/http-security/webhook-signature.service.ts',
];
const REGEX_ESCAPE = String.raw`\$&`;
const CANON_SUFFIX = new RegExp(`(?:^|/)(${CANON_PATHS.map((rel) => rel.replace(/[.*+?^${}()|[\]\\]/g, REGEX_ESCAPE)).join('|')})$`);

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};
const versionAt = (folder) => readJson(path.join(folder, 'package.json'))?.version;

/** The @starci/hfs version the app at `repoRoot` pins: its lockfile's resolution (hoisted first), else an exact package.json pin. */
export function pinnedHfsVersion(repoRoot) {
  const packages = readJson(path.join(repoRoot, 'package-lock.json'))?.packages ?? {};
  const locked = Object.keys(packages)
    .filter((key) => key === HFS_LOCK_KEY || key.endsWith(`/${HFS_LOCK_KEY}`))
    .sort((left, right) => left.length - right.length)
    .map((key) => packages[key]?.version)
    .find((version) => typeof version === 'string');
  if (locked) return locked;
  const manifest = readJson(path.join(repoRoot, 'package.json')) ?? {};
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const spec = manifest[field]?.['@starci/hfs'];
    if (typeof spec === 'string' && EXACT.test(spec)) return spec;
  }
  return undefined;
}

/** The template roots of the app's pinned @starci/hfs, or null when no copy of that version is at hand. */
export function pinnedTemplateRoots(repoRoot) {
  const pin = pinnedHfsVersion(repoRoot);
  if (pin === undefined || versionAt(OWN_ROOT) === pin) return OWN_TEMPLATE_ROOTS;
  const copies = [
    path.join(repoRoot, 'node_modules', '@starci', 'hfs'),
    path.join(repoRoot, 'node_modules', 'starci-harness', 'node_modules', '@starci', 'hfs'),
  ];
  const installed = copies.find((copy) => versionAt(copy) === pin);
  return installed === undefined ? null : [path.join(installed, 'templates')];
}

const templateBytes = (roots, rel) => {
  for (const root of roots) {
    const file = path.join(root, TEMPLATE_DIR, rel);
    try {
      const bytes = fs.readFileSync(file);
      if (bytes.length) return bytes;
    } catch { /* next root */ }
  }
  return null;
};
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function canonCopyDriftFindings({ repoRoot, files, inScope }) {
  const findings = [];
  const roots = pinnedTemplateRoots(repoRoot);
  if (roots === null) return findings;
  for (const file of files.filter((f) => !inScope || inScope(f))) {
    const hit = CANON_SUFFIX.exec(file.replaceAll('\\', '/'));
    if (!hit) continue;
    const expected = templateBytes(roots, hit[1]);
    if (!expected) continue;
    let actual;
    try {
      actual = fs.readFileSync(path.join(repoRoot, file));
    } catch {
      continue;
    }
    const expectedHash = sha256(expected);
    const actualHash = sha256(actual);
    if (actualHash === expectedHash) continue;
    findings.push(found(CANON_COPY, file,
      `${file} differs from the canon copy it was scaffolded from (sha256 ${actualHash.slice(0, 12)} vs ${expectedHash.slice(0, 12)}); restore the managed file's bytes - it is hash-sensitive canon, not a file to edit`,
      { expectedHash, actualHash }));
  }
  return findings;
}
