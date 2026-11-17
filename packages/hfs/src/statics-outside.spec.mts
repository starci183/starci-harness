// proves: HFS_STATIC_ASSET_OUTSIDE_STATICS@lite
// proves: HFS_STATIC_ASSET_OUTSIDE_STATICS@full
// R439: media beside the code (rules/statics-outside.mts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaticAssetOutside, staticsOutsideFindings } from '../runtime/scripts/hfs/rules/statics-outside.mjs';

for (const edition of ['lite', 'full']) {
  test(`${edition}: HFS_STATIC_ASSET_OUTSIDE_STATICS is a media file under fe public or under src of either side`, () => {
    const all = ['fe/apps/web/public/hero.png', 'fe/apps/web/src/components/logo.svg', 'be/src/modules/mail/banner.jpg', 'statics/art/hero.png', 'fe/apps/web/public/robots.txt'];
    assert.deepEqual(staticsOutsideFindings({ repo: { kind: 'app', edition }, isRoot: true, all }).map((finding) => finding.path), ['fe/apps/web/public/hero.png', 'fe/apps/web/src/components/logo.svg', 'be/src/modules/mail/banner.jpg']);
    assert.deepEqual(staticsOutsideFindings({ repo: { kind: 'app', edition }, isRoot: true, all: ['statics/art/hero.png'] }), []);
  });

  test(`${edition}: route metadata files, favicon.ico and back-end build assets are exempt`, () => {
    for (const file of ['fe/apps/web/src/app/icon.png', 'fe/apps/web/src/app/favicon.ico', 'fe/apps/web/src/app/apple-icon.png', 'fe/apps/web/src/app/opengraph-image.png', 'fe/apps/web/src/app/twitter-image.jpg', 'fe/apps/web/public/favicon.ico', 'be/src/assets/images/logo.png']) assert.equal(isStaticAssetOutside(file), false, file);
    assert.equal(isStaticAssetOutside('fe/apps/web/src/components/icon.png'), true);
  });

  test(`${edition}: only an app root is judged`, () => {
    assert.deepEqual(staticsOutsideFindings({ repo: { kind: 'app', edition }, isRoot: false, all: ['fe/apps/web/public/hero.png'] }), []);
    assert.deepEqual(staticsOutsideFindings({ repo: { kind: 'package' }, isRoot: true, all: ['fe/apps/web/public/hero.png'] }), []);
  });
}
