// proves: HFS_APP_GALLERY_DESIGN_PENDING
// proves: HFS_APP_GALLERY_DESIGN_PENDING
// A screen design.json marks `pending: { reason }` (not buildable yet: it waits on data or an API) is skipped by the UI Audit, and a pending screen with no reason is refused (rules/gallery-design.mts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesign } from '../runtime/scripts/hfs/rules/gallery-design.mjs';

const BOARD = 'https://claude.ai/artifact/0123abcd';
const OLD = '2026-11-11T09:00:00+07:00';
const entry = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ status: 'approved', approvedAt: OLD, board: BOARD, ...extra });
const manifest = (pages: Record<string, unknown>): string => `${JSON.stringify({ areas: ['premium'], pages }, null, 2)}\n`;

test('a pending screen with an empty or missing reason is refused, and a built page cannot be pending', () => {
  for (const pending of [{ reason: '' }, { reason: '   ' }, {}, 'later', { reason: 'x', extra: 1 }]) {
    const { manifest: parsed, problems } = parseDesign(manifest({ 'premium/qr-payment': entry({ pending }) }));
    assert.equal(parsed, null, JSON.stringify(pending));
    assert.match(problems.join(' '), /pending/u);
  }
  assert.match(parseDesign(manifest({ 'premium/qr-payment': entry({ status: 'built', shots: {}, pending: { reason: 'x' } }) })).problems.join(' '), /built and still pending/u);
  assert.notEqual(parseDesign(manifest({ 'premium/qr-payment': entry({ pending: { reason: 'waits on data' } }) })).manifest, null);
});
