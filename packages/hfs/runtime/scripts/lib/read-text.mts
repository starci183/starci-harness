// read-text.mjs — the forgiving text read: a missing or unreadable file is the caller's fallback,
// never a throw (the JSON twin is ./json.mjs readJsonFile, the YAML twin ./read-yaml.mjs).
import fs from 'node:fs';
import path from 'node:path';

/** The text of `rel` under `root` ('/'-separated rel), or null when it is missing or unreadable. */
export const readTextFile = (root: string, rel: unknown): string | null => {
  try { return fs.readFileSync(path.join(root, ...String(rel).split('/')), 'utf8'); } catch { return null; }
};

/** `file` read and parsed by `parse`, or `fallback` when it is missing, unreadable or malformed. */
export const readParsedFile = <T, F = null>(file: string, parse: (text: string) => T, fallback: F = null as F): T | F => {
  try { return parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

/**
 * Feed `file`'s lines to `onLine` reading in bounded chunks — a diff or a patch can exceed any single
 * string. `eol` is the line-ending pattern or literal (default CRLF-aware); a last unterminated line is fed too.
 */
export function forEachFileLine(file: string, onLine: (line: string) => void, { chunkBytes = 8 * 1024 * 1024, eol = /\r?\n/ }: { chunkBytes?: number; eol?: string | RegExp } = {}): void {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(chunkBytes);
    let carry = '';
    for (;;) {
      const n = fs.readSync(fd, buf, 0, chunkBytes, null);
      if (n <= 0) break;
      const lines = (carry + buf.toString('utf8', 0, n)).split(eol);
      carry = lines.pop() as string;
      for (const l of lines) onLine(l);
    }
    if (carry) onLine(carry);
  } finally { fs.closeSync(fd); }
}
