// The coverage tiers (owner 2026-11-25, BE-TEST-13, R273): the numbers are the canon gate's, which module is in which tier is the app's
// declaration (hfs.json sides.be.coverageTiers), and the renders (be/jest.config.js, codecov.yml) and the hfs.json shape check read them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageBar, loadSonarGate } from '../runtime/scripts/gates/sonar-gate.mjs';
import { moduleKeyOf, tierComponentId, tierDeclarationProblems, tierOf, tierScopes } from '../runtime/scripts/hfs/coverage-tiers.mjs';
import { jestCoverageSource, renderTargets, tierComponentsYaml } from '../sync/index.mjs';
import type { AppSourceFacts, Presets } from '../sync/index.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';

const bar = coverageBar();

test('the canon gate states every coverage number once: the patch bar, the per-file floor, the tiers, the default tier and the ratchet', () => {
  assert.deepEqual(bar, {
    patch: 80,
    file: 50,
    tiers: { A: { lines: 85, branches: 80 }, B: { lines: 75, branches: 65 }, C: { lines: 60 } },
    defaultTier: 'B',
    business: { lines: 60 },
    project: 'ratchet',
  });
  assert.equal(loadSonarGate().newCode.coverage?.minPercent, bar.patch, 'Sonar new code is the patch bar');
  assert.equal(loadSonarGate().overall.coverage?.minPercent, bar.file, 'Sonar per file is the floor');
});

test('an app declares tiers by module: unknown tiers, malformed entries and a module in two tiers are refused', () => {
  assert.deepEqual(tierDeclarationProblems(undefined), []);
  assert.deepEqual(tierDeclarationProblems({ A: ['domain/billing', 'platform/outbox', 'packages/sdk'], C: ['integrations/*', 'domain/studio*'] }), []);
  assert.match(tierDeclarationProblems(['domain/billing']).join(), /must map a tier/);
  assert.match(tierDeclarationProblems({ D: ['domain/billing'] }).join(), /D is no tier of the canon/);
  assert.match(tierDeclarationProblems({ A: [] }).join(), /non-empty list/);
  assert.match(tierDeclarationProblems({ A: ['src/modules/domain/billing'] }).join(), /<layer>\/<module>/);
  assert.match(tierDeclarationProblems({ A: ['packages/*'] }).join(), /<layer>\/<module>/, 'a package is named, never matched');
  assert.match(tierDeclarationProblems({ A: ['domain/billing'], C: ['domain/billing'] }).join(), /both A and C/);
});

test('a module is in the tier of its most specific entry, a stricter tier on a tie, and in the default tier when no entry names it', () => {
  const declaration = { A: ['domain/billing', 'domain/studio-billing'], B: ['domain/studio*'], C: ['domain/*', 'integrations/*'] };
  assert.equal(tierOf('domain/billing', declaration, bar), 'A', 'an exact entry');
  assert.equal(tierOf('domain/studio-billing', declaration, bar), 'A', 'an exact entry beats a pattern');
  assert.equal(tierOf('domain/studio-forms', declaration, bar), 'B', 'the longer pattern beats the shorter');
  assert.equal(tierOf('domain/leads', declaration, bar), 'C');
  assert.equal(tierOf('platform/schedule', declaration, bar), 'B', 'undeclared: the default tier');
  assert.equal(tierOf('platform/schedule', undefined, bar), 'B');
  assert.equal(tierOf(null, declaration, bar), 'B');
  assert.equal(tierOf('domain/x', { C: ['domain/x*'], A: ['domain/*x'] }, bar), 'A', 'a tie of the same length goes to the stricter tier');
  assert.equal(moduleKeyOf('be/src/modules/domain/billing/billing.service.ts'), 'domain/billing');
  assert.equal(moduleKeyOf('src/modules/platform/outbox/relay/outbox.relay.service.ts'), 'platform/outbox', 'a be-relative path');
  assert.equal(moduleKeyOf('packages/sdk/src/registry.ts'), 'packages/sdk');
  assert.equal(moduleKeyOf('be/src/modules/domain/index.ts'), null);
});

test('the tiers of an app scope group its modules, each tier with the globs of its modules', () => {
  const scopes = tierScopes({
    roots: ['src/modules/domain/*/', 'src/modules/integrations/*/', 'src/modules/platform/*/'],
    files: ['src/modules/domain/billing/billing.service.ts', 'src/modules/domain/leads/leads.service.ts', 'src/modules/integrations/stripe/stripe.client.ts', 'src/modules/platform/outbox/outbox.service.ts', 'apps/api/src/main.ts'],
    packageFolders: ['packages/sdk'],
    declaration: { A: ['domain/billing', 'platform/outbox'], C: ['integrations/*'] },
    bar,
  });
  assert.deepEqual(scopes.map((scope) => [scope.tier, scope.modules, scope.paths]), [
    ['A', ['domain/billing', 'platform/outbox'], ['be/src/modules/domain/billing/**', 'be/src/modules/platform/outbox/**']],
    ['B', ['domain/leads', 'packages/sdk'], ['be/src/modules/domain/leads/**', 'packages/sdk/src/**']],
    ['C', ['integrations/stripe'], ['be/src/modules/integrations/stripe/**']],
  ]);
  const yaml = parseYaml(`individual_components:\n${tierComponentsYaml(scopes, bar.patch)}\n`);
  assert.deepEqual(yaml.individual_components.map((component: { component_id: string; statuses: { type: string; target: string }[] }) => [component.component_id, component.statuses.map((status) => `${status.type} ${status.target}`)]), [
    ['tier-a', ['project 85%', 'patch 80%']],
    ['tier-b', ['project 75%', 'patch 80%']],
    ['tier-c', ['project 60%', 'patch 80%']],
  ]);
  assert.equal(tierComponentId('A'), 'tier-a');
});

test('the rendered be/jest.config.js holds every measured file to the canon per-file floor on the four metrics', () => {
  const source = jestCoverageSource({ roots: ['src/modules/domain/*/'], roles: ['service'], files: [], excludes: [] });
  assert.match(source, /perFile: \{ lines: 50, branches: 50, functions: 50, statements: 50 \},/);
  assert.doesNotMatch(source, /100/);
});

test('the rendered codecov.yml takes the modules of the app declaration into their tier components', () => {
  const hfs = { hfs: 3, kind: 'app', project: 'tiers-proof', sides: {
    be: { apps: [{ name: 'api', kind: 'api' }], coverageTiers: { A: ['domain/billing'], C: ['platform/*'] } },
    fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] },
  } };
  const source = { files: ['apps/api/src/api.module.ts', 'src/modules/domain/billing/billing.service.ts', 'src/modules/domain/leads/leads.service.ts', 'src/modules/platform/clock/clock.service.ts'], read: () => '' };
  // reason: only the files/read facts the Codecov scope reads, and no Sonar presets.
  const target = renderTargets(hfs, {} as unknown as Presets, { source: source as unknown as AppSourceFacts }).find((item) => item.path === 'codecov.yml');
  assert.ok(target);
  assert.doesNotMatch(target.content, /target: 100%/);
  const config = parseYaml(target.content);
  const tiers = config.component_management.individual_components.filter((component: { component_id: string }) => component.component_id.startsWith('tier-'));
  assert.deepEqual(tiers.map((component: { component_id: string; paths: string[] }) => [component.component_id, component.paths]), [
    ['tier-a', ['be/src/modules/domain/billing/**']],
    ['tier-b', ['be/src/modules/domain/leads/**']],
    ['tier-c', ['be/src/modules/platform/clock/**']],
  ]);
  assert.equal(config.coverage.status.project.default.target, 'auto');
  assert.equal(config.coverage.status.patch.default.target, '80%');
});
