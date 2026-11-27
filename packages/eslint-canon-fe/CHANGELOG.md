# Changelog

Versioned history starts at beta; earlier history is in git.

## 9.22.3 - 2026-11-27

- Released (train 2026-11-27): the removal of `no-native-img` (h-dedupe-checks), listed under 9.22.2, landed after 9.22.2 was published (npm's 9.22.2 is commit 3627d3358 and still holds the rule); this version carries it.

## 9.22.2 - 2026-11-25

- Removed (h-dedupe-checks, PROJECT-LINT-7): `no-native-img`, which refused a raw `<img>` a second time beside the Grammar lint's `no-raw-media` (R442) with a conflicting fix; `image-has-size` keeps `FE_NATIVE_IMAGE`.
- Changed (h-coverage-tiers): the renderer-purity rule documentation names the coverage tier and per-file floor (a comment in src/renderer-purity.ts).

## 9.22.1 - 2026-11-25

- Front-end canon lint rules for apps on @starci/hfs.
- served-locale reports an `Accept-Language` header set outside the locale link, the drawing rule names a shape union `XShape`, and every rule has one id.
