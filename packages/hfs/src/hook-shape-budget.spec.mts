import assert from 'node:assert/strict';
import test from 'node:test';
import { HOOK_INPUT_LIMITS } from '../runtime/scripts/guards/hook-io.mjs';
import { hookShapeFindings } from '../runtime/scripts/hfs/runtime-rules/hook-shape.mjs';

const settingsFile = '.claude/settings.json';
const settingsContext = (timeouts: readonly (number | undefined)[]) => {
  const commands = ['command', 'seat-tools'];
  const settings = { hooks: { PreToolUse: commands.map((verb, index) => ({ hooks: [{
    type: 'command', command: `starci guard ${verb}`, timeout: timeouts[index],
  }] })) } };
  return { fileSet: new Set([settingsFile]), read: (file: string) => file === settingsFile ? JSON.stringify(settings) : null };
};

test('tracked guard settings admit the shared host timeout above the complete hook budget', () => {
  const limits = HOOK_INPUT_LIMITS;
  const total = limits.minInputWindowMs + limits.verdictTimeoutMs + limits.teardownTimeoutMs + 2 * limits.outputTimeoutMs;
  assert.ok(total < limits.hookTimeoutSeconds * 1000);
  assert.deepEqual(hookShapeFindings(settingsContext([limits.hookTimeoutSeconds, limits.hookTimeoutSeconds])), []);
});

test('tracked guard settings refuse a host timeout shorter than the shared budget', () => {
  const limits = HOOK_INPUT_LIMITS;
  const found = hookShapeFindings(settingsContext([1, limits.hookTimeoutSeconds]));
  assert.equal(found.length, 1);
  assert.equal(found[0]?.code, 'RT_HOOK_SHAPE');
  assert.equal(found[0]?.path, settingsFile);
});

test('tracked seat-tool hooks require the shared explicit timeout too', () => {
  const found = hookShapeFindings(settingsContext([HOOK_INPUT_LIMITS.hookTimeoutSeconds, undefined]));
  assert.equal(found.length, 1);
  assert.equal(found[0]?.code, 'RT_HOOK_SHAPE');
  assert.equal(found[0]?.path, settingsFile);
});

test('an unreadable host hook declaration is a runtime finding', () => {
  const found = hookShapeFindings({ fileSet: new Set([settingsFile]), read: () => '{' });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.code, 'RT_HOOK_SHAPE');
});


test('the app push hook requires the shared gate invocation and its exit status', () => {
  const file = 'packages/hfs/templates/app/hooks/husky/pre-push';
  for (const text of ['exit 0', "node --input-type=module -e \"import { main } from '@starci/hfs/runtime/scripts/guards/release-push-gate.mjs';\""]) {
    assert.ok(hookShapeFindings({ fileSet: new Set([file]), read: () => text }).length > 0);
  }
});
