import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { archFixture, runArch, findings } from './helpers/hfs-arch-fixture.mjs';

// HFS_DUPLICATE_CODE (R21) reads its threshold from the rule parameters of the profile it judges. The app root (profile app) has no
// rule parameters of its own: a run on an app root that has its own tsconfig threw "Cannot destructure property 'lines'" out of
// checkClones. The root now reads the one value its sides share (ruleParams.common.duplicateBlock).

const block = (name: string) => [
  `export function ${name}(input: number): number {`,
  '  const first = input + 1;',
  '  const second = first * 2;',
  '  const third = second - 3;',
  '  const fourth = third + first;',
  '  const fifth = fourth * second;',
  '  const sixth = fifth - third;',
  '  const seventh = sixth + fourth;',
  '  const eighth = seventh * first;',
  '  return eighth + second + third;',
  '}',
  '',
].join('\n');

const rootTsconfig = JSON.stringify({
  compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve', allowJs: true, skipLibCheck: true, noEmit: true, experimentalDecorators: true },
  include: ['be/src/**/*', 'be/apps/**/*'],
});

test('HFS_DUPLICATE_CODE: a run on the app root judges a duplicated block with the threshold of its sides instead of throwing', t => {
  const side = archFixture(t, {
    files: {
      '../tsconfig.json': rootTsconfig,
      'src/modules/domain/a/index.ts': block('alpha'),
      'src/modules/domain/b/index.ts': block('beta'),
    },
  });
  const report = runArch(path.dirname(side));
  const hits = findings(report, 'HFS_DUPLICATE_CODE');
  assert.ok(hits.length > 0, JSON.stringify(report.violations.map(item => item.ruleId)));
  assert.match(hits[0]?.message ?? '', /threshold \d+ lines \/ \d+ tokens/);
});
