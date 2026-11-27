// proves: UI_AUDIT_MISSING
// The gallery's tracker codes (owner 2026-11-27: the UI audit is a local UX/UI helper and never a gate): info and report-only in `--env local`, left out of `--env prod`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { trackedForEnv, trackerCodes } from '../runtime/scripts/hfs/check-env.mjs';

test('the catalog marks the missing audit, the missing screen.yaml and the missing shots as tracker codes, and no concept rule', () => {
  const codes = trackerCodes();
  for (const code of ['UI_AUDIT_MISSING', 'UI_AUDIT_STALE', 'UI_AUDIT_SELF_REVIEW', 'UI_AUDIT_ROUNDS_FEW', 'UI_AUDIT_OPEN', 'UI_AUDIT_NEEDS_OWNER', 'UI_AUDIT_CONSIDERED_EMPTY', 'HFS_APP_GALLERY_ROUTE_MISSING', 'HFS_APP_GALLERY_DESIGN_PAGE_MISSING', 'HFS_APP_GALLERY_DESIGN_SHOT_MISSING']) {
    assert.ok(codes.has(code), code);
  }
  for (const code of ['HFS_APP_GALLERY_SCREEN_INVALID', 'HFS_APP_GALLERY_DESIGN_MANIFEST', 'FE_I18N_LOCALE_MISSING']) assert.ok(!codes.has(code), `${code} still blocks`);
});

test('local lists a tracker finding as info, report-only; prod leaves it out; every other finding is unchanged', () => {
  const findings = [
    { code: 'UI_AUDIT_MISSING', level: 'error', local: true },
    { code: 'HFS_APP_GALLERY_ROUTE_MISSING', level: 'error', local: true },
    { code: 'HFS_APP_GALLERY_SCREEN_INVALID', level: 'error' },
  ];
  assert.deepEqual(trackedForEnv(findings, 'local'), [
    { code: 'UI_AUDIT_MISSING', level: 'info', local: true, report: true },
    { code: 'HFS_APP_GALLERY_ROUTE_MISSING', level: 'info', local: true, report: true },
    { code: 'HFS_APP_GALLERY_SCREEN_INVALID', level: 'error' },
  ]);
  assert.deepEqual(trackedForEnv(findings, 'prod'), [{ code: 'HFS_APP_GALLERY_SCREEN_INVALID', level: 'error' }]);
});
