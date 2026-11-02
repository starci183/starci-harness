import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { canonJsxCloneNodes } from '../runtime/scripts/hfs/architecture/canon-jsx-clones.mjs';
import { tokenize } from '../runtime/scripts/hfs/architecture/clones.mjs';

const recipe = (source: string, tag = 'Status', loading = 'isLoading={waiting}') => [
  `import { SlotView as ${tag} } from '${source}';`,
  'export const RegionBase = (props: RegionProps) => (',
  `  <${tag}`,
  '    {...props.props.read}',
  '    onRetry={props.on.retry}',
  '    render={(rows, waiting) => (',
  '      <Rows',
  '        rows={rows}',
  `        ${loading}`,
  '        value={(() => {',
  '          const first = rows.length + 1;',
  '          const second = first * 2;',
  '          const third = second - 3;',
  '          const fourth = third + first;',
  '          const fifth = fourth * second;',
  '          const sixth = fifth - third;',
  '          const seventh = sixth + fourth;',
  '          const eighth = seventh * first;',
  '          return eighth + second + third;',
  '        })()}',
  '      />',
  '    )}',
  '  />',
  ')',
].join('\n');

const parsed = (text: string) => ts.createSourceFile('component.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test('R21 canonical SlotView wiring ends clone segments while every render-body decision stays tokenized', () => {
  const file = parsed(recipe('@/components/composites/SlotView'));
  const excluded = canonJsxCloneNodes(ts, file);
  assert.deepEqual([...excluded].map(node => node.getText(file)), ['{...props.props.read}', 'onRetry={props.on.retry}']);
  const tokens = tokenize(ts, file, { excluded });
  assert.ok(new Set(tokens.segments).size > 1);
  for (let line = 11; line <= 19; line += 1) assert.ok([...tokens.lines].includes(line), `render business logic on line ${line} remains compared`);
  assert.ok([...tokens.lines].includes(9), 'the render body loading prop remains compared');
});

test('R21 status-recipe proof rejects foreign owners, missing loading forwarding and local shadowing', () => {
  for (const text of [
    recipe('other-library'),
    recipe('@/components/composites/SlotView', 'Status', 'isLoading={other.waiting}'),
    recipe('@/components/composites/SlotView').replace('export const RegionBase = (props: RegionProps)', 'export const RegionBase = (props: RegionProps, Status: unknown)'),
    recipe('@/components/composites/SlotView').replace('{...props.props.read}', '{...makeRead(props)}'),
  ]) {
    const file = parsed(text);
    assert.equal(canonJsxCloneNodes(ts, file).size, 0);
  }
});

test('R21 namespace imports retain canonical status-owner proof without a special local identifier', () => {
  const text = recipe('@/components/composites/SlotView').replace("import { SlotView as Status }", 'import * as Shared').replace('<Status', '<Shared.SlotView');
  const file = parsed(text);
  assert.equal(canonJsxCloneNodes(ts, file).size, 2);
});
