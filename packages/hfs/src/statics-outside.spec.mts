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

  test(`${edition}: public holds only the favicon, the logo and the PWA icons`, () => {
    for (const file of ['favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'apple-touch-icon-180x180.png', 'android-chrome-192x192.png', 'mstile-150x150.png', 'safari-pinned-tab.svg', 'icon-512.png', 'icons/maskable.png', 'logo.svg', 'dark-logo.svg', 'brand/os-logo.webp', 'brand/logo.svg', 'mark-logo.png']) assert.equal(isStaticAssetOutside(`fe/apps/web/public/${file}`), false, file);
    for (const file of ['hero.png', 'images/x.webp', 'brand/hero.png', 'logo-dark.png', 'logos.png', 'mylogo.svg', 'brand-logo-big.png', 'brand/sub/logo.svg', 'img/logo.svg', 'banner.mp4']) assert.equal(isStaticAssetOutside(`fe/apps/web/public/${file}`), true, file);
    assert.equal(isStaticAssetOutside('fe/apps/web/src/logo.svg'), true);
  });

  test(`${edition}: only an app root is judged`, () => {
    assert.deepEqual(staticsOutsideFindings({ repo: { kind: 'app', edition }, isRoot: false, all: ['fe/apps/web/public/hero.png'] }), []);
    assert.deepEqual(staticsOutsideFindings({ repo: { kind: 'package' }, isRoot: true, all: ['fe/apps/web/public/hero.png'] }), []);
  });
}
