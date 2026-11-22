// contexts/ui/content.md CONTENT-2: a next app of fe declares its reader, `audience: business | technical`. A concept the audit's
// tech-leak lens judges against; no check reads the copy, no word list, no words map (owner 2026-11-22: "k muốn render kĩ thuật là nói
// concepts để fe sửa thôi").
import test from 'node:test';
import assert from 'node:assert/strict';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';

const declared = (app: Record<string, unknown>, side: 'fe' | 'be' = 'fe'): string => {
  const be = { apps: [{ name: 'api', kind: 'api', ...(side === 'be' ? app : {}) }] };
  const fe = { apps: [{ name: 'web', kind: 'next', ...(side === 'fe' ? app : {}) }], grammar: 'core' };
  return declarationShapeProblems({ hfs: 3, kind: 'app', project: 'demo', sides: { be, fe } }, ['be', 'fe']).join('; ');
};

test('audience is business or technical on a next app of fe; the words allowlist and words map are gone', () => {
  assert.doesNotMatch(declared({ audience: 'business' }), /audience/);
  assert.doesNotMatch(declared({ audience: 'technical' }), /audience/);
  assert.match(declared({ audience: 'owner' }), /audience is business or technical/);
  assert.match(declared({ audience: 'business' }, 'be'), /next app of fe only/);
  assert.match(declared({ words: { allow: ['NIVO'] } }), /must be \{name, kind\}/, 'no words key: the content layer is a concept, not a list');
});
