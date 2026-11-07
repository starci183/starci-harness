// A declared sealed member holds the keys its environment's KEYS.md roster maps to its path (`secrets/<slug>` or `/run/secrets/<slug>`); only a
// member the roster never names falls back to its slug as the key. The scaffold seals its placeholders under those keys, so the db service's
// member holds POSTGRES_PASSWORD, the key its POSTGRES_PASSWORD_FILE reads, and no ENV_SEALED_UNREAD follows.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { declaredSealedMembers } from '../runtime/scripts/hfs/sealed-members.mjs';

const ROSTER = `# Production environment key roster

| Key | Consumer |
| --- | --- |
| \`PRIMARY_DB_URL\` | API connection; reads \`PRIMARY_DB_URL_FILE\` at \`/run/secrets/primary-db-url\` |
| \`POSTGRES_PASSWORD\` | The db service's superuser password; reads \`POSTGRES_PASSWORD_FILE\` at \`/run/secrets/db-password\` |
| \`PORT\` | API listener |
`;

function app(t: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-sealed-keys-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.starcistacks', 'production', 'runtime', 'env'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'production', 'runtime', 'env', 'KEYS.md'), ROSTER);
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), [
    'environments:',
    '  production:',
    '    secrets:',
    '      - {name: primary-db-url, where: secrets/primary-db-url}',
    '      - {name: db-password, where: secrets/db-password}',
    '      - {name: google-client-secret, where: secrets/google-client-secret}',
    '',
  ].join('\n'));
  return root;
}

test('a sealed member holds the keys its roster row maps to its path, the slug only when no row names it', (t) => {
  const members = declaredSealedMembers(app(t));
  assert.deepEqual(members.map((member) => [member.slug, member.keys]), [
    ['db-password', ['POSTGRES_PASSWORD']],
    ['google-client-secret', ['GOOGLE_CLIENT_SECRET']],
    ['primary-db-url', ['PRIMARY_DB_URL']],
  ]);
});
