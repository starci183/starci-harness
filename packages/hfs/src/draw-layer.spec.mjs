import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAW_NESTED_VARIANT, nestedVariantFindings } from '../runtime/scripts/work/draw/draw-layer.mjs';

const field = (variant = 'primary') => `<div data-component="SearchField" data-grammar-variant="${variant}"><input aria-label="Search" /></div>`;
const inside = (attributes, content = field()) => `<section ${attributes}>${content}</section>`;

test('a top-level painted SurfaceCard requires secondary fields', () => {
  const attrs = 'data-component="SurfaceCard" data-grammar-frame="bounded" data-grammar-surface-depth="top"';
  const findings = nestedVariantFindings(inside(attrs));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, DRAW_NESTED_VARIANT);
  assert.equal(findings[0].count, 1);
  assert.deepEqual(nestedVariantFindings(inside(attrs, field('secondary'))), []);
});

test('a nested painted SurfaceCard keeps secondary fields on its border layer', () => {
  const outer = 'data-component="SurfaceCard" data-grammar-surface-depth="top"';
  const nested = 'data-component="SurfaceCard" data-grammar-surface-depth="nested"';
  assert.deepEqual(nestedVariantFindings(inside(outer, inside(nested, field('secondary')))), []);
  const findings = nestedVariantFindings(inside(outer, inside(nested)));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].count, 1);
});

test('Grammar panel and overlay components establish the nested field layer', () => {
  for (const component of ['SurfaceListCard', 'Sidebar', 'Drawer', 'Dialog', 'AlertDialog', 'Popover']) {
    const findings = nestedVariantFindings(inside(`data-grammar-component="${component}"`));
    assert.equal(findings.length, 1, component);
    assert.equal(findings[0].code, DRAW_NESTED_VARIANT);
  }
});

test('Grammar surface stamps establish the layer without a component name', () => {
  for (const stamp of ['data-grammar-nesting="surface"', 'data-grammar-surface-depth="1"', 'data-grammar-overlay-surface="popover"',
    'data-grammar-surface="true"', 'data-grammar-surface-card="true"', 'data-grammar-surface-list="true"',
    'data-grammar-surface-accordion-card="true"']) {
    assert.equal(nestedVariantFindings(inside(stamp)).length, 1, stamp);
    assert.deepEqual(nestedVariantFindings(inside(stamp, field('secondary'))), []);
  }
});

test('raw app and vendor surface paint cannot conceal a primary nested field', () => {
  for (const name of ['bg-surface', 'dark:bg-surface', 'bg-surface-secondary', 'bg-surface/80', 'card', 'surface', 'starci-core-surface']) {
    assert.equal(nestedVariantFindings(inside(`class="${name}"`)).length, 1, name);
  }
  assert.deepEqual(nestedVariantFindings(inside('class="bg-surfaceish"')), []);
});

test('a page field remains primary and unrelated stamps do not create surfaces', () => {
  assert.deepEqual(nestedVariantFindings(field()), []);
  assert.deepEqual(nestedVariantFindings(inside('data-grammar-nesting="page"')), []);
  assert.deepEqual(nestedVariantFindings(inside('data-grammar-frame="frameless"')), []);
  for (const stamp of ['data-grammar-surface', 'data-grammar-surface-card', 'data-grammar-surface-list', 'data-grammar-surface-accordion-card', 'data-grammar-rail']) {
    assert.deepEqual(nestedVariantFindings(inside(`${stamp}="false"`)), [], stamp);
  }
});

test('nested PressableField follows the contextual field variant', () => {
  const pressable = (variant) => `<button data-component="PressableField" data-grammar-variant="${variant}">Choose</button>`;
  const findings = nestedVariantFindings(inside('data-grammar-surface="true"', pressable('primary')));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, DRAW_NESTED_VARIANT);
  assert.deepEqual(nestedVariantFindings(inside('data-grammar-surface="true"', pressable('secondary'))), []);
  assert.deepEqual(nestedVariantFindings(pressable('primary')), []);
});

test('a field composite is counted once and a missing nested variant refuses', () => {
  const content = '<div data-component="SearchField"><div data-component="Input"><input /></div></div>';
  const findings = nestedVariantFindings(inside('data-grammar-nesting="surface"', content));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].count, 1);
});

test('a form in an unpainted Rail on the page is a page form, not a secondary field layer', () => {
  const rail = 'data-component="Rail" data-grammar-rail="true"';
  const form = `<form>${field()}<button type="submit">Save</button></form>`;
  const findings = nestedVariantFindings(inside(rail, form));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'form on the page background');
  assert.deepEqual(nestedVariantFindings(inside(rail)), []);
  assert.deepEqual(nestedVariantFindings(inside('data-component="SurfaceCard"', inside(rail, field('secondary')))), []);
  assert.equal(nestedVariantFindings(inside('data-component="SurfaceCard"', inside(rail)))[0].kind, 'control on a surface not nested');
});

test('an unpainted disclosure container passes the painted parent layer through', () => {
  const disclosure = 'data-component="SurfaceAccordionCard"';
  const shell = 'class="starci-core-surface starci-core-frameless-surface" data-grammar-frame="frameless"';
  assert.deepEqual(nestedVariantFindings(inside(disclosure, inside(shell))), []);
  assert.deepEqual(nestedVariantFindings(inside('data-component="SurfaceCard"', inside(disclosure, inside(shell, field('secondary'))))), []);
  assert.equal(nestedVariantFindings(inside(disclosure, inside('data-grammar-surface="true"'))).length, 1);
});
