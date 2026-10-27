import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { renderCanonBindingChanges } from '../runtime/scripts/lib/canon-binding-text.mjs';

const digest = (value, files) => ({ algorithm: 'sha256', value, files });
const block = (indent, pkg, version, hash, files) => [
  `${indent}package: '${pkg}'`,
  `${indent}version: ${version} # release version`,
  `${indent}contentDigest:`,
  `${indent}  algorithm: sha256`,
  `${indent}  include: ['**/*.mjs']`,
  `${indent}  value: ${hash} # archive identity`,
  `${indent}  files: ${files}`,
].join('\n');

const other = `  nest:\n    title: Backend owner\n    canon:\n${block('      ', '@starci/eslint-canon-be', '3.4.40', 'a'.repeat(64), 100)}\n`;
const original = [
  '# Authored inventory; retain comments and ordering.',
  'schema: starci/code-pattern-profile@1',
  'profiles:',
  other.trimEnd(),
  '  next:',
  '    title: Frontend owner',
  '    canon:',
  block('      ', '@starci/eslint-canon-fe', '8.4.39', 'b'.repeat(64), 200),
  '    familyCanons:',
  '      starci:',
  block('        ', '@starci/eslint-grammar-core', '0.12.0', 'c'.repeat(64), 300),
  '      offset-pop:',
  block('        ', '@starci/eslint-grammar-offset-pop', '0.12.0', 'd'.repeat(64), 400),
  '    sourceRuleRoots:',
  '      - knowledge/patterns/fe',
  '',
].join('\n');

const rows = [
  { profile: 'next', binding: 'canon', package: '@starci/eslint-canon-fe', to: { version: '8.4.40', value: 'e'.repeat(64), files: 201 } },
  { profile: 'next', binding: 'familyCanons.starci', package: '@starci/eslint-grammar-core', to: { version: '0.13.0', value: 'f'.repeat(64), files: 301 } },
  { profile: 'next', binding: 'familyCanons.offset-pop', package: '@starci/eslint-grammar-offset-pop', to: { version: '0.14.0', value: '0'.repeat(64), files: 401 } },
];

test('release updates the universal and both family bindings independently and preserves authored text', () => {
  const result = renderCanonBindingChanges(original, rows);
  const doc = parseYaml(result);
  for (const row of rows) {
    const updated = row.binding.split('.').reduce((value, key) => value[key], doc.profiles[row.profile]);
    assert.equal(updated.package, row.package);
    assert.equal(updated.version, row.to.version);
    assert.deepEqual({ algorithm: updated.contentDigest.algorithm, value: updated.contentDigest.value, files: updated.contentDigest.files }, digest(row.to.value, row.to.files));
    assert.deepEqual(updated.contentDigest.include, ['**/*.mjs']);
  }
  assert.ok(result.includes(other), 'the other profile stays byte-identical');
  assert.ok(result.startsWith('# Authored inventory; retain comments and ordering.\n'));
  assert.equal(result.match(/# release version/g).length, 4);
  assert.equal(result.match(/# archive identity/g).length, 4);
  assert.ok(result.endsWith('    sourceRuleRoots:\n      - knowledge/patterns/fe\n'));
});

test('one family update leaves the universal and sibling family identities unchanged', () => {
  const before = parseYaml(original);
  const after = parseYaml(renderCanonBindingChanges(original, [rows[1]]));
  assert.deepEqual(after.profiles.next.canon, before.profiles.next.canon);
  assert.deepEqual(after.profiles.next.familyCanons['offset-pop'], before.profiles.next.familyCanons['offset-pop']);
  assert.equal(after.profiles.next.familyCanons.starci.version, rows[1].to.version);
});

test('a newly declared family binds through its YAML path without changing the release renderer', () => {
  const source = original.replaceAll('offset-pop', 'paper');
  const row = { ...rows[2], binding: 'familyCanons.paper', package: '@starci/eslint-grammar-paper' };
  const after = parseYaml(renderCanonBindingChanges(source, [row]));
  assert.equal(after.profiles.next.familyCanons.paper.version, row.to.version);
  assert.equal(after.profiles.next.familyCanons.paper.contentDigest.value, row.to.value);
  assert.deepEqual(after.profiles.next.familyCanons.starci, parseYaml(source).profiles.next.familyCanons.starci);
});

test('binding updates preserve CRLF and an absent terminal newline', () => {
  const source = original.trimEnd().replaceAll('\n', '\r\n');
  const result = renderCanonBindingChanges(source, [rows[0]]);
  assert.equal(result.includes('\n') && !result.replaceAll('\r\n', '').includes('\n'), true);
  assert.equal(result.endsWith('\n'), false);
  assert.equal(parseYaml(result).profiles.next.canon.version, rows[0].to.version);
  assert.equal(renderCanonBindingChanges(source, []), source);
});

test('missing, duplicate and unexpected binding paths refuse instead of editing another owner', () => {
  assert.throws(() => renderCanonBindingChanges(original, [{ ...rows[0], profile: 'missing' }]), /expected one missing field/);
  assert.throws(() => renderCanonBindingChanges(original.replace('      starci:', '      absent:'), [rows[1]]), /expected one starci field/);
  assert.throws(() => renderCanonBindingChanges(original, [{ ...rows[1], package: '@starci/eslint-canon-fe' }]), /package does not match/);
  assert.throws(() => renderCanonBindingChanges(original, [{ ...rows[0], binding: 'familyCanons.unknown' }]), /expected one unknown field/);
  assert.throws(() => renderCanonBindingChanges(original, [{ ...rows[0], binding: 'familyCanons.bad.path' }]), /supported profile, package and binding path/);
  assert.throws(() => renderCanonBindingChanges(original, [rows[0], rows[0]]), /duplicate binding change/);
  const duplicate = original.replace('    canon:\n', '    canon:\n    canon:\n');
  assert.throws(() => renderCanonBindingChanges(duplicate, [{ ...rows[0], profile: 'nest', package: '@starci/eslint-canon-be' }]), /expected one canon field/);
});

test('missing digest fields and invalid replacement identities refuse', () => {
  const family = original.replace('        contentDigest:', '        absentDigest:');
  assert.throws(() => renderCanonBindingChanges(family, [rows[1]]), /expected one contentDigest field/);
  assert.throws(() => renderCanonBindingChanges(original.replace(`        value: ${'c'.repeat(64)}`, '        absentValue: old'), [rows[1]]), /expected one value field/);
  assert.throws(() => renderCanonBindingChanges(original.replace('        files: 300', '        absentFiles: 300'), [rows[1]]), /expected one files field/);
  assert.throws(() => renderCanonBindingChanges(original.replace('        contentDigest:', '        contentDigest: {}'), [rows[1]]), /expected a block mapping/);
  assert.throws(() => renderCanonBindingChanges(original.replace('        files: 300', '        files: # missing count'), [rows[1]]), /expected a scalar value/);
  for (const to of [{ ...rows[0].to, version: 'latest' }, { ...rows[0].to, version: '01.0.0' }, { ...rows[0].to, value: 'not-a-digest' }, { ...rows[0].to, files: -1 }]) {
    assert.throws(() => renderCanonBindingChanges(original, [{ ...rows[0], to }]), /invalid replacement version or digest/);
  }
});
