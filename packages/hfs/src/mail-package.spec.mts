// The mail package (R90 BE_INFRA_OWNER): @starci/mail is the only owner of nodemailer, and the pins the package
// depends on stay the stack's own. The lite starter composes it in integrations/mail alone and imports nodemailer nowhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');
const STARTER = path.join(import.meta.dirname, '..', 'templates', 'be', 'skeleton-lite');
const manifest = loadSlotManifest();
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')); // reason: parsed package.json

const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return sources(full);
  return /\.(?:ts|tsx|partial|tpl)$/.test(entry.name) ? [full] : [];
});

test('the manifest gives @starci/mail to integrations/mail and nodemailer to nobody', () => {
  const owners = manifest.ruleParams.be.infraOwners;
  assert.deepEqual(owners['@starci/mail'], ['integrations/mail']);
  assert.deepEqual(owners.nodemailer, []);
});

test('the package depends on nodemailer at exactly the version the stack pins, and the stack pins the package at its own version', () => {
  const manifestOf = readJson(path.join(REPOSITORY, 'packages', 'mail', 'package.json'));
  const stack = parseYaml(fs.readFileSync(path.join(REPOSITORY, 'contexts', 'stack', 'pins.yaml'), 'utf8')).pins;
  assert.equal(manifestOf.dependencies.nodemailer, stack.nodemailer.version);
  assert.deepEqual(Object.keys(manifestOf.dependencies), ['nodemailer']);
  assert.equal(stack['@starci/mail'].version, manifestOf.version);
});

test('the lite starter imports nodemailer nowhere, and @starci/mail in its mail folder alone', () => {
  const importers = new Set<string>();
  for (const file of sources(STARTER)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /from\s+['"]nodemailer|require\(['"]nodemailer/, path.relative(STARTER, file));
    if (/from\s+['"]@starci\/mail/.test(text)) importers.add(path.relative(STARTER, file).split(path.sep).slice(0, 4).join('/'));
  }
  assert.deepEqual([...importers], ['src/modules/integrations/mail']);
});

const AUTH = path.join(import.meta.dirname, '..', 'templates', 'be', 'auth-lite');
const GLUE = path.join(STARTER, 'src', 'modules', 'integrations', 'mail');
const APP = path.join(import.meta.dirname, '..', 'templates', 'app', 'skeleton-lite');

test('the mail glue is a module with its definition, the typed options, the config parser and the injectors, with no hand-written SMTP client', () => {
  const names = fs.readdirSync(GLUE).filter((name) => fs.statSync(path.join(GLUE, name)).isFile()).sort();
  assert.deepEqual(names, ['index.ts', 'mail.config.ts', 'mail.decorators.ts', 'mail.module-definition.ts', 'mail.module.ts', 'mail.options.ts']);
  const slot = manifest.slots.find((entry: { id: string }) => entry.id === 'be.integrations.mail');
  assert.ok(slot);
  assert.deepEqual([...(slot.requires ?? [])].sort(), names);
  assert.match(fs.readFileSync(path.join(GLUE, 'mail.module.ts'), 'utf8'), /PackageMailModule\.register\(/);
});

test('the starter registers the mail module once, in the integration modules of the API root', () => {
  const compose = fs.readFileSync(path.join(STARTER, 'apps', 'api', 'src', 'compose', 'integrations.ts'), 'utf8');
  assert.match(compose, /MailModule\.register\(\{ \.\.\.options\.mail, isGlobal: true \}\)/);
});

test('the managed sign-in slots list every file of the auth-lite template, the five email doors included', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  const files = walk(AUTH).map((file) => path.relative(AUTH, file).split(path.sep).join('/')).sort();
  const listed = ['be.identity.sign-in', 'be.feature.auth'].flatMap((id) => {
    const slot = manifest.slots.find((entry: { id: string }) => entry.id === id);
    assert.ok(slot, id);
    return String(slot.path).slice(1, -1).split(',');
  }).sort();
  assert.deepEqual(listed, files);
  const controller = fs.readFileSync(path.join(AUTH, 'src', 'features', 'api', 'auth', 'transport', 'http', 'auth.controller.ts'), 'utf8');
  for (const door of ['signup', 'resend', 'confirm', 'forgot', 'reset']) {
    assert.ok(files.includes(`src/features/api/auth/application/${door}.command.ts`), door);
    assert.match(controller, new RegExp(`@Post\\("${door}"\\)`), door);
  }
});

test('the email tokens are kept as digests in a table of the baseline migration, and the stacks name the mail keys', () => {
  const sql = fs.readFileSync(path.join(APP, 'db', 'migrations', '__timestamp___baseline.sql'), 'utf8');
  assert.match(sql, /create table public\.identity_email_tokens \([^;]*token_hash varchar\(64\) not null/u);
  const service = fs.readFileSync(path.join(AUTH, 'src', 'modules', 'domain', 'identity', 'identity-email.service.ts'), 'utf8');
  assert.match(service, /tokenHash: digestOf\(token\)/);
  for (const keys of ['dev', 'production']) {
    const text = fs.readFileSync(path.join(APP, '.starcistacks', keys, 'runtime', 'env', 'KEYS.md'), 'utf8');
    for (const key of ['MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURITY', 'MAIL_FROM', 'MAIL_FROM_NAME']) assert.ok(text.includes(key), `${keys} ${key}`);
  }
});

const WEB = path.join(import.meta.dirname, '..', 'templates', 'fe', 'skeleton-lite', 'apps', 'web', 'src');

test('the links of the mails open pages that exist: the routes are the paths the service builds, under the unprefixed default locale', () => {
  const service = fs.readFileSync(path.join(AUTH, 'src', 'modules', 'domain', 'identity', 'identity-email.service.ts'), 'utf8');
  const routes = fs.readFileSync(path.join(WEB, 'modules', 'routes', 'index.ts'), 'utf8');
  for (const door of ['confirm', 'reset']) {
    assert.ok(service.includes(`/auth/${door}?token=`), door);
    assert.ok(routes.includes(`${door}: "/auth/${door}"`), door);
    assert.ok(fs.existsSync(path.join(WEB, 'app', '[locale]', 'auth', door, 'page.tsx')), door);
  }
  for (const door of ['signup', 'resend', 'forgot']) assert.ok(fs.existsSync(path.join(WEB, 'app', '[locale]', 'auth', door, 'page.tsx')), door);
  assert.match(fs.readFileSync(path.join(WEB, 'modules', 'i18n', 'routing.ts'), 'utf8'), /"as-needed"/u);
});

test('the email doors have copy in both languages and stay off the AuthClient interface the full edition satisfies', () => {
  const en = JSON.parse(fs.readFileSync(path.join(WEB, 'modules', 'i18n', 'messages', 'en.json'), 'utf8')); // reason: parsed catalog
  const vi = JSON.parse(fs.readFileSync(path.join(WEB, 'modules', 'i18n', 'messages', 'vi.json'), 'utf8')); // reason: parsed catalog
  const keys = (value: unknown, prefix = ''): string[] => (typeof value === 'object' && value !== null ? Object.entries(value).flatMap(([name, inner]) => keys(inner, `${prefix}${name}.`)) : [prefix]);
  assert.deepEqual(keys(vi.app.emailAuth).sort(), keys(en.app.emailAuth).sort());
  const contracts = fs.readFileSync(path.join(import.meta.dirname, '..', 'templates', 'fe', 'skeleton', 'apps', '__app__', 'src', 'modules', 'auth', 'contracts.ts'), 'utf8');
  assert.doesNotMatch(contracts, /signup|forgot|resend/iu);
  const slot = manifest.slots.find((entry: { id: string }) => entry.id === 'fe.modules.auth.client');
  assert.ok(slot);
  assert.equal(slot.path, 'apps/web/src/modules/auth/{client.ts,email-doors.ts,index.ts}');
});
