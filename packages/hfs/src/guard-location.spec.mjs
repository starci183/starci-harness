import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { toolGuardCommand } from '../runtime/scripts/lib/guard-command.mjs';
import { readRuntimeRecord } from '../runtime/scripts/lib/runtime-location.mjs';
import { ensureLaunchTrust } from '../runtime/scripts/agent/trust-launch.mjs';
import { guardCommandRow } from '../runtime/scripts/reconciler/guard-row.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'starci-guard-location-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  mkdirSync(path.join(home, '.starci'), { recursive: true });
  mkdirSync(cwd);
  const link = (name) => {
    const runtime = path.join(root, name);
    mkdirSync(path.join(runtime, 'scripts', 'cli'), { recursive: true });
    writeFileSync(path.join(runtime, 'scripts', 'cli', 'main.mjs'), '');
    writeFileSync(path.join(home, '.starci', 'runtime.json'), JSON.stringify({ root: runtime }));
    return runtime;
  };
  const config = { launchTrust: { profile: 'automatic', approvedBy: 'owner', approvalRef: 'fixture', roots: [cwd] } };
  const env = { ...process.env, STARCI_AGENT_TRUST_HOME: home, STARCI_TEMP_ROOT: root,
    STARCI_LOCAL_ROOT: path.join(root, 'state'), STARCI_OWNER_CONFIG_WITHIN: root };
  return { root, home, cwd, link, config, env };
}

test('guard registration and preflight follow the linked runtime when it differs from the caller tree', (t) => {
  const options = fixture(t);
  const runtime = options.link('installed runtime');
  const expected = toolGuardCommand({ home: options.home });
  assert.ok(expected.includes(path.join(runtime, 'packages', 'cli', 'bin', 'starci.mjs').replaceAll('\\', '/')));
  let launchCommand;
  const launch = ensureLaunchTrust({ ...options, agent: 'devin', guardProbe: ({ command, home }) => {
    launchCommand = command;
    assert.equal(home, options.home);
    return { ok: true };
  } });
  assert.equal(launch.status, 'written', JSON.stringify(launch));
  assert.equal(launchCommand, expected);
  const profile = JSON.parse(readFileSync(path.join(options.cwd, '.devin', 'config.local.json'), 'utf8'));
  assert.equal(profile.hooks.PreToolUse[0].hooks[0].command, expected);
  const row = guardCommandRow({ home: options.home, probe: ({ command, home }) => {
    assert.equal(command, expected);
    assert.equal(home, options.home);
    return { ok: true, shells: [{ shell: 'fixture' }] };
  } });
  assert.equal(row.status, 'green');
});

test('relinking refreshes the registered command and preflight path', (t) => {
  const options = fixture(t);
  options.link('first runtime');
  const first = ensureLaunchTrust({ ...options, agent: 'devin', guardProbe: () => ({ ok: true }) });
  assert.equal(first.status, 'written');
  const oldCommand = toolGuardCommand({ home: options.home });
  const runtime = options.link('relocated runtime');
  const second = ensureLaunchTrust({ ...options, agent: 'devin', guardProbe: () => ({ ok: true }) });
  assert.equal(second.status, 'written', JSON.stringify(second));
  const expected = toolGuardCommand({ home: options.home });
  assert.notEqual(expected, oldCommand);
  assert.ok(expected.includes(runtime.replaceAll('\\', '/')));
  const profile = JSON.parse(readFileSync(path.join(options.cwd, '.devin', 'config.local.json'), 'utf8'));
  assert.equal(profile.hooks.PreToolUse[0].hooks[0].command, expected);
  guardCommandRow({ home: options.home, probe: ({ command }) => {
    assert.equal(command, expected);
    return { ok: true, shells: [{ shell: 'fixture' }] };
  } });
});

test('a missing or stale linked runtime refuses registration and makes preflight red', (t) => {
  const options = fixture(t);
  const missing = ensureLaunchTrust({ ...options, agent: 'devin', guardProbe: () => { throw new Error('must not probe'); } });
  assert.equal(missing.status, 'failed');
  assert.equal(missing.code, 'guard-command-unresolvable');
  assert.equal(guardCommandRow({ home: options.home }).status, 'red');
  writeFileSync(path.join(options.home, '.starci', 'runtime.json'), JSON.stringify({ root: path.join(options.root, 'missing runtime') }));
  const skipped = [];
  assert.equal(readRuntimeRecord({ home: options.home, skipped }), null);
  assert.match(skipped[0], /stale record/);
  assert.throws(() => toolGuardCommand({ home: options.home }), /stale record/);
});
