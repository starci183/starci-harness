// proves: BE_SOURCE_FORM@lite
// proves: BE_SOURCE_FORM@full
// R89's repository enforcer (`source-suffix` in scripts/hfs/check.mjs): `starci app check` refuses a back-end file whose role suffix is
// outside the slot manifest's closed vocabulary. The lint enforcers of the same rule are proved in packages/eslint-canon-be/be-r89-source-form-coverage.spec.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { allowsFile } from '../runtime/scripts/hfs/allows.mjs';
import { isMeasured } from '../runtime/scripts/hfs/coverage-scope.mjs';
import { openHfs } from '../runtime/scripts/hfs/slots.mjs';

const CODE = 'BE_SOURCE_FORM';
const suffixGood = 'be/src/features/api/orders/application/cancel-order.command.ts';
const suffixBad = 'be/src/features/api/orders/application/cancel-order.use-case.ts';
const topicPolicy = 'be/src/modules/domain/orders/order-status.policy.ts';
const topicSuffix = 'be/src/modules/domain/orders/order-status.topic.ts';
const topicBuilder = [
  'import type { RealtimeTopic } from "../../platform/realtime/realtime.port";',
  'import type { OrderStatusFrame } from "./orders.contracts";',
  'const isOrderStatusFrame = (value: unknown): value is OrderStatusFrame => typeof value === "object" && value !== null && "id" in value && typeof value.id === "string";',
  'export const orderStatusTopic = (principalId: string, orderId: string): RealtimeTopic<OrderStatusFrame> => ({ name: `order-status:${principalId}:${orderId}`, accepts: isOrderStatusFrame });',
].join('\n');
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

/** A back-end app tracked in git with command roles and the same typed topic builder under two suffixes. */
function appTree(t: TestContext, edition: string): string {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-r89-')));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const files = {
    'hfs.json': JSON.stringify({ hfs: 3, kind: 'app', project: 'fixture', edition, sides: { be: { apps: [{ name: 'core', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } }),
    'package.json': JSON.stringify({ name: 'fixture', private: true }),
    'be/tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true, experimentalDecorators: true }, include: ['src/**/*', 'apps/**/*'] }),
    'be/apps/core/src/main.ts': 'void 0;\n',
    'be/apps/core/src/app.module.ts': 'export const AppModule = 1;\n',
    [suffixGood]: 'export class CancelOrderCommand {}\n',
    [suffixBad]: 'export class CancelOrderUseCase {}\n',
    [topicPolicy]: topicBuilder,
    [topicSuffix]: topicBuilder,
    'be/src/modules/domain/orders/order-status.policy.spec.ts': 'export {};\n',
    'be/src/modules/domain/orders/orders.contracts.ts': 'export interface OrderStatusFrame { readonly id: string }\n',
    'be/src/modules/domain/orders/index.ts': 'export { orderStatusTopic } from "./order-status.policy";\n',
    'be/src/modules/platform/realtime/realtime.port.ts': 'export interface RealtimeTopic<T extends object> { readonly name: string; accepts(value: unknown): value is T }\n',
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), text);
  }
  for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(spawnSync('git', args, { cwd: repoRoot, env: gitEnv }).status, 0);
  return repoRoot;
}

const sourceForm = (repoRoot: string, file: string) => checkRepo({ repoRoot, files: [file], tree: false, phase: 'source' }).findings.filter((finding) => finding.code === CODE);

for (const edition of ['lite', 'full']) {
  test(`${CODE} ${edition}: the app check rejects a role suffix outside the closed vocabulary`, (t) => {
    const repoRoot = appTree(t, edition);
    assert.equal(sourceForm(repoRoot, suffixBad)[0]?.code, CODE);
  });
  test(`${CODE} ${edition}: the app check accepts a declared role suffix`, (t) => {
    const repoRoot = appTree(t, edition);
    assert.deepEqual(sourceForm(repoRoot, suffixGood), []);
  });
  test(`${CODE} ${edition}: a typed topic builder and its spec are admitted domain policies with measured logic`, (t) => {
    const repoRoot = appTree(t, edition);
    const hfs = openHfs({ repoRoot });
    for (const file of [topicPolicy, topicPolicy.replace('.ts', '.spec.ts')]) {
      assert.equal(hfs.classifyPath(file).status, 'owned');
      assert.equal(hfs.classifyPath(file).slot, 'be.domain');
      assert.equal(allowsFile(hfs, file)?.allowed, true);
      assert.deepEqual(sourceForm(repoRoot, file), []);
    }
    assert.equal(isMeasured(hfs.manifest, topicPolicy.slice('be/'.length)), true);
    assert.equal(isMeasured(hfs.manifest, 'src/modules/domain/orders/orders.contracts.ts'), false);
  });
  test(`${CODE} ${edition}: a topic builder does not introduce a topic role`, (t) => {
    const repoRoot = appTree(t, edition);
    assert.equal(sourceForm(repoRoot, topicSuffix)[0]?.code, CODE);
    assert.equal(allowsFile(openHfs({ repoRoot }), topicSuffix)?.allowed, false);
  });
}
