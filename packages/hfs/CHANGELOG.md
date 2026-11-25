# Changelog

Versioned history starts at beta; earlier history is in git.

## 6.17.13 - 2026-11-25

- Fixed (h-gitattributes-binary, the managed `.gitattributes` of `templates/app/skeleton`): `.starcistacks/** text eol=lf` no longer rewrites a binary file there (a brand reference PNG was corrupted in git); png, jpg, jpeg, gif, webp, avif, ico, woff, woff2, ttf, otf, pdf, zip, gz, tgz, mp4 and webm are `binary` after that rule. Apps pick it up with `starci app sync`.

## 6.17.12 - 2026-11-25

- Added (h-cli-bundle, R397 BE_CLI_CLIENT, `runtime/scripts/hfs/rules/cli.mts`): a client cli may declare `"bundle": true` in hfs.json and ship one self-contained file, so its users install it with no dependency tree: `be/apps/<app>/bundle.mjs` bundles the tsc output of its main into `dist/bundle/<bin>.cjs`, the bin points there, `files` holds `dist/bundle`, `prepack` is `node bundle.mjs` and the manifest lists no runtime dependency. Without the declaration the bin stays `dist/apps/<app>/src/main.js` and a tracked `bundle.mjs` is refused.
- The canon pins name @starci/grammar 0.59.1 and @starci/gallery 0.1.25.
- Added (h-grammar-ext-css, slot `app.gallery-look`, since 6.17.12): `gallery/look.json`, an app's optional declaration of each environment's web and api origin and the seed owner `starci app look` signs in as (the password a custody reference, never a value).
- Changed (h-schedule-cli-client, R268 HFS_SCHEDULE_UNDECLARED): an app of kind `client-cli` runs on the member's machine, so its own timers are its process schedule and R268 does not judge them.
- Added (h-work-prompts, slot `app.starciwork`, `runtime/scripts/hfs/path-findings.mts`): `.starciwork/prompts/**/*.md` holds an app's own authoring prompts, the Markdown its agents read when they write its content and only when a brief names them; HFS_ROOT_ENTRY_FORBIDDEN and HFS_SLOT_UNDECLARED no longer push such a folder out of the app, and the Work readers still leave it out, so the harness never loads it. Anything but Markdown there stays HFS_STARCIWORK_LITE_FORBIDDEN.
- Fixed (t195-grammar-ext, R93 machine `grammar`, `runtime/scripts/hfs/architecture/frontend-grammar.mts`; found by `app check --env prod --level full` on Grammar 0.55): the installed Grammar's optional peers (`optional: true` in `peerDependenciesMeta`: the core ext's `@xyflow/react`, `elkjs`, `d3-force`, `recharts`, `shiki`, ...) no longer count against the selected peers, so Grammar 0.55 no longer reports ARCH_GRAMMAR_CONTRACT_INVALID for every app; the required peers must still equal the selected peers exactly. A style source may import a core-ext stylesheet (`<package>/core/ext/<name>.css`, e.g. `core/ext/graph.css`, `core/ext/markdown.css`) that the installed Grammar declares in `exports`, beside the selected style entry, which must still be imported; any other Grammar CSS path stays ARCH_GRAMMAR_EXPORT_BYPASS. Product source (and so the eslint `grammar-entry` rule, which reports the machine's findings) may import a core-ext code entry (`<package>/core/ext/<name>` or one declared sub-entry, e.g. `core/ext/graph`, `core/ext/markdown/react`) that the installed Grammar exports to a target inside the package; a non-exported ext, a deeper path, an ext stylesheet in TSX, another family's entry and internal files stay refused.

## 6.17.11 - 2026-11-25

- App scaffolding, lint, check, sync, stack, secret and database tooling of the StarCi harness; the canon pins name the Grammar family 0.59.0 and @starci/gallery 0.1.24, and R346 admits the one ChatFrame of a chat pane.
- The canon pins name @starci/common 1.0.2, @starci/seed 0.3.1 (which @starci/hfs requires), @starci/heroicons 0.5.0 and the patch of every other @starci package this train releases.
- The test decrypt of a deploy backup on the manager runs as root, over passwordless sudo where the login has it, else in a one-off read-only container of the database image, so a deploy user with the docker group and no sudo deploys with pending migrations and under the urgent floor.
