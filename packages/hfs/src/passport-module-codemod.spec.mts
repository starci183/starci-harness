// The lite passport glue is the capability module every package-backed integration is (`PassportModule` over `passport.module-definition.ts`, the
// app's logger handed to @starci/auth), and `starci app codemod passport-module` moves an app from the registration function it replaced
// (`passport.registration.ts`, `passportModule(options, { isGlobal })`): all or nothing, a dry run writes nothing, a second run finds nothing to do,
// and a glue or caller outside the rendered shape is left for a person. An app that composes the package in the module shape already is
// what the slot asks for.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
import { migratePassportModule, passportModuleMarkdown, rewriteCaller } from '../codemod/passport-module.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';
import type { Prettier } from '../sync/format.mjs';

const GLUE = 'be/src/modules/integrations/passport';
const COMPOSE = 'be/apps/api/src/compose/integrations.ts';
const TEMPLATE_GLUE = path.join(import.meta.dirname, '..', 'templates', 'be', 'skeleton-lite', 'src', 'modules', 'integrations', 'passport');

const REGISTRATION = `import { AuthModule } from "@starci/auth/server"
import type { DynamicModule } from "@nestjs/common"
import type { PassportOptions } from "./passport.options"

/** The sign-in package as a Nest module. */
export const passportModule = (options: PassportOptions, registration: { readonly isGlobal: boolean }): DynamicModule =>
    AuthModule.registerAsync({ isGlobal: registration.isGlobal, authenticator: "x", useFactory: () => options })
`;
const INDEX = 'export { parsePassportConfig } from "./passport.config"\nexport { passportModule } from "./passport.registration"\n';
const CALLER = `import { OWN_TOKEN_VERIFIER, PASSPORT_OPTIONS, passportModule } from "@modules/integrations/passport"

export const integrationModules = (options: ApiOptions) => [
    passportModule(options.passport, { isGlobal: true }),
]
`;

function app(t: TestContext, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-passport-module-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

const before = (t: TestContext, extra: Record<string, string> = {}): string =>
  app(t, { [`${GLUE}/${'passport.registration.ts'}`]: REGISTRATION, [`${GLUE}/index.ts`]: INDEX, [COMPOSE]: CALLER, ...extra });

const read = (root: string, file: string): string => fs.readFileSync(path.join(root, file), 'utf8');

test('passport-module is one of the codemods', () => {
  assert.ok(CODEMODS.includes('passport-module'));
});

test('the slot asks for the module shape the template renders, so an app that composes the package as a module is placed', () => {
  const slot = loadSlotManifest().slots.find((entry) => entry.id === 'be.integrations.passport');
  assert.ok(slot);
  const template = fs.readdirSync(TEMPLATE_GLUE);
  const moduleShaped = ['errors/', 'index.ts', 'messages/', 'passport.config.ts', 'passport.decorators.ts', 'passport.kit.spec.ts', 'passport.kit.ts', 'passport.module-definition.ts', 'passport.module.ts', 'passport.options.ts'];
  for (const required of slot.requires ?? []) {
    assert.ok(template.includes(required), `the template renders ${required}`);
    assert.ok(moduleShaped.includes(required), `a module-shaped glue holds ${required}`);
  }
  assert.ok(!(slot.requires ?? []).includes('passport.registration.ts'));
  assert.match(fs.readFileSync(path.join(TEMPLATE_GLUE, 'passport.module.ts'), 'utf8'), /inject: \[[^\]]*\bLOGGER\b[^\]]*\]/u, 'the package reports through the app logger');
});

test('a dry run names every file and writes nothing; --execute moves the glue to the module and a second run finds nothing to do', async (t) => {
  const root = before(t);
  const dry = await migratePassportModule({ root, prettier: null });
  assert.deepEqual(dry.findings, []);
  assert.deepEqual(dry.changes.map((change) => `${change.action} ${change.file}`).sort(), [
    `add ${GLUE}/passport.module-definition.ts`,
    `add ${GLUE}/passport.module.ts`,
    `delete ${GLUE}/passport.registration.ts`,
    `rewrite ${COMPOSE}`,
    `rewrite ${GLUE}/index.ts`,
  ]);
  assert.ok(fs.existsSync(path.join(root, GLUE, 'passport.registration.ts')));
  assert.match(passportModuleMarkdown(dry), /5 file\(s\) would change, 0 left for a person/u);

  const done = await migratePassportModule({ root, write: true, prettier: null });
  assert.equal(done.changes.length, 5);
  assert.equal(fs.existsSync(path.join(root, GLUE, 'passport.registration.ts')), false);
  assert.equal(read(root, `${GLUE}/passport.module.ts`), fs.readFileSync(path.join(TEMPLATE_GLUE, 'passport.module.ts'), 'utf8'));
  assert.match(read(root, `${GLUE}/index.ts`), /export \{ PassportModule \} from "\.\/passport\.module"/u);
  assert.match(read(root, COMPOSE), /import \{ OWN_TOKEN_VERIFIER, PASSPORT_AUTHENTICATOR, PASSPORT_OPTIONS, PassportModule \} from "@modules\/integrations\/passport"/u);
  assert.match(read(root, COMPOSE), /PassportModule\.register\(\{ \.\.\.options\.passport, authenticator: PASSPORT_AUTHENTICATOR, isGlobal: true \}\)/u);
  assert.match(passportModuleMarkdown(done), /5 file\(s\) changed/u);

  const again = await migratePassportModule({ root, write: true, prettier: null });
  assert.deepEqual([again.changes, again.findings], [[], []]);
});

test('an app formatter lays the written files out, and an app with no registration has nothing to do', async (t) => {
  const root = before(t);
  const seen: string[] = [];
  const prettier = {
    getFileInfo: () => Promise.resolve({ ignored: false, inferredParser: 'typescript' }),
    resolveConfig: () => Promise.resolve({}),
    format: (text: string, options: { filepath: string }) => { seen.push(path.basename(options.filepath)); return Promise.resolve(`${text}// formatted\n`); },
  } as unknown as Prettier;
  await migratePassportModule({ root, write: true, prettier });
  assert.deepEqual(seen.sort(), ['index.ts', 'integrations.ts', 'passport.module-definition.ts', 'passport.module.ts']);
  assert.match(read(root, `${GLUE}/passport.module.ts`), /\/\/ formatted\n$/u);
  const plain = app(t, { [`${GLUE}/index.ts`]: 'export {}\n' });
  assert.deepEqual(await migratePassportModule({ root: plain, write: true }), { schema: 'starci/passport-module-report@1', root: plain, write: true, changes: [], findings: [] });
});

test('a glue or caller outside the rendered shape is left for a person and nothing is written', async (t) => {
  const diverged = before(t, {
    [`${GLUE}/passport.module.ts`]: 'export class PassportModule {}\n',
    [`${GLUE}/index.ts`]: 'export * from "./passport.registration"\n',
    [COMPOSE]: 'import { passportModule } from "@modules/integrations/passport"\nexport const m = passportModule(build(), { isGlobal: true })\n',
  });
  const report = await migratePassportModule({ root: diverged, write: true, prettier: null });
  assert.deepEqual(report.findings.map((finding) => `${finding.code} ${finding.file}`), [
    `PASSPORT_MODULE_PRESENT ${GLUE}/passport.module.ts`,
    `PASSPORT_INDEX_BY_HAND ${GLUE}/index.ts`,
    `PASSPORT_CALL_BY_HAND ${COMPOSE}`,
  ]);
  assert.deepEqual(report.changes, []);
  assert.ok(fs.existsSync(path.join(diverged, GLUE, 'passport.registration.ts')));
  assert.equal(fs.existsSync(path.join(diverged, GLUE, 'passport.module-definition.ts')), false);
  assert.match(passportModuleMarkdown(report), /## Left for a person[\s\S]*PASSPORT_CALL_BY_HAND/u);
  assert.equal(rewriteCaller('import { other } from "@modules/integrations/passport"\npassportModule(x, { isGlobal: true })\n'), null, 'a caller that does not import the function is not rewritten');
  assert.equal(rewriteCaller('const a = 1\n'), null);
  const noIndex = app(t, { [`${GLUE}/passport.registration.ts`]: REGISTRATION });
  assert.deepEqual((await migratePassportModule({ root: noIndex, prettier: null })).findings.map((finding) => finding.code), ['PASSPORT_INDEX_BY_HAND']);
});

test('the command runs dry by default, writes with --execute and exits 1 with the report when a person is needed', async (t) => {
  const root = before(t);
  const out: string[] = [];
  assert.equal(await codemodMain(['passport-module'], { cwd: root, stdout: (text) => out.push(text) }), 0);
  assert.ok(fs.existsSync(path.join(root, GLUE, 'passport.registration.ts')));
  assert.equal(await codemodMain(['passport-module', '--execute', '--json'], { cwd: root, stdout: (text) => out.push(text) }), 0);
  assert.equal(fs.existsSync(path.join(root, GLUE, 'passport.registration.ts')), false);
  assert.match(out.at(-1) ?? '', /"schema": ?"starci\/passport-module-report@1"/u);
  const left = before(t, { [COMPOSE]: 'import { passportModule } from "@modules/integrations/passport"\nexport const m = passportModule(build(), {})\n' });
  assert.equal(await codemodMain(['passport-module'], { cwd: left, stdout: () => undefined }), 1);
});
