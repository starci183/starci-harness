// read.mjs - what the tree checks of hfs-check.mjs share: one bounded text read and the shape of a finding.
import fs from 'node:fs';
import path from 'node:path';
import type { Finding, Parsed } from './rule-types.mjs';

/** Files above this size are not read by a tree check (a tracked binary or a generated dump is no source of these laws). */
const MAX_READ_BYTES = 1024 * 1024;

/** The text of `rel` under `repoRoot`, or null when it is absent, unreadable, over MAX_READ_BYTES or binary. */
export function readText(repoRoot: string, rel: string): string | null {
  try {
    const target = path.join(repoRoot, rel);
    if (fs.statSync(target).size > MAX_READ_BYTES) return null;
    const text = fs.readFileSync(target, 'utf8');
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

/** The JSON of `rel`, or null when it is absent or not JSON. */
export function readJson(repoRoot: string, rel: string): Parsed | null {
  const text = readText(repoRoot, rel);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** One error finding of `code` on `file`; `extra` carries the finding's own fields. */
export const found = (code: string, file: string, message: string, extra: Record<string, unknown> = {}): Finding => ({ code, level: 'error', path: file, ...extra, message });
