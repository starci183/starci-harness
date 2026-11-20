// An environment declared `cutover: {state: pending}` (PROJECT-STACKS-20, R450) takes no deploy in any form and no executed prepare
// (STACK_CUTOVER_PENDING, refused before any action module loads), and a declaration past its `until` is itself the blocking HFS_CUTOVER_EXPIRED
// and tolerates nothing; a sound pending one reports only the catalog's cutover-tolerant findings of its own environment.
// proves: STACK_CUTOVER_PENDING HFS_CUTOVER_EXPIRED HFS_CUTOVER_DECLARATION_INVALID
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stackMain } from '../stack/cli.mjs';
import { parseYaml as parse } from '../runtime/engine/yaml.mjs';
import { readCutoverDeclarations } from '../runtime/scripts/lib/stack-cutover.mjs';
import { CUTOVER_EXPIRED, CUTOVER_DECLARATION_INVALID, cutoverDeclarationFindings, judgedForCutover, type CutoverFinding } from '../runtime/scripts/hfs/check-cutover.mjs';

const TODAY = '2026-11-20';
const pending = (until: string, extra = ''): string => `schema: starci/application-stacks@1
environments:
  dev: {status: supported, runtime: docker-compose}
  production:
    status: supported
    runtime: docker-swarm
    cutover:
      state: pending
      reason: Waits for the owner to seal the new members.
      until: ${until}
      keep: [identity-provider, db/OLD_DB_PASSWORD]${extra}
`;

function app(t: TestContext, declaration: string): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-stack-cutover-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, '.starcistacks'));
  fs.writeFileSync(path.join(cwd, '.starcistacks', 'application-stacks.yaml'), declaration);
  return cwd;
}

async function stack(cwd: string, argv: string[]) {
  let err = '';
  const code = await stackMain(argv, { cwd, env: {}, stdout: () => {}, stderr: (text) => { err += text; }, importer: async () => { throw new Error('no action module may load'); } });
  return { code, err };
}

const SHA = 'a'.repeat(40);
const DEPLOYS: string[][] = [
  ['deploy', '--env', 'production', '--image', 'api=ghcr.io/o/api@sha256:00', '--sha', SHA],
  ['deploy', '--env', 'production', '--image', 'api=ghcr.io/o/api@sha256:00', '--sha', SHA, '--ci-run', '123', '--execute'],
  ['deploy', '--env', 'production', '--urgent', '--reason', 'hotfix', '--execute'],
  ['deploy', '--env', 'production', '--adopt', '--image', 'api=ghcr.io/o/api@sha256:00', '--sha', SHA, '--execute'],
  ['prepare', '--env', 'production', '--execute'],
];

test('every deploy form and an executed prepare refuse an environment pending its cutover, before anything loads', async (t) => {
  for (const declaration of [pending('2099-12-31'), pending('2020-01-01'), pending('2099-12-31').replace('      reason: Waits for the owner to seal the new members.\n', '')]) {
    const cwd = app(t, declaration);
    for (const argv of DEPLOYS) {
      const run = await stack(cwd, argv);
      assert.equal(run.code, 2, argv.join(' '));
      assert.match(run.err, /^starci app stack: STACK_CUTOVER_PENDING: stack (deploy|prepare) --env production: /u, argv.join(' '));
      assert.match(run.err, /removes environments\.production\.cutover/u);
    }
  }
});

test('a dry-run prepare, the read-only verbs and another environment are not refused by the cutover', async (t) => {
  const cwd = app(t, pending('2099-12-31'));
  for (const argv of [['prepare', '--env', 'production'], ['render', '--env', 'production'], ['deploy', '--env', 'staging', '--image', 'api=ghcr.io/o/api@sha256:00', '--sha', SHA]]) {
    assert.doesNotMatch((await stack(cwd, argv)).err, /STACK_CUTOVER_PENDING/u, argv.join(' '));
  }
});

test('a past until is HFS_CUTOVER_EXPIRED and tolerates nothing; a sound pending declaration tolerates its own environment only', () => {
  const unread = { code: 'ENV_SEALED_UNREAD', level: 'error', path: '.starcistacks/production/secrets/identity-provider.enc.yaml', key: 'OLD_SECRET', message: 'unread' };
  const missing = { code: 'STACKS_SEALED_MEMBER_MISSING', level: 'error', path: '.starcistacks/application-stacks.yaml', message: '.starcistacks/application-stacks.yaml: environments.production.secrets[0].keys: the member at secrets/auth holds no AUTH_KEY' };
  const other = { code: 'HFS_FORMAT', level: 'error', path: '.starcistacks/production/README.md', message: 'not formatted' };
  const devMissing = { ...missing, message: missing.message.replace('production', 'dev') };
  const unkept = { ...unread, path: '.starcistacks/production/secrets/db.enc.yaml', key: 'NEW_UNREAD' };
  const keptKey = { ...unkept, key: 'OLD_DB_PASSWORD' };

  const expired = readCutoverDeclarations(parse(pending('2026-11-19')), TODAY);
  assert.deepEqual(cutoverDeclarationFindings(expired, TODAY).map((finding) => finding.code), [CUTOVER_EXPIRED]);
  assert.ok(judgedForCutover<CutoverFinding>([unread, missing], expired).every((finding) => finding.report === undefined), 'an expired declaration tolerates nothing');

  const today = readCutoverDeclarations(parse(pending(TODAY)), TODAY);
  assert.deepEqual(cutoverDeclarationFindings(today, TODAY), [], 'the declaration holds through its until day');
  const judged = judgedForCutover<CutoverFinding>([unread, missing, other, devMissing, unkept, keptKey], today);
  assert.deepEqual(judged.map((finding) => finding.cutover ?? null), ['production', 'production', null, null, null, 'production']);

  for (const broken of [pending('2026-13-01'), pending('2099-12-31').replace('state: pending', 'state: done'), pending('2099-12-31', '\n      extra: 1')]) {
    const read = readCutoverDeclarations(parse(broken), TODAY);
    assert.deepEqual([...new Set(cutoverDeclarationFindings(read, TODAY).map((finding) => finding.code))], [CUTOVER_DECLARATION_INVALID]);
    assert.ok(judgedForCutover<CutoverFinding>([missing], read).every((finding) => finding.report === undefined), 'an unsound declaration tolerates nothing');
    assert.deepEqual(read.present, ['production'], 'an unsound declaration still refuses the deploy');
  }
});

