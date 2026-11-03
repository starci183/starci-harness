// The mail package (ruling mail-package, R90 BE_INFRA_OWNER): @starci/mail is the only owner of nodemailer, and the pins the package
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
  assert.ok([...importers].every((folder) => folder === 'src/modules/integrations/mail'), [...importers].join(', '));
});
