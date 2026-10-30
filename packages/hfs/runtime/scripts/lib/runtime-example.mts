// Identify runtime-owned example apps; an unrelated directory named examples grants no fixture behavior.
import fs from 'node:fs';
import path from 'node:path';

export function isRuntimeExampleApp(repoRoot: string): boolean {
  if (path.basename(path.dirname(repoRoot)) !== 'examples') return false;
  try {
    // reason: hfs.json is parsed from disk; only `kind` is read.
    const runtime: { kind?: unknown } = JSON.parse(fs.readFileSync(path.resolve(repoRoot, '..', '..', 'hfs.json'), 'utf8'));
    return runtime.kind === 'runtime';
  } catch {
    return false;
  }
}
