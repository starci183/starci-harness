// hash.mts - content hashes of the cache. A hash is the sha256 of the bytes with CRLF turned into LF for text files, so a
// Windows checkout and a Linux CI runner hash one commit alike. Text is git's own test: no NUL in the first 8000 bytes.
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const BINARY_PROBE = 8000;

/** Whether `bytes` is text by git's test: no NUL in the first 8000 bytes. */
export function isText(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, BINARY_PROBE);
  for (let i = 0; i < end; i += 1) if (bytes[i] === 0) return false;
  return true;
}

/** `bytes` with every CRLF turned into LF; a lone CR is kept. */
export function normaliseNewlines(bytes: Uint8Array): Uint8Array {
  let crlf = 0;
  for (let i = 0; i + 1 < bytes.length; i += 1) if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) crlf += 1;
  if (crlf === 0) return bytes;
  const out = new Uint8Array(bytes.length - crlf);
  let at = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    out[at] = bytes[i] ?? 0;
    at += 1;
  }
  return out;
}

/** The sha256 (hex) of `bytes`, newline-normalised when they are text. */
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(isText(bytes) ? normaliseNewlines(bytes) : bytes).digest('hex');
}

/** The sha256 (hex) of a text, newline-normalised. */
export function hashText(text: string): string {
  return hashBytes(Buffer.from(text, 'utf8'));
}

/** The hash of the file at `absolute`, or undefined when it cannot be read (absent, a directory, a race). */
export function hashFile(absolute: string): string | undefined {
  try {
    return hashBytes(fs.readFileSync(absolute));
  } catch {
    return undefined;
  }
}

/**
 * One digest over named parts, order-independent and unambiguous: the parts are sorted by name and each contributes
 * `name NUL hash NUL`, so no two different part sets share a digest by concatenation.
 */
export function combineHashes(parts: Readonly<Record<string, string>>): string {
  const h = createHash('sha256');
  for (const name of Object.keys(parts).sort()) h.update(`${name}\0${parts[name] ?? ''}\0`);
  return h.digest('hex');
}
