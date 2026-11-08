// The lcov paths Sonar resolves. SonarJS sanitizes each `SF:` path (backslashes to slashes, `..` resolved) and finds the file by the tail of that path; a root
// package seen from the back end (`..\packages\x.ts` on Windows, `../packages/x.ts` on Linux) sanitizes to nothing, is never matched, and the whole file reads
// uncovered in Sonar while the lcov itself says 100. Every writer of the preset (the unit run, the shard merge, the per-spec union) goes through one report, so
// the records are proven there: forward slashes, no climbing segment, one record per file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mergeSpecCoverage }: typeof import('../src/spec-coverage.ts') = require('../dist/spec-coverage.js');

const BACKSLASH = String.fromCharCode(92);
const coverage = { s: [[1, 0, 1, 10, 1]], f: [], b: [] } as unknown as import('../src/spec-coverage.ts').SourceCoverage;

/** What SonarJS makes of an lcov path before it looks the file up (`PathUtils.sanitize`: unix separators, `.` and `..` resolved, null when it climbs out). */
function sonarSanitized(source: string): string | null {
  const normal = path.posix.normalize(source.replaceAll(BACKSLASH, '/'));
  return normal.startsWith('../') || normal === '..' ? null : normal;
}

test('a root package seen from the back end is written with forward slashes and no climbing segment, so Sonar resolves it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-lcov-paths-'));
  try {
    const be = path.join(root, 'be');
    const out = path.join(be, 'coverage');
    mergeSpecCoverage({
      records: [{ 'src/modules/domain/a/a.service.ts': coverage, '../packages/blocks-core/src/modules/sales/memory.ts': coverage }],
      outDir: out,
      projectRoot: be,
    });
    const sources = fs.readFileSync(path.join(out, 'lcov.info'), 'utf8').split(/\r?\n/u).filter((line) => line.startsWith('SF:')).map((line) => line.slice(3));
    assert.deepEqual(sources.sort(), ['packages/blocks-core/src/modules/sales/memory.ts', 'src/modules/domain/a/a.service.ts']);
    for (const source of sources) {
      assert.ok(!source.includes(BACKSLASH), `${source} has no backslash`);
      assert.notEqual(sonarSanitized(source), null, `${source} survives Sonar's sanitizing`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
