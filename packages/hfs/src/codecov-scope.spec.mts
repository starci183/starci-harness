import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTargets } from '../sync/index.mjs';
import type { AppSourceFacts, Presets } from '../sync/index.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { globExpression } from '../runtime/scripts/lib/glob.mjs';

const covered = 'be/src/modules/domain/orders/orders.service.ts';
const uncovered = 'be/src/modules/domain/orders/policies/payment.policy.ts';
const platformCovered = 'be/src/modules/platform/clock/clock.service.ts';
const platformUncovered = 'be/src/modules/platform/clock/deadline.policy.ts';
// A logic file its slot declares (`logic` of be.integrations.passport) is measured like a logic-role file.
const declaredLogic = 'be/src/modules/integrations/passport/passport.tokens.ts';
const measured = [covered, uncovered, platformCovered, platformUncovered, declaredLogic];
// A shard reports every loaded import, including files outside the slot-derived logic scope.
const report = [
  { path: covered, lines: 4, hits: 4 },
  { path: uncovered, lines: 2, hits: 0 },
  { path: platformCovered, lines: 3, hits: 3 },
  { path: platformUncovered, lines: 3, hits: 0 },
  { path: 'be/src/modules/domain/orders/orders.config.ts', lines: 100, hits: 1 },
  { path: 'be/src/modules/domain/orders/orders.module.ts', lines: 20, hits: 5 },
  { path: 'be/src/modules/domain/orders/persistence/order.rows.ts', lines: 50, hits: 0 },
  { path: 'be/src/modules/domain/orders/persistence/hydrate.service.ts', lines: 5, hits: 0 },
  { path: 'be/src/modules/platform/clock/clock.config.ts', lines: 10, hits: 1 },
  { path: declaredLogic, lines: 10, hits: 1 },
  { path: 'fe/apps/web/src/app/page.tsx', lines: 10, hits: 0 },
];

interface Rec { path: string; lines: number; hits: number }
interface Rule { target: string; threshold: string }
const matches = (patterns: string[], file: string) => patterns.some((pattern: string) => globExpression(pattern).test(file));
const selected = (config: { ignore: string[] }, paths: string[], records: Rec[]) => records.filter(record => matches(paths, record.path) && !matches(config.ignore, record.path));
const reachesTarget = (records: Rec[], status: Rule) => {
  const lines = records.reduce((total: number, record: Rec) => total + record.lines, 0);
  const hits = records.reduce((total: number, record: Rec) => total + record.hits, 0);
  assert.ok(lines > 0, 'a status keeps its measured files');
  return 100 * hits / lines >= Number.parseFloat(status.target);
};

for (const edition of ['full', 'lite']) {
  test(`${edition} rendered Codecov scope keeps uncovered logic and ignores incidental imports`, () => {
    const hfs = { hfs: 3, kind: 'app', edition, project: 'codecov-scope-proof', sides: {
      be: { apps: [{ name: 'api', kind: 'api' }], connections: [
        { name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'api', isolation: 'schema', provider: 'postgres' },
      ] },
      fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }], reads: ['be/contracts/'] },
    } };
    const source = {
      files: ['apps/api/src/api.module.ts', ...report.filter(record => record.path.startsWith('be/')).map(record => record.path.slice(3))],
      read: (file: string) => file === 'apps/api/src/api.module.ts' ? "import { OrdersModule } from '@modules/domain/orders';" : '',
    };
    // reason: the spec feeds renderTargets no Sonar presets and only the files/read fields of the source facts, the two it reads for the Codecov scope.
    const target = renderTargets(hfs, {} as unknown as Presets, { source: source as unknown as AppSourceFacts }).find(item => item.path === 'codecov.yml');
    assert.ok(target, 'the managed Codecov configuration is rendered');
    const config = parseYaml(target.content);
    const project = config.coverage.status.project.default;
    const retained = selected(config, project.paths, report).map((record: Rec) => record.path);
    assert.deepEqual(retained, measured, 'the provider denominator is exactly the measured logic, including uncovered files');
    const allCovered = report.map(record => measured.includes(record.path) ? { ...record, hits: record.lines } : record);
    const statuses = [
      ...Object.values(config.coverage.status as Record<string, { default: Rule & { paths: string[] } }>).map((status) => ({ paths: status.default.paths, rule: status.default })),
      ...config.component_management.individual_components.flatMap((component: { paths: string[] }) =>
        config.component_management.default_rules.statuses.map((rule: Rule) => ({ paths: component.paths, rule }))),
    ];
    assert.deepEqual(config.component_management.individual_components.map((component: { component_id: string }) => component.component_id), ['api', 'platform']);
    for (const { paths, rule } of statuses) {
      assert.equal(String(rule.target), '100%');
      assert.equal(String(rule.threshold), '0%');
      assert.equal(reachesTarget(selected(config, paths, report), rule), false, 'uncovered measured logic still fails project, patch and component gates');
      assert.equal(reachesTarget(selected(config, paths, allCovered), rule), true, 'partial incidental imports do not lower the measured coverage');
    }
  });
}
