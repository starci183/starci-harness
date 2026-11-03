// `starci app codemod module-definition`: a module definition written with ConfigurableModuleBuilder (destructured, or the typed form with a Host type and re-exports)
// becomes one call of @starci/nest-kit, and the app gains the dependency (R368, R21, R45 capability-module-shape).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
import { migrateModuleDefinition, moduleDefinitionMarkdown, transformModuleDefinition } from '../codemod/module-definition.mjs';
import { declarationSurface } from '../runtime/scripts/lib/declaration-surface.mjs';

const run = (text: string, file = 'be/src/modules/platform/clock/clock.module-definition.ts') => transformModuleDefinition({ ts, text, file });

const DESTRUCTURED = `import { ConfigurableModuleBuilder } from "@nestjs/common"
import type { HoursOptions } from "./hours.options"

/** The configurable-module base of the hours feature. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = new ConfigurableModuleBuilder<HoursOptions>().setClassMethodName("register").build()
`;

const TYPED_CAPABILITY = `import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import { HTTP_OPTIONS } from "./http.decorators"
import type { HttpOptions } from "./http.options"

const built = new ConfigurableModuleBuilder<HttpOptions>({ optionsInjectionToken: HTTP_OPTIONS })
        .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
        .build()
type Host = ConfigurableModuleHost<HttpOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the http capability; \`isGlobal\` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
`;

const TYPED_PLAIN = `import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { QueueOptions } from "./queue.options"

const built = new ConfigurableModuleBuilder<QueueOptions>().setClassMethodName("register").build()
type Host = ConfigurableModuleHost<QueueOptions, "register", "create", {}>

/** The configurable-module base of the queue module. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the registered options. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
`;

test('1. the destructured form becomes defineConfigurableModule and keeps its names and doc', () => {
  const result = run(DESTRUCTURED, 'be/src/features/api/hours/hours.module-definition.ts');
  assert.equal(result.text, `import { defineConfigurableModule } from "@starci/nest-kit"
import type { HoursOptions } from "./hours.options"

/** The configurable-module base of the hours feature. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<HoursOptions>()
`);
  assert.deepEqual(result.changes.map((change) => [change.from, change.helper, change.names]), [['destructured builder', 'defineConfigurableModule', ['ConfigurableModuleClass', 'MODULE_OPTIONS_TOKEN', 'OPTIONS_TYPE']]]);
  assert.deepEqual(result.findings, []);
});

test('2. the typed form of a capability becomes defineCapabilityModule with its options token, laid out at the print width', () => {
  const result = run(TYPED_CAPABILITY);
  assert.equal(result.text, `import { defineCapabilityModule } from "@starci/nest-kit"
import { HTTP_OPTIONS } from "./http.decorators"
import type { HttpOptions } from "./http.options"

/** The configurable-module base of the http capability; \`isGlobal\` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<HttpOptions>({
    optionsInjectionToken: HTTP_OPTIONS,
})
`);
  assert.deepEqual(result.changes.map((change) => [change.from, change.helper]), [['typed builder', 'defineCapabilityModule']]);
});

test('3. the typed form of a plain module keeps the three names it exported, and a long call breaks after the equals sign', () => {
  const result = run(TYPED_PLAIN);
  assert.match(result.text, /^import \{ defineConfigurableModule \} from "@starci\/nest-kit"\nimport type \{ QueueOptions \}/);
  assert.match(result.text, /export const \{ ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE \} = defineConfigurableModule<QueueOptions>\(\)\n$/);
  const long = run(DESTRUCTURED.replaceAll('HoursOptions', 'AVeryLongNamedFeatureOptionsThatDoesNotFitOnOneLineWithTheNamesBesideItEver'));
  assert.match(long.text, / =\n    defineConfigurableModule<AVeryLong/);
  const token = run(TYPED_CAPABILITY.replaceAll('HTTP_OPTIONS', 'A_VERY_LONG_OPTIONS_TOKEN_NAME_THAT_PUSHES_THE_CALL_OVER_THE_LINE_WIDTH_OF_THE_CANON').replace('OPTIONS_TYPE: Host', 'OPTIONS_TYPE: Host'));
  assert.match(token.text, /defineCapabilityModule<HttpOptions>\(\{\n    optionsInjectionToken: A_VERY_LONG/);
});

test('4. what the codemod writes is a surface R368 accepts, and a second run changes nothing', () => {
  for (const text of [DESTRUCTURED, TYPED_CAPABILITY, TYPED_PLAIN]) {
    const once = run(text);
    assert.deepEqual(declarationSurface(ts, 'a.module-definition.ts', once.text)?.problems, []);
    const twice = run(once.text);
    assert.equal(twice.text, once.text);
    assert.deepEqual([twice.changes, twice.findings], [[], []]);
  }
});

test('5. a chain the helpers do not stand for is left for a person, untouched', () => {
  const cases: Array<[string, string]> = [
    ['MODULE_DEFINITION_CHAIN', DESTRUCTURED.replace('.setClassMethodName("register")', '.setClassMethodName("forRoot")')],
    ['MODULE_DEFINITION_CHAIN', DESTRUCTURED.replace('.setClassMethodName("register")', '.setFactoryMethodName("createHours")')],
    ['MODULE_DEFINITION_CHAIN', TYPED_CAPABILITY.replace('{ isGlobal: false }', '{ isGlobal: true }')],
    ['MODULE_DEFINITION_BUILDER_OPTIONS', DESTRUCTURED.replace('ConfigurableModuleBuilder<HoursOptions>()', 'ConfigurableModuleBuilder<HoursOptions>({ moduleName: "Hours" })')],
    ['MODULE_DEFINITION_UNTYPED', DESTRUCTURED.replace('<HoursOptions>', '')],
    ['MODULE_DEFINITION_NAMES', DESTRUCTURED.replace('OPTIONS_TYPE }', 'OPTIONS_TYPE: Options }')],
    ['MODULE_DEFINITION_NOT_BUILT', DESTRUCTURED.replace('.build()', '')],
    ['MODULE_DEFINITION_NAMES', `${TYPED_PLAIN}export const other = typeof built\n`],
  ];
  for (const [code, text] of cases) {
    const result = run(text);
    assert.equal(result.text, text, code);
    assert.deepEqual(result.findings.map((finding) => finding.code), [code], code);
  }
  assert.equal(run('export const x = 1\n').text, 'export const x = 1\n');
  const other = `import { ConfigurableModuleBuilder } from "@nestjs/common"\nexport const builder = new ConfigurableModuleBuilder<X>()\n`;
  assert.equal(run(other).text, other);
});

test('6. other imports and statements of the file stay, and an unused builder import is the only one dropped', () => {
  const text = `import { ConfigurableModuleBuilder, Injectable } from "@nestjs/common"
import type { LedgerOptions } from "./ledger.options"

/** What register takes. */
export type LedgerRegisterOptions = Partial<LedgerOptions>

/** The base. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = new ConfigurableModuleBuilder<LedgerOptions>().setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal })).build()
`;
  const result = run(text);
  assert.equal(result.text, `import { defineCapabilityModule } from "@starci/nest-kit"
import { Injectable } from "@nestjs/common"
import type { LedgerOptions } from "./ledger.options"

/** What register takes. */
export type LedgerRegisterOptions = Partial<LedgerOptions>

/** The base. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<LedgerOptions>()
`);
});

function app(files: Record<string, string>): { root: string; done(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-definition-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('7. the app is migrated file by file; a dry run writes nothing, --execute rewrites and adds the dependency once', () => {
  const fixture = app({
    'package.json': `${JSON.stringify({ name: 'demo', dependencies: { '@nestjs/common': '11.2.5' } }, null, 2)}\n`,
    'be/src/features/api/hours/hours.module-definition.ts': DESTRUCTURED,
    'be/src/modules/platform/http/http.module-definition.ts': TYPED_CAPABILITY,
    'be/src/modules/platform/node_modules/x/ignored.module-definition.ts': DESTRUCTURED,
    'be/src/modules/platform/clock/clock.service.ts': 'export const clock = 1\n',
  });
  try {
    const dry = migrateModuleDefinition({ root: fixture.root, ts });
    assert.deepEqual([dry.schema, dry.filesScanned, dry.filesChanged.length, dry.write, dry.dependency.declared, dry.dependency.added], ['starci/module-definition-report@1', 2, 2, false, false, false]);
    assert.equal(fs.readFileSync(path.join(fixture.root, 'be/src/features/api/hours/hours.module-definition.ts'), 'utf8'), DESTRUCTURED, 'a dry run writes nothing');
    assert.match(moduleDefinitionMarkdown(dry), /2 would be rewritten/);
    const out: string[] = [];
    assert.equal(codemodMain(['module-definition', '--execute'], { cwd: fixture.root, stdout: (text) => out.push(text) }), 0);
    assert.match(out.join(''), /was added to package.json/);
    assert.match(fs.readFileSync(path.join(fixture.root, 'be/src/modules/platform/http/http.module-definition.ts'), 'utf8'), /defineCapabilityModule<HttpOptions>/);
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    assert.deepEqual(Object.keys(manifest.dependencies), ['@nestjs/common', '@starci/nest-kit']);
    assert.match(manifest.dependencies['@starci/nest-kit'] as string, /^\d+\.\d+\.\d+$/);
    const again = migrateModuleDefinition({ root: fixture.root, ts });
    assert.deepEqual([again.filesChanged, again.changes, again.findings, again.dependency.declared], [[], [], [], true]);
    assert.ok(CODEMODS.includes('module-definition'));
  } finally {
    fixture.done();
  }
});

test('8. a case left for a person exits 1 and the app without a back end is refused', () => {
  const stuck = app({ 'be/src/features/api/hours/hours.module-definition.ts': DESTRUCTURED.replace('"register"', '"forRoot"') });
  const bare = app({ 'README.md': '# app\n' });
  try {
    assert.equal(codemodMain(['module-definition'], { cwd: stuck.root, stdout: () => undefined }), 1);
    assert.match(moduleDefinitionMarkdown(migrateModuleDefinition({ root: stuck.root, ts })), /Left for a person/);
    assert.throws(() => migrateModuleDefinition({ root: bare.root, ts }), /be\/ directory/);
  } finally {
    stuck.done();
    bare.done();
  }
});
