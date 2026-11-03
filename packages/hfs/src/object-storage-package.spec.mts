// The object storage package (ruling object-storage-package, R331 BE_STORAGE_OWNER): @starci/object-storage is the only owner of the
// AWS S3 client libraries, the lite starter's integrations/object-storage is its glue, and nothing else of the starter imports
// either. The pins the package depends on stay the stack's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');
const STARTER = path.join(import.meta.dirname, '..', 'templates', 'be', 'skeleton-lite');
const GLUE = path.join(STARTER, 'src', 'modules', 'integrations', 'object-storage');
const manifest = loadSlotManifest();
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')); // reason: parsed package.json

const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return sources(full);
  return /\.(?:ts|tsx|partial|tpl)$/.test(entry.name) ? [full] : [];
});

test('the manifest gives @starci/object-storage to integrations/object-storage and the S3 libraries and minio to nobody', () => {
  const owners = manifest.ruleParams.be.infraOwners;
  assert.deepEqual(owners['@starci/object-storage'], ['integrations/object-storage']);
  assert.deepEqual(owners['@aws-sdk/client-s3'], []);
  assert.deepEqual(owners['@aws-sdk/s3-request-presigner'], []);
  assert.deepEqual(owners.minio, []);
});

test('the package depends on the S3 libraries at exactly the versions the stack pins', () => {
  const manifestOf = readJson(path.join(REPOSITORY, 'packages', 'object-storage', 'package.json'));
  const stack = parseYaml(fs.readFileSync(path.join(REPOSITORY, 'contexts', 'stack', 'pins.yaml'), 'utf8')).pins;
  for (const name of ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner']) assert.equal(manifestOf.dependencies[name], stack[name].version, name);
  assert.equal(stack['@starci/object-storage'].version, manifestOf.version);
});

test('the lite starter imports the package in its object-storage folder alone and the AWS S3 libraries nowhere', () => {
  const importers = new Set<string>();
  for (const file of sources(STARTER)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /@aws-sdk\//, path.relative(STARTER, file));
    if (/from\s+['"]@starci\/object-storage/.test(text)) importers.add(path.relative(STARTER, file).split(path.sep).slice(0, 4).join('/'));
  }
  assert.deepEqual([...importers], ['src/modules/integrations/object-storage']);
});

test('the glue is a module, the typed options, the config parser and the injectors, with no hand-written S3 client', () => {
  const names = fs.readdirSync(GLUE).filter((name) => fs.statSync(path.join(GLUE, name)).isFile()).sort();
  assert.deepEqual(names, ['index.ts', 'object-storage.config.spec.ts', 'object-storage.config.ts', 'object-storage.decorators.ts', 'object-storage.module.ts', 'object-storage.options.ts']);
  const module = fs.readFileSync(path.join(GLUE, 'object-storage.module.ts'), 'utf8');
  assert.match(module, /ObjectStorageModule\.registerAsync\(/);
  assert.match(module, /isGlobal: true/);
});

test('the starter composes the module once, in the integration modules of the API root, and binds no storage token by hand', () => {
  const compose = fs.readFileSync(path.join(STARTER, 'apps', 'api', 'src', 'compose', 'integrations.ts'), 'utf8');
  assert.match(compose, /integrationModules[^]*objectStorageModule\(options\.objectStorage\)/);
  assert.doesNotMatch(compose, /provide: OBJECT_STORAGE\b/);
  assert.match(fs.readFileSync(path.join(STARTER, 'apps', 'api', 'src', 'app.module.ts'), 'utf8'), /\.\.\.integrationModules\(options\)/);
});
