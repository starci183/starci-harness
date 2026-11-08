// local-doctor.mts - `starci app stack doctor --env <dev env>` (PROJECT-STACKS-6): the read-only inspection of a dev environment and of the machine
// it runs on. The prerequisite table (tools, engine, resources, ports) names the owner-run install step per OS for each missing one; then
// the custody (which keys are sealed, whether this machine's identity opens the members), the compose render, the volumes and the recorded
// processes, and the base port: the role table of its native ports and its range against the other apps of the machine (PROJECT-STACKS-10).
// It changes nothing and never prints a value.
import fs from 'node:fs';
import path from 'node:path';
import type { StackContext } from './context.mjs';
import { firstLine, lines as splitLines } from './context.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { holders, missingKeys, missingStep, neededKeys } from './local-custody.mjs';
import { tableLines } from './local-host.mjs';
import type { Prerequisite } from './local-host.mjs';
import { preflight } from './local-prepare.mjs';
import { compose, isAlive, stateOf } from './local-run.mjs';
import type { LocalDeps } from './local-run.mjs';
import { basePortRows, machinePeers } from './local-peers.mjs';
import { readRecord } from './local-state.mjs';

function custodyRows(ctx: StackContext, local: LocalConfig): Prerequisite[] {
  const needed = neededKeys(local);
  const missing = missingKeys(local);
  const rows: Prerequisite[] = [{ id: 'custody', ok: missing.length === 0, detail: missing.length ? `${missing.join(', ')} sealed in no member of ${local.env}` : `${needed.length} key(s) sealed`, fix: missing.length ? missingStep(local, missing) : null }];
  const held = holders(local.secretsDir);
  const members = [...new Set(needed.map((key) => held.get(key)).filter((name): name is string => name !== undefined))];
  for (const name of members) {
    try { ctx.sops.requireIdentity?.(path.join(local.secretsDir, name)); rows.push({ id: `identity ${name}`, ok: true, detail: 'this machine holds an identity the member is sealed to', fix: null }); }
    catch (error) {
      rows.push({ id: `identity ${name}`, ok: false, detail: String((error as Error).message).split(/\r?\n/u)[0] ?? 'no identity', fix: 'obtain the age identity of the environment from the owner into SOPS_AGE_KEY of the harness secret.env; a replacement is never generated for an existing sealed value' });
    }
  }
  return rows;
}

/** `doctor` for a dev environment. */
export async function doctorLocal(ctx: StackContext, local: LocalConfig, _options: Record<string, unknown> = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  const host = await preflight(ctx, local, deps);
  const rows: Prerequisite[] = [...custodyRows(ctx, local), ...basePortRows(local, local.basePort === null ? [] : (deps.peers ?? (() => machinePeers(ctx, local)))())];
  const lines = [...host.lines, ...tableLines(rows)];
  const dockerOk = host.rows.filter((row) => row.id === 'docker' || row.id === 'compose').every((row) => row.ok);
  if (dockerOk) {
    const placeholders = Object.fromEntries(local.composeEnv.map((item) => [item.name, 'placeholder']));
    const render = await compose(ctx, local, ['config', '-q'], { values: placeholders });
    rows.push({ id: 'compose files', ok: render.status === 0, detail: render.status === 0 ? `${local.composeFiles.length} file(s) render` : firstLine(render.stderr) || 'do not render', fix: render.status === 0 ? null : 'fix the compose files named above' });
    lines.push(...tableLines(rows.slice(-1)));
    const volumes = splitLines(ctx.spawn('docker', ['volume', 'ls', '--filter', `label=com.docker.compose.project=${local.project}`, '--format', '{{.Name}}']).stdout);
    lines.push(`volumes: ${volumes.join(', ') || 'none yet'}`);
  }
  const record = readRecord(stateOf(ctx, local));
  const alive = deps.alive ?? isAlive;
  const recorded = Object.entries(record.processes).map(([name, entry]) => `${name} pid ${entry.pid} ${alive(entry.pid) ? 'alive' : 'gone'}`);
  lines.push(`processes: ${recorded.join(', ') || 'none recorded'}`, `state: ${fs.existsSync(stateOf(ctx, local)) ? stateOf(ctx, local) : 'none yet'}`);
  return { ok: host.ok && rows.every((row) => row.ok), lines, data: { rows: [...host.rows, ...rows] } };
}
