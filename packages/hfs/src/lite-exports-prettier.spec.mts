// A generator's barrel export lands in the statement that already exports from its source, whether that statement is on one line or broken over
// several the way the app's Prettier prints it, and the statement it writes is Prettier's own: one line when it fits the print width, else one
// name a line. So `starci app add table` on a Prettier-clean barrel neither repeats an export (TS2300) nor leaves the barrel unformatted.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liteExportEdits } from '../scaffold/lite-exports.mjs';

const BARREL = 'be/src/modules/platform/database/index.ts';

function app(t: TestContext, barrel: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lite-exports-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ['be/src/modules/platform/http-security/index.ts', 'be/src/modules/platform/logging/index.ts']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'export {}\n');
  }
  fs.mkdirSync(path.dirname(path.join(root, BARREL)), { recursive: true });
  fs.writeFileSync(path.join(root, BARREL), barrel);
  return root;
}

const after = (root: string): string => liteExportEdits({ root, generator: 'table' }).find((edit) => edit.relative === BARREL)?.after ?? fs.readFileSync(path.join(root, BARREL), 'utf8');

test('a registration whose names a Prettier-broken export already holds leaves that statement as it is', (t) => {
  const barrel = [
    'export { DatabaseModule } from "./database.module"',
    'export {',
    '    DATABASE_PROBE,',
    '    InjectDatabaseProbe,',
    '    InjectPrimaryEntityManager,',
    '    PRIMARY_ENTITY_MANAGER,',
    '} from "./primary.decorators"',
    '',
  ].join('\n');
  const result = after(app(t, barrel));
  assert.ok(result.startsWith(barrel), result);
  assert.equal(result.match(/InjectPrimaryEntityManager/gu)?.length, 1, 'no export is repeated');
});

test('a registration joins the statement of its source and the statement is broken once it passes the print width', (t) => {
  const result = after(app(t, 'export { DATABASE_PROBE, InjectDatabaseProbe, VERY_LONG_NAME_OF_A_PROBE_TOKEN_FOR_WIDTH } from "./primary.decorators"\n'));
  assert.equal(result.match(/from "\.\/primary\.decorators"/gu)?.length, 1, 'one statement per source');
  assert.match(result, /^export \{\n {4}DATABASE_PROBE,\n {4}InjectDatabaseProbe,\n {4}InjectPrimaryEntityManager,\n {4}PRIMARY_ENTITY_MANAGER,\n {4}VERY_LONG_NAME_OF_A_PROBE_TOKEN_FOR_WIDTH,\n\} from "\.\/primary\.decorators"$/mu);
});
