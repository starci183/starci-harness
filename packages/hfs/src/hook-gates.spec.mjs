import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { fileRightsVerdict } from '../runtime/scripts/guards/call-rights.mjs';

const contract = 'modules/kernel/hook-input.yaml';

test('a Supervisor cannot modify the hook input limits through file tools', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'starci-hook-protected-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'knowledge', 'hfs'), { recursive: true });
  writeFileSync(path.join(root, 'knowledge', 'hfs', 'runtime-slots.yaml'), '');
  for (const relative of [contract, 'scripts/lib/hook-limits.mjs', 'scripts/guards/verdict-process.mjs']) {
    const target = path.join(root, relative);
    const verdict = await fileRightsVerdict({ role: 'supervisor', filePath: target, tool: 'Write', edit: { new: 'maxBytes: 1' } });
    assert.equal(verdict?.code, 'RIGHTS_PROTECTED_ZONE');
  }
});

test('the hook input limits stay at their ceilings: a raised byte bound or deadline, or a shortened input window, is red', () => {
  const limits = parseYaml(readFileSync(new URL(`../runtime/${contract}`, import.meta.url), 'utf8'));
  const ceilings = { maxBytes: 1048576, outputTimeoutMs: 1000, verdictTimeoutMs: 20000, teardownTimeoutMs: 1000, hookTimeoutSeconds: 30 };
  for (const [key, ceiling] of Object.entries(ceilings)) assert.ok(limits[key] <= ceiling, `${key} ${limits[key]} is above the ceiling ${ceiling}`);
  assert.ok(limits.minInputWindowMs >= 5000, `minInputWindowMs ${limits.minInputWindowMs} is below the floor 5000`);
});
