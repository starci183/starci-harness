# Changelog

## 9.16.16 - 2026-11-12

- Changed: the hfs 6.8 line (`@starci/hfs` 6.8.5) merged with `pkg/canon-fe-status-view-types`, `pkg/claude-work-concepts` and `pkg/claude-grammar-meter-foreground-fill`, so one installable set carries all of them: 9.16.12-9.16.14 (`no-view-data-status`, the `todo-tag` fix of R235) join the 6.8 line; peer `@starci/hfs ~6.8.0`.

## 9.16.15 - 2026-11-11

- Changed: peer `@starci/hfs ~6.8.0`; no lint rule of this package changed.

## 9.16.14 - 2026-11-11

- Fixed (R235): `starci-fe/todo-tag` (S1135) replaces `sonarjs/todo-tag` in the Sonar way block. The sonarjs port reads a lower-case `todo` after a dot as the start of a sentence, so a comment naming the catalog key `guide.todo` was refused as a leftover marker. The canon rule refuses a marker only: the upper-case word `TODO` standing alone (`TODO`, `TODO:`, `TODO(name)`), or the word in any case written into a tag (`todo:`, `todo(`), with no letter, digit, underscore or dot on its left; a marker followed by an issue key (`TODO PROJ-12`) passes. The noun in prose (`a todo can be`, `the todo list`) and a name (`guide.todo`, `GuideTodoKey`, `todoCount`) are no marker. `fixme-tag` (S1134) is unchanged.

## 9.16.13 - 2026-11-11

- Added (R92, FE-ERROR-1): `starci-fe/no-view-data-status` refuses a read status written as a string union on a view type. In `modules/types/**` and the hooks (slots `fe.modules.types` and the hooks tier), a property named `state`, `status` or `shape` whose type is a string-literal union (inline, or an alias of the same file) that lists `loading`, or at least two distinct words of `failed`, `error`, `errored`, `empty`, `forbidden`, is reported: a region's status is a `DataSlot<T>` drawn through `SlotView`. A domain status (`"pending" | "paid" | "failed"`, `"active" | "retired"`) names no `loading` and one ambiguous word, so it passes. `no-data-status-shape` is unchanged: it still judges `XShape` / `XState` of a pure half.

## 9.16.12 - 2026-11-09

- Changed: peer `@starci/hfs ~6.7.0` (hfs 6.7.0: the per-screen gallery and its explain.md gates, R395); no lint rule of this package changed.

## 9.16.11 - 2026-11-09

- Changed: peer `@starci/hfs ~6.6.0` (hfs 6.6.0: R395 and the managed app gallery slots); no lint rule changed.

## 9.16.10 - 2026-11-09

- Changed: peers `@starci/hfs ~6.5.0` (hfs 6.5.0: `starci app add connection`, the full-app inbox of `app add webhook`, `slot:` owners of the infra table); no lint rule changed.

## 9.16.9 - 2026-11-09

- Changed: peers `@starci/hfs ~6.4.0` (hfs 6.4.0: `local.basePort` and R389, the full-app Redis of `app add queue|job`, the github-oidc owner of auth-oidc); no lint rule changed.

## 9.16.8 - 2026-11-08

- Changed: peers `@starci/hfs ~6.3.0`; the package contract of a root package declares its `outcome` only (the `errorBase` key is gone).

## 9.16.7 - 2026-11-08

- Fixed: the test-scope Sonar way block (the app config and the plain-source config) selects the specs with positive selectors (`SPEC_FILES`, `apps/*/src/**/*.{spec,e2e-spec}.{ts,tsx}` and the package twin) instead of `ignores: ['**/*', '!**/*.spec...']`. The harness lint scope (`canonScope` of `@starci/hfs`) refuses a negated selector, so every app's `starci app check --gate lint` ended in `ESLint tool error: eslint source scope is unavailable ... unsupported canon ignores selectors` and linted nothing. The block selects the same files as before and carries the name `starci-fe/sonar-way-tests`, by which `scopeToPackages` narrows it to the specs of the package subpaths.

## 9.16.6 - 2026-11-08

- Added (R235 `SCAN_SMELL`, the first Sonar way scan of a real app against local lint): the lint now reports what the server reported. `starci-fe/no-duplicate-import` (S3863, fixable) replaces the core `no-duplicate-imports` that spared a separate type import: a value and a type from one module are one `import { value, type Type }`, and `--fix` merges them. `starci-fe/no-nested-conditional` (S3358) now follows the server: a conditional inside a branch, a test, a call argument, a template or a cast is nested, and only an array, object, function or JSX expression starts a new reading. `starci-fe/prefer-string-raw` (S7780) also refuses a `String.raw` template that holds no backslash (fixable). `starci-fe/no-bidirectional-character` (text:S6389) refuses a raw bidirectional control character in any file. Front end: `no-useless-fragment` (S6749, fixable when the one child is an element), `no-nested-component` (S6478), `no-children-prop` (S6748; its message says a connected block passes the slot under another prop name to the pure component, FE_CONNECTED_BLOCK_RENDER_PAIR and FE_WORLD_OWNER_RENDER_BOUNDARY), `use-state-destructured` (S6754), `prefer-tag-over-role` (S6819).
- Added: the Sonar way block maps S7739 `unicorn/no-thenable`, S7746 `unicorn/no-useless-promise-resolve-reject` (fixable), S6606 `@typescript-eslint/prefer-nullish-coalescing`, S7781 `unicorn/prefer-string-replace-all` (fixable), S7718 `unicorn/catch-error-name` (fixable), S7727 `unicorn/no-array-callback-reference`, S6671 `prefer-promise-reject-errors`, S6325 `prefer-regex-literals`, S1186 `@typescript-eslint/no-empty-function`, S878 `no-sequences`, S6535 `no-useless-escape`, S7753 `unicorn/prefer-array-index-of` (fixable), S7737 `unicorn/no-object-as-default-parameter`, S7755 `unicorn/prefer-at` (fixable), S7787 `unicorn/require-module-specifiers`, S7766 `unicorn/prefer-math-min-max` (fixable), S6661 `prefer-object-spread` (fixable) and S4123 `@typescript-eslint/await-thenable`, all at error. A catch parameter is `error` (`error_` where `error` is already declared in scope; `cause` stays allowed, the scan accepts it and a back end's wrapped failures are named so).
- Added: the specs of the product source run the test-scoped Sonar way rules (the sonarjs rules whose Sonar scope is Tests, among them S5906, S8754 and S9073) in a fourth block, because the scan reads `sonar.tests` with them; the product source block still leaves the specs out.

## 9.16.5 - 2026-11-08

- Fixed: the `@starci/hfs` peer is `~6.2.0`, the range of the hfs the canon pins name, so an app on hfs 6.2 installs with `npm ci`.

## 9.16.4 - 2026-11-07

- Fixed: the `@starci/hfs` peer is `~6.1.0` (it was `~6.0.0`), the range of the hfs the canon pins name, so an app on hfs 6.1 installs with `npm ci`.

## 9.16.3 - 2026-11-07

- Added (R235 `SCAN_SMELL`, `no-line-separator-literal`, slot-free): a raw U+2028, U+2029 or U+0085 anywhere in a file, specs included, is an error that names the escape to write (` `, ` `, ``) in a string, template or regular expression, or says to delete the character elsewhere. The Sonar scanner splits lines at these characters and TypeScript does not, so its analysis aborts with "Line n is out of range ... File has m lines".

## 9.16.2 - 2026-11-07

- A patch: peers `@starci/hfs` ~6.0.0. Comments, rule docs and messages cite rules by their ids and carry no ruling history; the counting cohort entries carry no ruling field.

## 9.16.1 - 2026-11-07

- A patch: `starci-fe/control-height` no longer names `SegmentedControl` (removed from `@starci/grammar` 0.24.0); the controls it holds to the one 40px height are Button, IconButton, Switch, Input, SearchField, Select, Tabs, Textarea, NumberField and ComboBox. Its docs follow.

## 9.16.0 - 2026-11-06

- Added: `starci-fe/renderer-presentation-only` (R384, `FE_RENDERER_LOGIC`, RENDERER-PURITY-1) at error: in a client renderer of a root workspace package (`packages/<pkg>/src/client/**/*.tsx`) data computation (arithmetic between two data values, `+=` accumulation), aggregation (`reduce`, a chain of `filter`/`sort`/`flatMap`, `Math.max/min(...spread)`), date math (`Date.now()`/`getTime()` arithmetic, Date setters, date-fns add/sub/diff/compare/round), a relational comparison of two data values and a mutation outside a declared action (a write to a prop or an outer value, an in-place array mutator on data, `fetch`, storage, a beacon) are refused; they belong in a measured `.ts` module the renderer calls. Mapping, display filters, ternaries that pick a view, comparisons and arithmetic with a literal and `handle.run(...)` stay allowed. A front-end package (`fe/packages/*`) is not judged by it.

## 9.15.1 - 2026-11-05

- Fixed (FE-PACKAGES-2): the package config (`starciFePackagesConfig` and `scopeToPackages`, which the Grammar family's `...PackagesConfig` reads) covered only `packages/*/src/workbench/**` and `src/public/**`, and the back-end package config takes no `.tsx`, so a `.tsx` file anywhere else in a root package (a `src/client/` renderer of a block library) matched no config and was never linted. `PACKAGE_SOURCE_FILES` now also lists `packages/*/src/**/*.tsx`: every React file of a package source gets the front-end canon and the Grammar family rules, as the files of `fe/packages` do. The workbench contract stays back end; a plain `.ts` file outside the two subpaths stays the back-end canon's.

## 9.15.0 - 2026-11-05

- Changed: the canon reads the @starci/hfs runtime from the installed hfs at run time, which it peers by `~5.13.0`, and bundles no copy; `runtime/` keeps only the project graph rule, the jsdoc, sonar and next helpers and the package-scripts template, and the stale forks (slots 3.13.0) are gone.

## 9.14.4 - 2026-11-05

- Changed: the runtime copy of the canon pins gives the Grammar family its same-minor range and names `@starci/hfs` 5.12.0 and the Grammar family 0.22.0.

## 9.14.3 - 2026-11-05

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.11.3 and the Grammar family 0.21.38.

## 9.14.2 - 2026-11-05

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.11.2 and the Grammar family 0.21.37.

## 9.14.1 - 2026-11-05

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.11.1 and the Grammar family 0.21.36.

## 9.14.0 - 2026-11-05

- Added (PROJECT-LINT-3): `starciFeConfig` loads the ESLint rules of the app's rule packs (hfs.json `rulePacks`) for the fe side, one plugin per pack, each rule at its severity; a refused pack throws `HFS_RULE_PACK_INVALID`. The runtime copies carry `scripts/lib/rule-packs.mjs`, the `rulePacks` key of the declaration check and the canon pins of `@starci/hfs` 5.11.0.

## 9.13.16 - 2026-11-05

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.10.4 and the Grammar family 0.21.34.

## 9.13.15 - 2026-11-05

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.10.3 and the Grammar family 0.21.33.

## 9.13.14 - 2026-11-05

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.10.2 and the Grammar family 0.21.32.

## 9.13.13 - 2026-11-05

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.10.1 and the Grammar family 0.21.31.

## 9.13.12 - 2026-11-04

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.10.0.

## 9.13.11 - 2026-11-04

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.9.1.

## 9.13.10 - 2026-11-04

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.9.0.

## 9.13.9 - 2026-11-04

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.8.3.

## 9.13.8 - 2026-11-04

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.8.2.

## 9.13.7 - 2026-11-04

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.8.1.

## 9.13.6 - 2026-11-04

- Changed: the runtime copies carry the module shape of `be.integrations.passport` in the package slot manifest and the canon pins of `@starci/hfs` 5.8.0.

## 9.13.5 - 2026-11-04

- Changed: the runtime copy of the canon pins names `@starci/hfs` 5.7.1 and the release-7a versions.

## 9.13.4 - 2026-11-04

- Changed: the runtime copy of the canon pins names the release-6 versions.

## 9.13.3 - 2026-11-04

- Changed: the runtime copies carry `engine/runtime-root.mjs`, which moves an installed copy's legacy state with its owner and mode (`@starci/hfs` 5.6.1), and the release-5 canon pins.

## 9.13.2 - 2026-11-04

- Changed: the runtime copies carry `engine/runtime-root.mjs` with the per-user state base of an installed copy (`@starci/hfs` 5.6.0) and the canon pins of release 4 (`@starci/auth` 0.4.0, `@starci/auth-oidc` 0.1.3).

## 9.13.1 - 2026-11-04

- Changed: the runtime copy of the canon pins names the release-3 versions (`@starci/hfs` 5.5.1, `@starci/jest-preset` 2.7.1, `@starci/eslint-canon-be` 3.15.1, the Grammar family 0.21.18).

## 9.13.0 - 2026-11-03

- Changed: `one-outcome-union` accepts in a root workspace package only the result union its `package.json` names (`starci.outcome: { name, file }`); every other result union stays refused. Specs: `src/packages-config.spec.ts`.
- Changed: the runtime copies carry the root-packages view, the `modules` declaration and the canon pins of this release (no release-age wording).
- Changed: the package's slot manifest places any root workspace package `packages/<name>/` in `app.packages` (a block library such as `packages/blocks-core` beside the agent SDK and the module packages), so the root packages config lints it.

## 9.12.1 - 2026-11-03

- Changed: the runtime copies carry the canon pins of `@starci/auth` 0.2.1, `@starci/auth-oidc` 0.1.1, the Grammar family 0.21.16 and `@starci/hfs` 5.4.0.

## 9.12.0 - 2026-11-03

- Changed: the runtime copies carry R368's acceptance of the module-definition helpers, the module-per-transport confinement of the helpers and the `@starci/nest-kit` and `@starci/next-i18n` pins; `i18n-stack-in-one-module` refuses every product-source call of a next-intl layer builder (the stack is `@starci/next-i18n`'s).
- Added: `starciFePackagesConfig`, `loadPackagesHfs` and `scopeToPackages`: the rules of the front end over `packages/<pkg>/src/workbench/**` and `src/public/**` of the root workspace packages, over the package view of the app root, for the managed root `eslint.config.mjs`; the workbench contract stays with the back-end canon and the project-graph rules with the side folders.
- Changed: the runtime copy of the slot manifest carries the slots `app.packages`, `app.module-registry` and `app.packages-lint`.

## 9.11.0 - 2026-11-03

- Changed: `modules/auth` holds the front-end transport rules like `modules/api`: no auth door file takes axios or `fetch`, and no file keeps module-level mutable state (the access token lives in the `@starci/auth` client); the stack concern `auth` names `@starci/auth`.

## 9.10.0

- Added: `starci-fe/directive-first` (R369, `FE_DIRECTIVE_FIRST`) at error: a `"use client"` or `"use server"` directive is the first statement of its module; below an import it does nothing and `next build` refuses the file.
- Added: `starci-fe/explicit-export-surface` (R368, `HFS_EXPLICIT_EXPORT_SURFACE`) at error: an exported function's return type, an exported variable's type and a parameter's type are written, not inferred from a body or from other files; a component that returns only JSX, `null` or `undefined` is explicit. It reports each export the isolated declaration emit cannot write, at the offending span, and says what to annotate. It reads the classifier the lint result cache reads.
- Added: `projectGraphSnapshot`, the findings of the project graph the process has already built, which the ESLint child hands to the cache; `projectGraph` stays the fresh build.
- Changed: carry the bundled runtime of @starci/hfs 5.1.0 (the classifier, the rule factory, the rule catalog with R368, the canon pins).
- Fixed: `no-swr-default-array` (R367) judges a `?? []` inside a `useMemo` callback or a `slotOfReads` projector by the hook that holds it, so a slot carrying the read's status is no longer reported.

## 9.9.12

- Changed: Carry the bundled runtime of @starci/hfs 5.0.8 (the rule texts name `app check`, the read-set helper of the rule memo) and its canon pins; the comments name `app check` for the removed lint verb.

## 9.9.11

- Changed: Recognize declared module hook roles through real hook-call provenance.

## 9.9.10

- Changed: Refresh shared repository identity and release-aligned canon data.

- Fixed: Preserve generated-contract provenance in front-end tier and bounds checks.

## 9.9.9

- Changed: Preserve mounted RootPage children through selected native body layouts only when their metadata constraints, immutable props and required context are proven. Retain exact body and import identity, and refresh the generated canon pins.

## 9.9.8

- Changed: Enforce the documented one-level connected RootPage children composition with mounted selected-export and actual sibling-Base proof shared with R325. Keep ordinary block/atom restrictions and inspect shape records for rendered trees.
- Fixed: Virtual RuleTester files refuse the RootPage children capability before disk parsing; unsaved content keeps the on-disk source identity guard.

## 9.9.7

- Changed: Bundled canon pins name the builder-provenance BE canon release and its coherent dependency cohort. This package changes no runtime behavior or rule severity.

## 9.9.6

- Changed: Align bundled canon pins and exact sibling requirements with Grammar and its lint families at 0.21.6. Runtime behavior and rule severity are unchanged.

## Unreleased

## 9.9.5 - 2026-11-02

- Changed: synchronized the canonical function-provenance runtime and HFS 5.0.1 cohort pins; the Grammar component runtime stays at 0.21.3.

## 9.9.4 - 2026-11-02

- Changed: refreshed bundled canonical pins for the HFS 5.0.0 project quality-gate cohort; the Grammar component runtime stays at 0.21.3.

## 9.9.3 - 2026-11-02

- Changed: bundled canonical pins follow the consolidated Grammar 0.21.3 preservation API cohort; runtime rules are unchanged.

## 9.9.2 - 2026-11-02

- Changed: bundled pins follow Grammar 0.21.2 with disabled tab items and its coherent canon cohort; existing runtime checks are unchanged.

## 9.9.1 - 2026-11-02

- Fixed: Nest injection unit contracts accept an absent provider only when the constructor binding carries the real `@nestjs/common` `Optional()` decorator; bundled cross-file surface checks match the semantic peer-card grid owner. Updated the coherent Grammar and canon pins.

## 9.9.0 - 2026-11-02

- Added: `no-hand-skeleton` is published (R367) and requested at error: an app draws no `Skeleton`, `ChatBubbleSkeletons` or `MessageBubbleSkeletons`, because the Grammar components draw their loading structure from `isLoading`. Changed: `no-data-status-prop` lets a leaf, branch or composite take `isLoading` (the one flag below SlotView) and refuses `isError`, `isForbidden`, `isEmpty`, `isValidating`; `slotOfReads` counts as a slot builder.

- Removed: `NavigationFeatureNav` from the surface names and the bundled Core playbook (the component is gone; `TopBar` takes `subnavigation`).
- Added: `tier-children` (R92): only a unit of `components/frames` takes `children`; a leaf takes `children: string`; a block, a composite and a branch take none (`children?: never`) and `PropsWithChildren` is refused there.
- Added: `no-swr-default-array`, `no-foreign-slot-status`, `no-validating-as-loading`, `no-placeholder-object` (R367; `FE_SWR_DEFAULT_ARRAY`, `FE_FOREIGN_SLOT_STATUS`, `FE_VALIDATING_AS_LOADING`, `FE_PLACEHOLDER_OBJECT`): a loading state is drawn from the page's own reads. `no-hand-skeleton` is written and tested but not published until the Grammar owns the loading shape.
- Removed: `button-no-variant` and `nested-control-variant` (the `variant` prop is out of the Grammar types, so the props they refused cannot be written).

- Changed: `no-heading-above-card` (R354) follows the removal of `SectionHeader`: it refuses a `Section` (not `kind="list"`) whose only child is one card, and a card whose `ariaLabel` repeats the `Section` title. `no-hand-built-panes` reads a `Section` as a column where it read `Region`, and `no-commit-in-collection-item` no longer names the removed `CollectionItem`, `ItemActions` and `ListItem`.

- eslint-canon-fe: the surface rules follow the one card (SurfaceListCard and SurfaceAccordionCard are gone).
- Added: `frames` joins the component tiers (`components/frames/<Name>`, `meta.shape = 'frame'`); a frame is a lower tier for the world check (it owns no data, session or navigation).

## 9.8.5 - 2026-11-01

- Added: `no-heading-above-card` (R354, `FE_HEADING_ABOVE_CARD`): a `SectionHeader` directly above a single card, or a card whose `ariaLabel` repeats the header title, is refused; several cards under one header stay legal.
- Added: `no-selectable-tag-group` (R353, `FE_TAG_GROUP_SELECTION`): a selection prop on a Grammar `TagGroup` is refused; a filter is a `FilterButtonGroup`.
- Added: `no-fill-command-in-header` (R352, `FE_COMMAND_FILLS_HEADER`): a Grammar `Button` with `width="fill"` in the `actions` of a `PageHeader` or the `labelEnd` of a `SurfaceCard` or `SurfaceListCard` is refused (a page or pane command hugs its label).
- Added: `no-table-in-card` (R351, `FE_TABLE_IN_CARD`): a Grammar `DataTable` enclosed by a `SurfaceCard`, or rendered by a component of the same file that a `SurfaceCard` encloses, is refused; plain rows are a `SurfaceListCard` with the note in its `footer`. It is a slot-free surface law at error, with no inline exemption.
- Changed: the bundled canon pins name @starci/grammar 0.20.2, eslint-grammar-core and eslint-grammar-offset-pop 0.20.2, eslint-canon-be 3.11.6, eslint-canon-fe 9.8.5, stylelint-canon 2.4.0 and hfs 4.16.5 (RELEASE_VERSION_NOT_BUMPED: the previous versions are on npm). One rule law changes (above).

## 9.8.4 - 2026-11-01

- Changed: the bundled canon pins name @starci/grammar 0.20.1, eslint-grammar-core and eslint-grammar-offset-pop 0.20.1, eslint-canon-be 3.11.5, eslint-canon-fe 9.8.4, stylelint-canon 2.4.0 and hfs 4.16.4 (RELEASE_VERSION_NOT_BUMPED: the previous versions are on npm). No rule changes.

## 9.8.3 - 2026-11-01

- Changed: the bundled canon pins name @starci/grammar 0.20.0, eslint-grammar-core and eslint-grammar-offset-pop 0.20.0, eslint-canon-be 3.11.4, eslint-canon-fe 9.8.3, stylelint-canon 2.4.0 and hfs 4.16.3 (RELEASE_VERSION_NOT_BUMPED: 9.8.2 is on npm).

## 9.8.2 - 2026-11-01

- Changed: the bundled canon pins name @starci/grammar 0.19.1, eslint-grammar-core and eslint-grammar-offset-pop 0.19.1, eslint-canon-be 3.11.3, eslint-canon-fe 9.8.2, stylelint-canon 2.4.0 and hfs 4.16.2 (RELEASE_VERSION_NOT_BUMPED: the previous versions are on npm).
- Changed: the bundled hfs `database-migrations` follows hfs 4.16.2 (an alter of a column the migration added is not destructive; an entity names its table by its decorator).

## 9.8.1 - 2026-10-31

- Changed: the bundled canon pins name @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.19.0, eslint-canon-be 3.11.2, eslint-canon-fe 9.8.1, stylelint-canon 2.4.0 and hfs 4.16.1 (RELEASE_VERSION_NOT_BUMPED: 9.8.0 is on npm).

## 9.8.0 - 2026-10-31

- Added: `no-spacing-utility` (R350, `FE_SPACING_UTILITY`): no padding, margin, gap or space utility (variants and arbitrary values included) in an app class string; the message names the role prop to use. It ships in the closed counting cohort (`COUNTING` of `src/lib/config.ts`) at warn for this release.
- Changed: `nested-control-variant` refuses the pill (`variant="secondary"`) on `Tabs` wherever it is set, and no longer refuses `variant="primary"` inside a surface: tabs are the underline bar everywhere.

## 9.7.0 - 2026-10-31

- Added: R349 `no-hand-built-panes` (`FE_HAND_BUILT_PANES`, surface rules, slot-free): a multi-pane frame is a `PaneGrid`, so a vertical Grammar `Divider` used as a column seam (among the plain columns of a flex row, or anywhere inside a `SurfaceCard composition="joined"`) and a joined card that holds a flex row of two or more plain columns are refused.
- Changed: `Pane` and `PaneSection` are surfaces for `no-list-panel-padding` (R318), so wrapper padding around a `ListBox` in a pane is caught in the file. The bundled runtime copies follow @starci/hfs 4.15.0 and the canon pins name the cohort hfs 4.15.0, eslint-canon-be 3.11.0, eslint-canon-fe 9.7.0, @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.17.0.

## 9.6.7 - 2026-10-31

- Changed: the bundled runtime copies follow @starci/hfs 4.14.0 (R334 one style, `ruleParams.be.sqlPassThrough`) and the canon pins name the cohort hfs 4.14.0, eslint-canon-be 3.11.0, eslint-canon-fe 9.6.7, @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.16.6, with @starci/ai-router 0.5.0; the status rule changes (below).

## 9.6.6 - 2026-10-31

- Changed: the bundled canon pins name @starci/ai-router 0.5.0 (many providers behind one virtual key, the persisted key blacklist) and the cohort that carries them: hfs 4.13.3, eslint-canon-be 3.10.1, eslint-canon-fe 9.6.6, eslint-grammar-core and eslint-grammar-offset-pop 0.16.6; no rule changed.

## 9.6.5 - 2026-10-31

- Changed: the bundled runtime copies follow @starci/hfs 4.13.2 (R344 on the `be.integrations` slot) and the canon pins name hfs 4.13.2, eslint-canon-be 3.10.0, eslint-canon-fe 9.6.5, eslint-grammar-core and eslint-grammar-offset-pop 0.16.5; no rule changed.

## 9.6.4 - 2026-10-31

- Changed: the bundled canon pins name @starci/hfs 4.13.1 and the lint cohort (eslint-canon-be 3.9.4, eslint-canon-fe 9.6.4, eslint-grammar-core and eslint-grammar-offset-pop 0.16.4); no rule changed.

## 9.6.3 - 2026-10-31

- Changed: the bundled canon pins name the 0.16.3 cohort (@starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.16.3, eslint-canon-fe 9.6.3, eslint-canon-be 3.9.3, stylelint-canon 2.3.0, jest-preset 2.6.0, hfs 4.13.0); ChatWorkspace and PaneLayout are removed with no alias; PaneGrid and Pane are the one generic pane grid: grammar names are generic. The surface-rules spec uses PaneGrid.
- Added: lib/freestyle (`exemptFreestyle`, `freestyleContext`): no-arbitrary-value, no-app-surface-paint, no-raw-brand-value, no-list-panel-padding, no-inline-class-name and no-native-img do not report the raw elements inside a `<Freestyle>` subtree of the same file; a Grammar component inside it is judged as before. Specs: src/freestyle.spec.ts.
- Added: the lint result cache of `starci app check`: `crossFileInputs`, the files and folders each rule reads beyond the linted file (an fs-audit spec proves every rule declares what it reads), and the `projectGraph` export the cache keys a file's lint record on.

## 9.6.2 - 2026-10-31

- Changed: the bundled canon pins name @starci/grammar 0.16.2 (the horizontal Stepper connector line; SurfaceListCard takes its depth from the surface context).

## 9.6.1 - 2026-10-30

- Changed: the bundled canon pins name @starci/grammar 0.16.1 (accentCorner, Backdrop, the shell filling the viewport).

## 9.6.0 - 2026-10-30

- Changed: the bundled runtime copies are now generated from the hfs build (TypeScript emitted as .mjs) per runtime/bundle.json, with a drift check in CI; the copies the package keeps as its own are listed there and stay hand-maintained; the bundled canon pins name hfs 4.12.0, eslint-canon-be 3.9.0, eslint-canon-fe 9.6.0, the Grammar family 0.16.0, jest-preset 2.5.3 and test-world 1.3.3. No rule of this package changed.

## 9.5.23 - 2026-10-30

- Changed: the bundled canon pins name hfs 4.11.22 (app check and lint pass under 20 findings), eslint-canon-be 3.8.21, eslint-canon-fe 9.5.23 and the Grammar family 0.15.34. No rule changed.

## 9.5.22 - 2026-10-30

- Changed: the bundled canon pins name hfs 4.11.21 (the one-command urgent release), eslint-canon-be 3.8.20, eslint-canon-fe 9.5.22 and the Grammar family 0.15.33. No rule changed.

## 9.5.21 - 2026-10-30

- Changed: the bundled slot manifest carries the `logic` field (passport declares its tokens, password and cookie files) and the object-storage slot's `object-storage.*` names; the bundled `allows.mjs` and manifest shape admit them; the bundled architecture machine takes a typed-configuration JWT audience; the bundled canon pins name hfs 4.11.20, jest-preset 2.5.2, eslint-canon-be 3.8.19, eslint-canon-fe 9.5.21 and the Grammar family 0.15.32. No rule of this package changed.

## 9.5.20 - 2026-10-30

- Changed: the bundled canon pins name hfs 4.11.19 (the schedule scanner reads interpolated identifiers and const-named SQL), eslint-canon-be 3.8.18, eslint-canon-fe 9.5.20 and the Grammar family 0.15.31. No rule changed.

## 9.5.19 - 2026-10-30

- Changed: the bundled canon pins name hfs 4.11.18 (sealed `.enc.yaml` members pass HFS_STACKS_SHAPE; the deploy schema takes `serverRecipient` and a settings list), eslint-canon-be 3.8.17, eslint-canon-fe 9.5.19 and the Grammar family 0.15.30. No rule changed.

## 9.5.18 - 2026-10-30

- Changed: the bundled canon pins name ai-router 0.4.0 (mounted keys), hfs 4.11.17, eslint-canon-be 3.8.16, eslint-canon-fe 9.5.18 and the Grammar family 0.15.29. No rule changed.

## 9.5.17 - 2026-10-30

- Changed: the bundled architecture machine's `jwt-ast.mjs` and `identity.mjs` carry the R260 policy of eslint-canon-be 3.8.15 (a configured audience or the authenticated role binds the principal). No rule of this package changed.
- Changed: the bundled canon pins name hfs 4.11.16, eslint-canon-be 3.8.15, eslint-canon-fe 9.5.17, the Grammar family 0.15.28 and test-world 1.3.2. No rule changed.

## 9.5.16 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.15, eslint-canon-be 3.8.14, eslint-canon-fe 9.5.16, the Grammar family 0.15.27 and jest-preset 2.5.1. No rule changed.

## 9.5.15 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.14, eslint-canon-be 3.8.13, eslint-canon-fe 9.5.15 and the Grammar family 0.15.26. No rule changed.

## 9.5.14 - 2026-10-29

- Changed: the bundled `runtime/scripts/lib/sops-envelope.mjs` admits an age set of one or more recipients for the selected-identity decrypt (`selectedAgeEnvelope`): the selected recipient must be one of the set, an empty entry or gap (`invalid-age-entry`) and a recipient named twice (`duplicate-age-recipient`) are refused, a dotenv envelope reads every `sops_age__list_<n>__` entry; the bundled canon pins name hfs 4.11.13, eslint-canon-be 3.8.12, eslint-canon-fe 9.5.14 and the Grammar family 0.15.25. No rule changed.

## 9.5.13 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.12, eslint-canon-be 3.8.11, eslint-canon-fe 9.5.13 and the Grammar family 0.15.24; the bundled slot judgement (`runtime/scripts/hfs/path-findings.mjs`) admits the one file a file slot names by its path, as eslint-canon-be does.

## 9.5.12 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.11, eslint-canon-be 3.8.10, eslint-canon-fe 9.5.12 and the Grammar family 0.15.23. No rule changed.

## 9.5.11 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.10, eslint-canon-be 3.8.9, eslint-canon-fe 9.5.11 and the Grammar family 0.15.22. No rule changed.

## 9.5.10 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.9, eslint-canon-be 3.8.8, eslint-canon-fe 9.5.10 and the Grammar family 0.15.21. No rule changed.

## 9.5.9 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.8, eslint-canon-be 3.8.7, eslint-canon-fe 9.5.9 and the Grammar family 0.15.20. No rule changed.

## 9.5.8 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.7, eslint-canon-be 3.8.6, eslint-canon-fe 9.5.8 and the Grammar family 0.15.19. No rule changed.

## 9.5.7 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.6, @starci/test-world 1.3.1, eslint-canon-be 3.8.5, eslint-canon-fe 9.5.7 and the Grammar family 0.15.18, and pin `undici` 6.29.0 (owner `platform/http`). No rule changed.

## 9.5.6 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.5, eslint-canon-be 3.8.4, eslint-canon-fe 9.5.6 and the Grammar family 0.15.17. No rule changed.

## 9.5.5 - 2026-10-29

- Changed: the bundled canon pins name @starci/test-world 1.3.0 (HTTPS fakes over the run's ephemeral fake CA), hfs 4.11.4, eslint-canon-be 3.8.3, eslint-canon-fe 9.5.5 and the Grammar family 0.15.16. No rule changed.

## 9.5.4 - 2026-10-29

- Changed: the bundled slot manifest 3.13.0 admits `pgmq` in `ruleParams.db.extensions` (the lite event bus), retires `ruleParams.db.queueOutbox` and `sides.be.queueOutbox` with the pg_cron half of R258, lists `public.event_bus_send`, `public.event_bus_read`, `public.event_bus_archive`, `public.event_bus_bury`, `public.event_bus_dead_letters` and `public.event_bus_requeue` in place of `public.event_bus_write` in `ruleParams.be.dbFunctions`, and moves slot `app.db.image` to `.starcistacks/images/db/Dockerfile` (admitted by the lite `app.starcistacks` allows); the bundled rule catalog keeps R258 `DB_PGMQ_DECLARED` as the event-bus law, retires `DB_CRON_OWNED` and adds R336 `BE_EVENT_BUS_LITE_SHAPE`; the bundled canon pins name hfs 4.11.3, eslint-canon-be 3.8.2, eslint-canon-fe 9.5.4 and the Grammar family 0.15.15. No front-end rule changed.

## 9.5.3 - 2026-10-29

- Changed: the bundled slot manifest 3.12.0 lists the canon's database functions of R334 schema-qualified (`public.job_claim`, `public.job_tick_claim`) beside the pg built-ins it names bare (`gen_random_uuid` joins them), and its shape (`rule-params-shape.mjs`, `declaration-shape.mjs`) with the manifest check of `slots.mjs` refuses in hfs.json `sides.be.dbFunctions` a `pg_catalog` name and any bare name that is not a built-in the canon lists; the manifest bump is minor although that refusal is stricter, since R334 is new on manifest major 3 and its one app (nivo-lite) lists only names it admits (its one bare name, `gen_random_uuid`, is now a canon built-in); the bundled rule catalog's R334 and R68 laws name `platform/database/database.client.ts` as the one composer of the call statement; the bundled canon pins name hfs 4.11.2, eslint-canon-be 3.8.1, eslint-canon-fe 9.5.3 and the Grammar family 0.15.14. No front-end rule changed.
- Changed: the bundled canon pins also carry the hfs 4.11.1 re-pin of db baseline --squash (R213 transaction control in migrations, extensions schema in the bootstrap), which bumped no eslint package.

## 9.5.2 - 2026-10-29

- Changed: the bundled slot manifest 3.11.0 adds the managed lite slot `app.db.image` (`db/Dockerfile`), narrows `ruleParams.db.extensions` to what the official postgres image plus pgvector carries (pgcrypto, pg_trgm, vector, uuid-ossp, unaccent, btree_gist; no pgmq, pg_cron, pg_net or supabase_vault) and gives `@nestjs/schedule` and `cron` one owner, `platform/jobs`, in `infraOwners`; the bundled rule catalog adds R335 `BE_JOBS_SCHEDULER_OWNER` and its R250 and R276 laws name the platform/jobs tick and the db image; the bundled canon pins name hfs 4.11.0, eslint-canon-be 3.8.0, eslint-canon-fe 9.5.2 and the Grammar family 0.15.13 and pin `@nestjs/schedule` 6.1.3 (CommonJS on the Nest 11 line) and `cron` 4.4.0. No front-end rule changed.

## 9.5.1 - 2026-10-29

- Changed: the bundled slot manifest 3.10.0 adds the lite slot `be.platform.database.entities`, the entity registry (slot fields `role: entity-registry` and `importedBy`, validated by the manifest shape); the bundled architecture machine reads it (`architecture/entity-registry.mjs`): `tier-direction` (R26 `BE_TIER_DIRECTION`) admits the registry's import of a domain or platform capability's `index.ts` that binds only that capability's `<c>Entities`, and `owner-export-bypass` (R30 `ARCH_OWNER_EXPORT_BYPASS`) admits a direct import of the registry from the files `importedBy` names (`apps/*/src/compose/*.ts`, `apps/*/src/app.module.ts`, `src/tests/world/**`); every other import of either shape stays refused, and full has no registry; the bundled canon pins name hfs 4.10.1, eslint-canon-be 3.7.1, eslint-canon-fe 9.5.1 and the Grammar family 0.15.12. No front-end rule changed.
- Changed: the bundled architecture machine: the owner-cycle check (R27 `ARCH_OWNER_CYCLE`) counts the entity registry as a unit of its own, not part of `platform/database`, so naming every `<c>Entities` closes no cycle among capabilities while any other platform/database file importing a domain still does.

## 9.5.0 - 2026-10-29

- Changed: `modules/auth` is the session issuer's client. `fetch-only-in-api-client` admits axios in `modules/auth/auth-door.ts` and refuses a door call whose readable path names no `/auth/` door; `no-shared-transport-state` judges `modules/auth` and admits only `modules/auth/token-store.ts`; the machine `transport-owner` admits the auth door. `fe-stack-import` no longer carves Supabase into `modules/auth`: the fe-stack catalog forbids `@supabase/supabase-js`, `@supabase/ssr` and `@supabase/auth-js` everywhere and lists `fe.modules.auth` as a home of axios.
- Removed: `callback-shape` (R287 `FE_CALLBACK_SHAPE`) with the `fe.route.callback` slot: the OAuth callback is a back-end door.
- Changed: the bundled slot manifest 3.9.0 replaces the lite `app.supabase*` slots with `app.db` (`db/migrations`, `db/migrations/archive`, `db/seed.sql`, the managed `db/bootstrap.sql`), `be.integrations.supabase` with `be.integrations.passport` and `be.integrations.object-storage`, removes `fe.route.callback`, sets lite `schemaAuthority: sql`, gives lite TypeORM entities in `be.persistence`, adds `ruleParams.be.dbFunctions`, and moves the S3 SDKs to `integrations/object-storage` and the identity libraries to `integrations/passport` in `infraOwners` (`@supabase/*`, `minio` and `bcrypt` nowhere); the bundled rule catalog retires R216, R217, R219, R254 and R287 and adds R328-R334; the bundled canon pins name hfs 4.10.0, eslint-canon-be 3.7.0, eslint-canon-fe 9.5.0 and the Grammar family 0.15.11, pin `@nestjs/passport` 11.0.5 (CommonJS on the Nest 11 line), `passport` 0.7.0, `passport-google-oauth20` 2.0.0, `passport-local` 1.0.0, `bcryptjs` 3.0.3 and their types (tokens are signed and verified with `jose`; `@nestjs/jwt` stays allowed in `integrations/passport` but unpinned), and drop `@supabase/ssr`, `@supabase/supabase-js` and the `supabase` CLI.

## 9.4.9 - 2026-10-29

- Changed: the bundled slot manifest gives the model libraries their owners in `ruleParams.be.infraOwners` (`@starci/ai-router` to `integrations/ai-gateway`, `@langchain/*` to `integrations/ai`; `openai`, `langchain`, `@langchain/langgraph`, `@langchain/community` and the provider SDKs nowhere) and lists R326 and R327 on `be.integrations`; the bundled canon pins name hfs 4.9.11, eslint-canon-be 3.6.8, eslint-canon-fe 9.4.9, the Grammar family 0.15.10 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), and pin `@langchain/core` 1.3.1 and `@langchain/openai` 1.8.0. No rule changed.

## 9.4.8 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.9.10, eslint-canon-be 3.6.7, eslint-canon-fe 9.4.8, eslint-grammar-core 0.15.9 and eslint-grammar-offset-pop 0.15.9. No rule changed.

## 9.4.7 - 2026-10-29

- Changed: the bundled canon pins name the Grammar family 0.15.8 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), eslint-canon-fe 9.4.7 and eslint-canon-be 3.6.6. No rule changed.

## 9.4.6 - 2026-10-29

- Changed: the bundled canon pins name the Grammar family 0.15.7 (grammar, eslint-grammar-core, eslint-grammar-offset-pop) and eslint-canon-fe 9.4.6, and hfs 4.9.9 and eslint-canon-be 3.6.5. No rule changed.

## 9.4.5 - 2026-10-28

- Changed: the bundled canon pins name the Grammar family 0.15.5 (grammar, eslint-grammar-core, eslint-grammar-offset-pop). No rule changed by it.
- Changed: `starci-fe/nested-control-variant` (FE_NESTED_VARIANT) covers Grammar's `CopyField`: its layer variant follows the surface context, so a static `variant` is refused like every other field's.

## 9.4.4 - 2026-10-28

- Changed: the bundled canon pins follow release G (Grammar family 0.15.4, hfs 4.9.5, canon-fe 9.4.4, canon-be 3.6.4, ai-router 0.3.0); the mermaid pin names Grammar's MermaidDiagram as its owner. No rule changed.

## 9.4.3 - 2026-10-28

- Changed: the bundled canon pins follow release F (Grammar family 0.15.3, hfs 4.9.4, canon-fe 9.4.3, canon-be 3.6.3, ai-router 0.3.0). No rule changed.

## 9.4.2 - 2026-10-28

- Changed: the bundled canon pins follow release E (Grammar family 0.15.2, hfs 4.9.3, canon-fe 9.4.2, canon-be 3.6.2, ai-router 0.3.0) and pin no `starci-harness`: an app's CLI is the version of the CLI that runs @starci/hfs. No rule changed.

## 9.4.1 - 2026-10-28

- Fixed: `server-module-marks-server-only` exempts every route-tier file (`fe.route`, `fe.source-root-pinned` and the opt-in `fe.route.callback`), so the auth callback route is no longer told to carry the marker route files need not.
- Changed: the bundled runtime's `repo-identity.mjs` names a repository by its origin remote (hfs 4.9.2); the fixture copy of the callback route template exports an arrow `GET`.
- Changed: the bundled canon pins follow release D (Grammar family 0.15.1, hfs 4.9.2, canon-fe 9.4.1, canon-be 3.6.1, starci-harness 1.1.0-alpha.2), so an app installs the released versions without pin drift.

## 9.4.0 - 2026-10-28

- Changed: the package is TypeScript. `src/**/*.ts` (rules, the shared `lib/` readers and every spec) is strict and builds to `dist/` with the `@starci/tsconfig` `package-esm` preset; `main`, `types` and `exports` point at `dist`, keeping `@starci/eslint-canon-fe/lib/*.mjs` (also `lib/*.js`). The fixture tester is `fixtures/typed/tester.ts`. The bundled runtime is read through the package import `#runtime/*`, typed by `src/types/runtime` until the runtime is built from `@starci/hfs`. Rules are typed against typescript-eslint's rule module; `@typescript-eslint/utils` joins the dependencies. No rule changed behaviour in the conversion.
- Changed: `base-props-atom` fixes the retired `state` key by renaming it `shape`; `no-data-status-shape` also reads an `interface XShape`, an inline `shape: { ... }` object and a boolean status member (`isOpen`, `isRenewing`) in a shape, and still the old `XState` names.
- Changed: `presentational-purity` also refuses an import from `@/hooks` in a pure half, `import type` included.
- Added: the shape-slot law (R92): `exhaustive-shape-switch` (a pure half's branch on `props.shape` / `shape` draws every `XShape` member; no default stands in for one), `no-data-status-prop` (no `isLoading`, `isError`, `isForbidden`, `isFailed` or `failure` prop below SlotView; a leaf takes only `isSkeleton`), `region-reads-through-slot` (a connected half that calls an `*Swr` hook folds the read into a DataSlot; a pure half that takes a DataSlot renders SlotView) and `branch-intrinsic-state` (a branch keeps interaction state only; a leaf calls no hook).
- Fixed: the built declarations name `.js`, not the `.ts` sources (`tsc` keeps a relative `.ts` specifier in a `.d.ts`).
- Changed: the bundled canon pins follow release C (Grammar family 0.15.0, hfs 4.9.1, canon-fe 9.4.0, canon-be 3.6.0, jest-preset 2.4.1, stylelint-canon 2.2.1, tsconfig 2.1.0, prettier-config 1.1.0, and `@starci/ai-router` 0.2.1 pinned), so an app installs the released versions without pin drift.

## 9.3.0 - 2026-10-28

- Changed (breaking for apps): a pure half takes `{ shape?, props, on? }`; `base-props-atom` refuses the retired `state` key with a message naming the rename, and `no-data-status-shape` reads `XShape` unions (and still the old `XState` names, so a status word is caught during the rename).
- Changed: the bundled runtime copies follow the retirement of `@starci/cli`: the bundled canon pins replace the retired `@starci/cli` with `starci-harness` 1.1.0-alpha.1 (`source: cli/package.json`), the one command line a product installs for `starci app`, and follow the harness packages (Grammar family 0.14.0, hfs 4.9.0, canon-fe 9.3.0, canon-be 3.5.0); the runtime finds an app's `starci` bin in its installed `starci-harness`.

## 9.2.0 - 2026-10-27

- Changed: the bundled Grammar catalog declares exactly two families, `core` (`@starci/eslint-grammar-core`, `coreGrammarConfig`) and `offset-pop`; `starci`, `starci-core` and `heritage` are refused. The Grammar entry checks (button intent, control height, surface rules, UI rulings) accept `@starci/grammar/<common|core|offset-pop>`. The bundled canon pins follow the harness packages (Grammar family 0.13.0, hfs 4.8.0, canon-fe 9.2.0, canon-be 3.4.57, stylelint-canon 2.1.0).
- Changed: the doc comment of `lint-escape-hatch.mjs` names the three patterns that own the refused spellings instead of spelling them again. No rule or behaviour changed.

## 9.1.11 - 2026-10-27

- Changed: licensed MIT (was UNLICENSED); the package metadata names the repository, homepage and bugs so npm can attach provenance. No rule or behaviour changed.

## 9.1.10 - 2026-10-27

- Added: starci-fe/no-grammar-shim (R321 FE_GRAMMAR_SHIM): an app never re-exports a Grammar export under its own name (`export { X } from`, `export * from`, or an imported binding exported again); the Grammar defect a shim would hide is reported to the Grammar.

## 9.1.9 - 2026-10-26

- Added: starci-fe/control-height (R320 FE_CONTROL_HEIGHT), selection-fill-no-check and no-grammar-internal-selector.
- Changed: the bundled runtime copies carry the light push gate.

## 9.1.8 - 2026-10-26

- Added: the `divider-full-bleed` rule (a Grammar `Divider` between full-bleed regions is itself full bleed), the SegmentedControl `size="control"` carve-out and the `@starci/event-stream` registration in the fe-stack concern.
- Changed: the bundled canon pins follow the final package versions (Grammar 0.12.12 with the lint families).

## 9.1.7 - 2026-10-26

- Changed: the alpha.31.1 round folded into alpha.31; the bundled canon pins and runtime copies follow the final package versions. No rule changes.

## 9.1.6 - 2026-10-26
- Changed: the bundled runtime copies follow the hfs 4.7.44 and cli 1.7.44 pins and the lint family versions (the runtime install file carries the wave version). No rule changes.

## 9.1.5 - 2026-10-26
- Changed: R280 reads one assignment-target index per run (bundled hfs copy); the bundled runtime copies follow the hfs 4.7.43 and cli 1.7.43 pins and the lint family versions. No rule changes.

## 9.1.4 - 2026-10-26
- Fixed: `HFS_BYPASS_MARKER` reads a skip/only index only, not a string in an array literal (bundled hfs copy).
- Changed: the bundled runtime copies (canon pins) follow the hfs 4.7.42 and cli 1.7.42 pins and the lint family versions. No rule changes.

## 9.1.3 - 2026-10-26
- Changed: the bundled runtime copies (canon pins) follow the hfs 4.7.41 and cli 1.7.41 pins and the lint family versions. No rule changes.

## 9.1.2 - 2026-10-26
- Changed: the bundled runtime copies (canon pins, slots and the declaration shape) follow the hfs 4.7.39 and cli 1.7.39 sources. No rule changes.

## 9.1.1 - 2026-10-26
- Changed: the bundled runtime copies (canon pins) follow the stylelint 2.0.13, hfs 4.7.38 and cli 1.7.38 pins. No rule changes.

## 9.1.0 - 2026-10-26
- Added: universal CTA-6 button intent laws require `intent`, refuse app `variant`, contain destructive confirms in confirmation dialogs, keep one commit per render path and reserve commit for the view rather than collection items. Run `starci app codemod button-intent` to prepare migration and review its flagged cases.

## 9.0.0 - 2026-10-26
- Changed: concrete Grammar component, variant, token and vendor rules move to `@starci/eslint-grammar-starci` under the `starci-grammar` namespace. Consumers compose both flat-config factories for their selected family.
- Added: explicit shared infrastructure exports under `@starci/eslint-canon-fe/lib/*`; family packages reuse these readers without copying them.
- Kept universal: the R318 surface composition law (`nested-control-variant`, `no-list-panel-padding`, `no-app-surface-paint`) and the R65 `no-app-relative-clock`, now in `size-and-state-budget.mjs`.

### Migrating from 8.x
- What moved: twenty rules leave this package with their IDs, finding codes and severity unchanged; only the namespace changes from `starci-fe/` to `starci-grammar/`. They are `app-shell-frame`, `no-shell-bottom-tabs`, `navbar-control-size`, `navbar-cluster`, `no-navbar-create`, `no-raw-structural-element`, `no-heading-tag-outside-heading-component`, `status-text-uses-soft-foreground`, `vendor-primitive-has-named-owner`, `no-vendor-icon-outside-icon-leaf`, `heroicons-is-the-glyph-vendor`, `no-off-scale-glyph-size`, `no-icon-size-class`, `destructive-menu-entry-needs-danger-tone`, `no-decorative-icon-in-metric-cell`, `no-inline-svg-outside-brand-mark-leaf`, `no-fractional-step`, `no-hand-rolled-heading`, `no-unresolved-token-class` and `slot-status-through-slotview`. StarCi apps get them from `@starci/eslint-grammar-starci`; Offset Pop apps get the same implementations from `@starci/eslint-grammar-offset-pop`.
- Select the family explicitly: set `sides.fe.grammar` to `starci` or `offset-pop` in `hfs.json`. No family is inferred.
- Install the family package at its canon-pins version beside this one (app root `devDependencies`). `starci app check` refuses an app that selects a family and declares canon-fe 9 without that package (`FE_STACK_FAMILY_LINT_MISSING`, R288), so the twenty rules cannot be lost silently.
- Flat config order: the universal factory first, then the family factory, both with the same HFS view: `export default [...starciFeConfig({ hfs }), ...starciGrammarConfig({ hfs })]` (Offset Pop: `offsetPopGrammarConfig`). `starci app sync` renders this managed `fe/eslint.config.mjs`.
- Rename any reference to a moved rule from `starci-fe/<rule>` to `starci-grammar/<rule>`; the removed-vocabulary check refuses the old spelling.
- NIVO moves in v0.3.7.

## 8.4.43 - 2026-10-26
- Changed: the bundled canon pins follow back-end canon 3.4.43, hfs 4.7.34 and cli 1.7.34.

## 8.4.42 - 2026-10-26
- Changed: the bundled canon pins follow back-end canon 3.4.42.

## 8.4.41 - 2026-10-26

- Enforce the app-shell canon through fixed WorkspaceShell frames, drawer navigation, ordered navbar controls, control sizing and page-owned creation, with full and lite regression coverage.
- Fixed: `operations-only-in-swr-hooks` (FE_OP_OUTSIDE_SWR_HOOK) no longer reports named imports that all resolve, through relative re-exports, to a generated `__generated__/input-bounds` module (`INPUT_BOUNDS`, `inputBoundsIssues`): they are contract data, not API operations. Mixed, default and namespace imports of the barrel still report.
- Added: the stream reader of server-sent events (`fe.transport.stream`, `modules/api/sse/clients/`) is part of the API layer, so it may call `fetch` (FE_TRANSPORT_OWNER); a stream operation (`sse/<area>/stream-<channel>.ts`) must import it.
- Added: `useSWRSubscription` (`swr/subscription`) is an SWR request hook of the family (FE_SWR_OUTSIDE_FAMILY, FE_OP_OUTSIDE_SWR_HOOK, FE_HOOKS_ARE_HOOKS): a stream operation is consumed only by `hooks/swr/api/sse/subscriptions/useSubscribe<X>Swr.ts`.
- Changed: `nested-control-variant` (`FE_NESTED_VARIANT`) refuses static variants on layer-aware fields throughout app code and primary Tabs inside painted Grammar surfaces. R318 owns Grammar composition; `no-app-surface-paint` uses the separate layout-only code `FE_GRAMMAR_LAYOUT_ONLY`. `no-list-panel-padding` (`FE_LIST_PANEL_PADDING`) checks all horizontal padding forms only within the nearest painted surface.

## 8.4.40 - 2026-10-25
- Changed: the bundled canon pins select @starci/stylelint-canon 2.0.11, @starci/hfs 4.7.33 and @starci/cli 1.7.33.

## 8.4.39 - 2026-10-25
- Changed: the bundled canon pins select @starci/grammar 0.11.0, @starci/hfs 4.7.32 and @starci/cli 1.7.32.

## 8.4.38 - 2026-10-24
- Changed: the bundled runtime copies and canon pins carry the alpha.30 canon (the `zod` pin is `side: both`) and select @starci/hfs 4.7.31 and @starci/cli 1.7.31.

## 8.4.37 - 2026-10-24
- Changed: the bundled canon pins add the multer 2.5.0 security override and select @starci/hfs 4.7.30 and @starci/cli 1.7.30.

## 8.4.36 - 2026-10-24
- Changed: the bundled canon pins select zod 4.6.7, @starci/hfs 4.7.29 and @starci/cli 1.7.29.

## 8.4.35 - 2026-10-23
- Changed: the bundled slot manifest names the specs that moved into this package; 8.4.34 was published with the old spec paths and is superseded.

## 8.4.34 - 2026-10-23
- Changed: the bundled canon pins select @starci/hfs 4.7.28 and @starci/cli 1.7.28; the bundled rule catalog drops the per-rule markers `specNa`, `exampleNa` and the unreachable witness.

## 8.4.33 - 2026-10-23
- Changed: the bundled canon pins select @starci/hfs 4.7.27 and @starci/cli 1.7.27.

## 8.4.32 - 2026-10-23
- Changed: the bundled canon pins select @starci/hfs 4.7.26 and @starci/cli 1.7.26.

## 8.4.31 - 2026-10-23
- Changed: the bundled canon pins select @starci/hfs 4.7.25 and @starci/cli 1.7.25.

## 8.4.30 - 2026-10-23
- Changed: the bundled canon pins select @starci/hfs 4.7.24 and @starci/cli 1.7.24.
- Added: the type-aware rules the back end already borrowed, at error: `@typescript-eslint/no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check` and the `no-unsafe-assignment`, `-member-access`, `-call`, `-return`, `-argument` family.
- Changed: no Sonar way rule is left to the server (no loosening): S3403, S3800, S3782 and S6582 run at error, `unicorn/consistent-function-scoping` runs with its default options, and S7785 (`unicorn/prefer-top-level-await`) runs in the front end (ESM).
- Added: `starciPlainSourceConfig({ root })` for a TypeScript front-end tree that is no HFS app (a runtime package, the harness UI): typed linting, the inline-directive fence, the React Hooks, type-aware and Sonar way rules and every canon rule that needs no slot view (`SLOT_FREE_RULES`), all at error.

## 8.4.29 - 2026-10-22
- Changed: the bundled canon pins select @starci/hfs 4.7.23 and @starci/cli 1.7.23.

## 8.4.28 - 2026-10-22
- Changed: the bundled canon pins select @starci/hfs 4.7.21 and @starci/cli 1.7.21.

## 8.4.27 - 2026-10-22
- Fixed: Sonar way parity with the server: the injected-constructor-aware `max-params` (S107) replaces core `max-params`, and the ports that report what the server does not on the same source (S1481 `no-unused-vars`, S3403 `different-types-comparison`, S3782 `argument-type`, S3800 `function-return-type`, S6582 `prefer-optional-chain`) are left to the server; NIVO (0 issues on the server) lints at 0 instead of 205 under 1.7.19.
- Changed: the bundled canon-pins and failure-code copies follow the 1.7.20 cohort; lint behavior is unchanged.

## 8.4.26 - 2026-10-21
- Changed: supersedes 8.4.25 (app lint broken: the canons' Sonar way block carries its own ignores, which `starci app lint` refused as an unsupported source scope, so it exited 2 without running ESLint and reported 0 findings); 8.4.25 is not used.
- Changed: the bundled canon-pins copy follows the 1.7.19 cohort (cli 1.7.19, hfs 4.7.19); lint behavior is unchanged.

## 8.4.25 - 2026-10-21
- Changed: supersedes 8.4.24, published from a lane whose history the owner refused (an unapproved allowlist entry) and therefore a superseded orphan that is not used; this version carries the same work plus the standalone scaffold fix.
- Added: Sonar way at lint time: every rule of the Sonar way TypeScript profile with an ESLint equivalent is on at error over the files the scan judges (a unit or end-to-end spec is outside), from the shared `scripts/lib/sonar-way.mjs`: eslint-plugin-sonarjs' Sonar way set (cognitive complexity 15, super-linear and slow regex, sort compare, nested template literals, ...) and the rules SonarSource builds on (`max-params` 7, `no-duplicate-imports`, `@typescript-eslint/prefer-optional-chain`, unicorn's `prefer-native-coercion-functions`, `prefer-includes`, `prefer-set-has` and the other S77xx rules). New exact dependencies eslint-plugin-sonarjs 4.2.1 and eslint-plugin-unicorn 65.0.0 (the last line for ESLint 9).
- Added: `media-has-caption` (S4084): a `<video>` or `<audio>` element carries a captions track or is muted.
- Changed: the bundled canon-pins copy follows the 1.7.18 cohort (cli 1.7.18, hfs 4.7.18, jest-preset 2.3.4).

## 8.4.23 - 2026-10-21
- Changed: the bundled canon-pins copy follows the 1.7.16 cohort (cli 1.7.16, hfs 4.7.16); lint behavior is unchanged.

## 8.4.22 - 2026-10-21
- Changed: bundled runtime copies carry slot manifest 3.4.0 (`be.contract.mcp-tools`); lint behavior is unchanged; canon pins follow the matching package cohort.

## 8.4.21 - 2026-10-20
- Changed: republished for the complete 1.7.14 cohort; 8.4.20 was published while @starci/hfs 4.7.14 and @starci/cli 1.7.14 stopped at their clean proof, so it is a superseded orphan and is not used. Content equals 8.4.20 apart from the canon pins.

## 8.4.20 - 2026-10-20
- Changed: bundled runtime copies carry the HFS hooks-installed check (`HFS_HOOKS_NOT_INSTALLED`); lint behavior is unchanged; canon pins follow the matching package cohort.

## 8.4.19 - 2026-10-20
- Fixed: bundled runtime source clears the SonarCloud code smells of alpha.23 (regex complexity, concise classes, string prefix and suffix checks, block braces, optional chaining, export-from, default parameters, synchronous awaits, dead stores) without behavior change; canon pins follow the matching package cohort.

## 8.4.18 - 2026-10-19
- Fixed: bundled runtime source analysis retains nullable contracts and explicit callback arguments; canon pins follow the matching HFS and CLI cohort.

## 8.4.17 - 2026-10-19
- Changed: bundled canon pins follow the native CLI and HFS provisioning cohort; front-end lint rules are unchanged.

## 8.4.16 - 2026-10-19
- Changed: bundled canon pins follow the regenerated Stylelint vocabulary and the matching HFS and CLI cohort; front-end canon rules are unchanged.

## 8.4.15 - 2026-10-19
- Changed: bundled canon pins follow @starci/hfs 4.7.9, @starci/cli 1.7.9 and the matching lint canon cohort for the lite development guidance update; front-end canon rules are unchanged.

## 8.4.14 - 2026-10-19
- Changed: bundled runtime and canon pins follow @starci/hfs 4.7.8, @starci/cli 1.7.8 and the matching lint canon cohort for the catalog provenance repairs; front-end canon rules are unchanged.

## 8.4.13 - 2026-10-19
- Fixed: shared import classification selects an existing module file before virtual slot inference, so public auth barrels retain their resolved owner while impure redirect helpers remain refused.

## 8.4.11 - 2026-10-18
- Changed: bundled canon pins follow @starci/hfs 4.7.5 and @starci/cli 1.7.5 for the managed Codecov coverage scope correction; canon rules are unchanged.

## 8.4.10 - 2026-10-18
- Changed: bundled canon pins follow @starci/hfs 4.7.4 and @starci/cli 1.7.4 for the Sonar analyzer heap property correction; canon rules are unchanged.

## 8.4.9 - 2026-10-18
- Changed: bundled canon pins advance with both lint canons after the interrupted alpha.22 package publication; canon rules are unchanged.

## 8.4.8 - 2026-10-18
- Changed: bundled runtime pins follow @starci/hfs 4.7.3 and @starci/cli 1.7.3 for the alpha.22 typecheck heap repair; canon rules are unchanged.

## 8.4.7 - 2026-10-18
- Changed: bundled runtime copies follow the alpha.22 re-cut (canon pins hfs 4.7.2, cli 1.7.2, jest-preset 2.3.2); canon rules are unchanged.

## 8.4.6 - 2026-10-18
- Changed: bundled runtime copies follow the alpha.22 re-cut (canon pins hfs 4.7.1, cli 1.7.1); canon rules are unchanged.

## 8.4.5 - 2026-10-18
- Changed: bundled runtime copies follow runtime 1.0.0-alpha.22 (failure codes, the rule catalog with R301 and the candidate trigger laws, canon pins); canon rules are unchanged.

## 8.4.4 - 2026-10-18
- Changed: bundled runtime copies follow runtime 1.0.0-alpha.21 (canon pins, failure codes, the narrowed secret patterns); canon rules are unchanged.

## 8.4.3 - 2026-10-18
- Changed: bundled runtime copies include the refreshed canon pins for the alpha.20 patch set; canon rules are unchanged.

## 8.4.2 - 2026-10-17

- Changed: bundled runtime copies follow runtime 1.0.0-alpha.20, including the canon pins and shared architecture checks.

## 8.4.1 - 2026-10-17

- Changed: the bundled runtime copies follow the runtime of 1.0.0-alpha.19: the failure codes, the slot manifest (`exampleNa`) and the rule catalog (`specNa`, `exampleNa`) carry the removal of the runtime's own specs; package behavior is unchanged.
- Changed (R287 `FE_CALLBACK_SHAPE`, a18.1 NIVO request F2): the auth callback may call pure text helpers of the app's `modules/routes` or `modules/auth` (`requestOrigin`, `safeNextPath`; resolved by TypeScript symbol: synchronous, no await, no I/O global, only owner helpers and `modules/config` readers), use static route tables (`AUTH_ROUTES`), and read the exchange outcome's `success` or `ok` flag. An impure, async or non-text helper, a helper outside those owners and a credential passed to a helper are still refused.
- Changed (R287 `FE_CALLBACK_SHAPE`, a18.1 NIVO request F): the auth callback may await one `verifyOtp({ token_hash, type })` of the auth owner (`auth.verifyOtp` or `verifyOtp` from `modules/auth/server`), built from exactly the query values `token_hash` and `type`, beside the one `exchangeAuthCode(code)`; the token hash never reaches a redirect.
- Fixed (R55 `FE_CLIENT_BOUNDARY`, a18.1 NIVO request I): the finding on a page or layout owner now says the owner stays a server component that renders the client block or overlay carrying the directive. The rule is unchanged.

## 8.3.0 - 2026-10-15
- Changed: layouts may import overlays beside pages (tier edge `feature -> feature` from pages and layouts to overlays); a layout hosts the route-selected overlay through `components/branches/OverlayHost` while pages stay server components (pattern FE-BOUNDARY-5). Carries the runtime mirror of the manifest and pins, rebased onto alpha.13 (eslint-canon-fe 8.2.18).

## 8.2.17 - 2026-10-14
- Changed: `component-line-budget` gives a pure re-export `index.ts` the slot's `barrel` budget (400); `basePropsAtom` admits named `render*` callbacks in `props` of non-block pure halves for feature composition; the bundled machine carries the kind-scoped feature tier edge, canon-shape clone exclusions and in-segment i18n template reads.

- Changed: carry the runtime mirror of HFS manifest 3.1.0 (the back-end app composition standard, R245 and R246) and the canon pins of eslint-canon-be 3.3.0, HFS 4.3.0 and CLI 1.2.16. ESLint rule implementations are unchanged.

## 8.2.18 - 2026-10-14

- Changed: carry the canon pins of eslint-canon-be 3.2.19, HFS 4.2.17 and CLI 1.2.17 in the runtime mirror. ESLint rule implementations are unchanged.

## 8.2.17 - 2026-10-14

- Fixed: `dead-exports` (`HFS_UNUSED_EXPORT`) counts an import by another public entry the slot declares in `entries` as a use: a `graphql/{queries,mutations}/types/<x>.ts` export its operation file `query-<x>.ts`/`mutation-<x>.ts` imports is part of that operation's signature and is no longer reported. A barrel or any other non-entry file of the owner still does not count, so an operation reached only through a re-export of `modules/api/index.ts` stays dead.

## 8.2.16 - 2026-10-13

- Changed: the heroicons family is the one application icon set again: `heroicons-is-the-glyph-vendor` admits exactly `@heroicons/react/24/outline`, `@heroicons/react/16/solid` and the matching `@starci/heroicons` subpaths (read from the fe-stack `icons` concern), and refuses Phosphor and every other glyph catalogue, a package the catalog forbids included; `one-icon-set` (8.2.15) is gone. Only the Icon leaf and the toast module import a glyph. The bundled runtime mirror carries the fe-stack catalog and the canon pins with `@heroicons/react` 2.2.0 and `@starci/heroicons` 0.3.3.

## 8.2.15 - 2026-10-13

- Changed: carry the runtime mirror of HFS manifest 3.0.0 (one front-end standard for the lite and the full edition) and the canon pins for Grammar 0.9.14, HFS 4.2.14, jest-preset 2.2.7 and CLI 1.2.14.
- Added: `fe-stack-import` (law `fe-stack`, finding code `FE_STACK_FORBIDDEN`): an import (static, re-export, dynamic, `require`, type-only included) of a package any concern of the fe-stack catalog (`runtime/knowledge/hfs/fe-stack.yaml`) forbids, and `@supabase/*` outside `modules/auth` (slot `fe.modules.auth`), are refused. The catalog is read from the runtime copy; a missing copy stops the lint run with the fix.
- Changed: the transport law follows the Apollo GraphQL + axios API layer. `fetch` (and `Request`, `EventSource`, `sendBeacon`) is legal in every file of the API layer (`modules/api`, the shared api package), `@apollo/client` only there, `axios` only in its REST calls (`modules/api/rest/`), `socket.io-client` only in `hooks/socketio/` (`fetch-only-in-api-client`, message `placed`); `client-fetch-has-signal` and `no-shared-transport-state` judge the whole layer (the generated `graphql/__generated__/` excepted); `no-hand-typed-wire` admits GraphQL documents in the API layer (one file per operation) and refuses them elsewhere; `one-outcome-union` names `GraphQLResponse` in `modules/api/graphql/types.ts` as the one vocabulary and also reads a `success` discriminant. The `modules/db` outcome home and the server reader role are gone.
- Changed: `hooks-folder-holds-hooks-only` judges the hooks families `hooks/{swr,rhf,zustand,socketio,effects,reuseables}` by the files their slots name (message `family`); `SwrSideEffects.tsx` and `SocketIoSideEffects.tsx` are legal `.tsx` files of `hooks/`.
- Changed: `use-client-only-at-boundary` admits the client state a layout mounts once (`components/providers/<name>/index.tsx`, `redux/ReduxProvider.tsx`, `modules/toast/toast.tsx`, the two side-effect components); `client-no-server-import` and `server-module-marks-server-only` drop the server reader role.
- Changed: `presentational-purity` recognises the stack's data, form, state, socket and toast hooks (`use{Query,Mutate,Get,Post,Put,Patch,Delete}<X>Swr`, `use<X>Form`, `useForm`, `useAppDispatch`, `use<X>SocketIo`, `use<X>WithToast`, the Apollo hooks); the served-locale rules find the links of the Apollo clients folder and read the header name case-insensitively; `use-intl-formatter` admits `dayjs` in `modules/dayjs`.
- Changed: `heroicons-is-the-glyph-vendor` is replaced by `one-icon-set`: product glyphs come only from the fe-stack icon set (`@phosphor-icons/react`, subpaths included); Heroicons and `@starci/heroicons` are refused like any second catalogue. A package the catalog forbids by name (date libraries, i18n stacks, glyph sets, transports) is reported once, by `fe-stack-import`.

## 8.2.14 - 2026-10-12

- Changed: carry the merged runtime mirror and canon pins for Grammar 0.9.13, Stylelint canon 2.0.9, HFS 4.2.13 and CLI 1.2.13. The bundled HFS manifest 2.2.0 recognizes declaration-only ambient owners; ESLint rule implementations are unchanged.

## 8.2.13 - 2026-10-12

- Changed: bundled canon pins carry @starci/grammar 0.9.12 (the secondary tab track keeps its padding).

## 8.2.12 - 2026-10-12

- Changed: bundled canon pins carry @starci/grammar 0.9.11 (secondary Tabs are HeroUI's own pill tabs).

## 8.2.11 - 2026-10-12

- Changed: bundled canon pins carry @starci/grammar 0.9.10 (the grammar ships without spec suites).

## 8.2.10 - 2026-10-12

- Changed: refresh the bundled canon pins for CLI 1.2.9, HFS 4.2.9 and the BE lint canon 3.2.10 after correcting the CLI runtime install pin; ESLint rule implementations are unchanged.

## 8.2.9 - 2026-10-12

- Changed: refresh the bundled runtime and canon pins for grammar 0.9.9, stylelint-canon 2.0.8, CLI 1.2.8 and HFS 4.2.8; ESLint rule implementations are unchanged.

## 8.2.8 - 2026-10-12

- Changed: refresh the bundled canon pins for grammar 0.9.8; behaviour is unchanged.

## 8.2.7 - 2026-10-12

- Changed: refresh the bundled canon pins for grammar 0.9.7 and heroicons 0.3.3; behaviour is unchanged.

## 8.2.6 - 2026-10-11

- Changed: refresh the bundled canon pins for CLI 1.2.5 and HFS 4.2.5; command and lint behavior is unchanged.

## 8.2.5 - 2026-10-11

- Changed: refresh the bundled canon pins for stylelint-canon 2.0.7 and cli 1.2.4; behaviour is unchanged.

## 8.2.4 - 2026-10-11

- Changed: refresh the bundled canon pins for @starci/grammar 0.9.3; lint rules are unchanged.

## 8.2.3 - 2026-10-11

- Changed: refresh the bundled canon pins for @starci/grammar 0.9.1; lint rules are unchanged.

## 8.2.2 - 2026-10-11

- Changed: refresh the bundled canon pins for the alpha.9.1 package bindings.

## 8.2.1 - 2026-10-10

- Changed: refresh the bundled canon pins for the queue-template package patch; lint rules are unchanged.

## 8.2.0 - 2026-10-09

- Changed: the bundled runtime copies (engine config, architecture machine, slot manifest, canon pins, failure codes) follow the runtime of 1.0.0-alpha.9; no rule is added or removed. Version 8.1.0 on the registry carries the copies of an earlier runtime.

## 8.1.0 - 2026-10-08

- New: the `sonar-parity` law (R235 `SCAN_SMELL`): `no-await-in-loop` (S9382), `prefer-code-point` (S7758), `prefer-string-raw` (S7780), `no-nested-conditional` (S3358), `no-void-operator` (S3735), `no-unused-import` (S1128), `prefer-export-from` (S7763) and `no-unused-prop-types` (S6767), each the syntax-tree form of the Sonar rule SonarCloud flagged in the example apps, shared with the back-end canon through the bundled `runtime/scripts/lib/sonar-syntax-rules.mjs`. The factory also turns on the typescript-eslint rules `no-deprecated` (S1874), `no-base-to-string` (S6551) and `require-await` (S7503); `@typescript-eslint/eslint-plugin` becomes a dependency of this package.
- Changed: `one-outcome-union` reads the Outcome home from the slot manifest (`outcomeHome` on `fe.transport.outcome`, `fe.package.api.outcome` and the lite `fe.modules.db.outcome`, i.e. `modules/db/outcome.ts`) instead of two slot ids in code; a lite app's db owner is its transport, so its `modules/db/outcome.ts` is THE union and a second one anywhere else is still refused. Full is unchanged.
- Changed: `public-component-signature` accepts a component with no parameter; `no-raw-structural-element` names `Region`, `NavLandmark`, `List` and `ListItem` as owners of section, nav, ul/ol and li; FE-I18N-1 and FE-TYPING-6 canon text (request locale through `next/root-params`, no `void props`); the FE_SWR_KEY_IDENTITY check reads `&&` and `||` gates in its bundled runtime.
## Unreleased (C0 batch)

- Changed (contract change `sonar-coverage-exclusions`): `route-slot-fixed-name` holds `error.tsx` to `ErrorBoundary`, no longer `Error`. `Error` shadows the global Error constructor (Sonar typescript:S2137, a bug), and React calls this component an error boundary. A slot still named `Error` is now reported.

## 8.0.7 - 2026-10-01

- Changed: the same bundled runtime layer move.

## 8.0.6 - 2026-10-01

- Changed: the runtime api layer move and the new pins.

## 8.0.5 - 2026-10-01

- Changed: bundled slots.yaml, sonar-gate.yaml and canon-pins.

## 8.0.4 - 2026-10-01

- Changed: the bundled runtime copy of knowledge/hfs/canon-pins.yaml pins @starci/test-world 1.0.3. No rule or command changed.

## 8.0.3 - 2026-10-01

- Changed: the bundled canon-pins copy pins @starci/stylelint-canon 2.0.2, @starci/eslint-canon-be 3.0.3 and @starci/hfs 4.0.3. No rule changed.

## 8.0.2 - 2026-10-01

- Changed: the bundled runtime copies (slots, canon-pins, failure codes, the architecture machine) put `.starcistacks` and `.sops.yaml` at the app root (`app.starcistacks`, `app.sops`; a side holding either is refused, `HFS_STACKS_IN_SIDE`) and pin @starci/hfs 4.0.2 and this canon at 8.0.2. No lint rule changed.

## 8.0.1 - 2026-10-01

- Changed: the bundled runtime copy of knowledge/hfs/canon-pins.yaml pins @starci/hfs 4.0.1 (the scaffold resolves a real lockfile) and this canon at 8.0.1. No rule changed.

## 8.0.0 - 2026-10-01

- Breaking: the app monorepo standard (hfs 4.0.0). `loadHfs(import.meta.url)` in `fe/eslint.config.mjs` finds the app-root `hfs.json` (kind `app`) one level up and gives every linted file the view of the fe side (paths relative to `fe/`); a standalone front-end `hfs.json` (`profile: fe`) is refused. The project graph (`project-graph` law) is built per side from the side folder. The config stays the managed one-liner.
- New (lane c0-orphan): `props-fields-readonly` (R110 `FE_PROPS_MUTABLE`, law props-and-slots). The props type of an exported rendering function in product source is readonly all the way down: every field and index signature is `readonly`, and every collection it holds, directly or in a nested object declared in the file, is `readonly T[]`, `readonly [A, B]` or `ReadonlyArray<T>`. Replaces the unrun readonly-props script adapter of the retired code-pattern folder.
- New (lane AUTHCHK): `response-cookie-attributes` (R107 `FE_COOKIE_ATTRIBUTES`, law client-boundary). A `set` on Next's `ResponseCookies` (`response.cookies.set`, `(await cookies()).set`), identified by the method's declaring class of `next`, must state `httpOnly` as a literal, carry `secure` and use `sameSite` `lax` or `strict`, judged on the TYPE of the options. The typed fixture's `next/server` and `next/headers` stubs gain the cookie classes.
- Fixed (false positives): `route-files-thin` counts a feature owner a route file mounts through the app alias `@/` (the project graph gives each file to the deepest tsconfig project that holds it, the app's own, whose paths define the alias). `alias-reexport` does not report a route file binding a declaration to a Next.js segment export (`export const generateMetadata = homeMetadata`): the framework fixes that name. Each former false positive is a valid RuleTester case.

## 7.1.2 - 2026-10-01

- Fixed: the bundled machine no longer crashes on a local export list (shared with eslint-canon-be 2.1.2).

## 7.1.2 - 2026-10-01

- Fixed: `duplicate-code` and every project-graph rule failed to load in a repository with a local export list (`export { x }`, no module specifier): the backend machine read `moduleSpecifier.kind` of an absent specifier. The packed-load spec now carries such an export.

## 7.1.1 - 2026-10-01

- Fixed: every rule failed to load in product repositories ("the managed package-scripts template ... cannot be found next to the runtime"): the bundled runtime now carries the data files the architecture machine reads beside its code (the managed package-scripts templates, canon-pins and the Sonar gate). A new runtime spec, `tests/canon-packed-load.spec.mjs`, installs each canon from its packed tarball into a real HFS repository and requires every rule to load.

## 7.1.0 - 2026-10-01

- New: the `project-graph` law: the TS-attached front-end architecture checks (routes, owners, paths) as eslint rules at error, from one cached project graph per lint run.

- Breaking (rule id): `no-http-status-collapse` is renamed `no-failure-collapse`. It fires on UI code that consumes an `Outcome` as well as on HTTP clients, so its name and messages now speak of a failure and its reason (branch on an `Outcome`'s reason code; map an HTTP status to an `Outcome` first). A branch that reads `reason` or `kind` counts as inspecting the failure. Update any `eslint-disable` naming the old id; there is no alias.

## 7.0.0 - 2026-09-30

- **New: `no-vietnamese-in-source` (R91).** Identifiers, string literals, template text, JSX text, comments and test titles carry no Vietnamese letter, specs included. Detection is structural on characters (`scripts/lib/language.mjs` in `runtime/`, folded to NFC, so NFD is caught too). The only exemption is the i18n fixtures slot `fe.e2e-support.i18n` (`e2e/fixtures/i18n/`). Removed: the second-language branches of `no-hardcoded-copy` (its `second` and `comment` messages) and the `SECOND_LANGUAGE_LETTER` export; the one rule holds the law.
- **Breaking: the front end has no tests, so the front-end test rules are gone.** Removed rules: `no-class-string-in-spec`,
  `spec-tests-its-neighbour`, `no-barrel-spec`, `no-double-cast-in-spec`, `connected-spec-has-axe`, `no-mocked-translations`
  (spec quality), `e2e-spec-location`, `e2e-no-absolute-path`, `e2e-no-docker`, `e2e-no-cross-repo-write`, `e2e-no-skip`,
  `e2e-typed-helpers`, `playwright-viewports` (e2e shape) and `unit-test-colocated`, with their why entries, docs and fixtures.
  The factory no longer builds an e2e block (`e2e/**`, `playwright.config.ts`) and returns the ignore block and the typed source block
  only; `sourceRecommended` and `e2eRecommended` are gone (`recommended` is the one set); the spec and e2e exemptions of the other
  rules (`isSpecFile`, `isE2eSource`, the `e2e` tier) are deleted. A test file, a test-tool file or a test dependency in a
  front-end repository is now refused by `hfs check` (FE_NO_TESTS, R97) instead.

## 6.0.2 - 2026-09-30

- **Fix: `use-client-only-at-boundary` refused the providers wrapper.** The route tree's `providers.tsx` (root or `[locale]`,
  role `providers` of `fe.route` in the slot manifest) is the client component a server layout renders around its children to host
  context providers; the directive is accepted there. A providers wrapper kept elsewhere (a layout feature, a module) is still a
  finding, and the message names `providers.tsx` as its home.

## 6.0.1 - 2026-09-30

- **Fix: `no-hand-rolled-polling` refused a shared clock.** A timer is polling only when what it runs reads data - a call whose
  value is a promise (`fetch`, the transport client, a reader, SWR's `mutate()`), an `await`, or a same-file function that does -
  decided by type, not by name. nivo-fe `useNow` (a one-minute tick behind `useSyncExternalStore`) and a state countdown pass; a
  timer that fetches or revalidates is still refused. The self-scheduling `setTimeout` check follows the enclosing function's
  binding, not its spelling. The FE convention names no shared clock owner, so no clock rule is added.

## 6.0.0 - 2026-09-30

- **Census fixes (starci-next-fe main, lane F0):** `one-outcome-union` treats a `kind` union as a result union only with an `ok`
  arm beside a failure kind (a mapper's view union - `LessonViewerView`, `StudyStepView` - is a screen state);
  `client-maps-auth-to-refused` accepts the Outcome constructor named by its kind (`failed("refused", ...)`) and a status branch
  inside a helper whose parameter every call fills with the response status;
  `i18n-stack-in-one-module` lets the proxy of a one-app repository build the locale middleware; `server-module-marks-server-only`
  requires the marker of server modules and of every server reader (role `reader`), not of components (reachability is
  FE_CLIENT_REACHES_SERVER's); `route-tree-holds-routes-only` admits next-intl's root `not-found.tsx` and its root `layout.tsx`.

- **Every law scopes by slot, never by folder regex (lane F0-H).** The path predicates of `class-names`, `props-and-slots`,
  `vendor-boundary`, `loading`, `type-safety`, `typography`, `brand-values`, `formatting`, `comments`, `hygiene`, `translation`,
  `lint-escape-hatch`, `client-boundary`, `file-layout`, `shape-slot`, `the-split`, `landmark`, `icon`, `served-locale`, `e2e-shape`,
  `hooks-folder`, `naming`, `next-conventions`, `tokens`, `size-and-state-budget`, `spec-quality` and `transport` ask the slot view
  (`kind`, `role`, tier, owner, `hfs.allows(file)`, `classifyImport`) instead of testing a path. Shared-package layers (`fe.package.ui`)
  are governed like app components; a file no slot owns is judged by `hfs check` (`HFS_SLOT_UNDECLARED`), not by a folder-name rule.
  Line and hook budgets (`component.tsx`, `index.tsx`, `file`, `useState`, `dataHooks`) are read from the slot manifest.
  `navigation-from-intl` exempts only the `proxy` and `global-error` roles; `no-middleware-file` reads slot `fe.source-root-retired`;
  `route-tree-holds-routes-only` reads the `allows` of `fe.route`; `no-unresolved-token-class` reads the app's route and brand stylesheets.

- New law `status-colors` (R61 `FE_STYLE_TOKEN_ONLY`): `status-text-uses-soft-foreground` refuses a class that paints text, an icon or a
  text decoration with a solid status tone (`text-success`, `fill-danger`, `stroke-warning`, `decoration-info`, with any variant, opacity or
  `!`), read from `className`/`class`, `cn()`/`clsx()` arguments, conditionals, arrays, constants and `classes` entries. The soft pair
  (`text-<tone>-soft-foreground`, `bg-<tone>-soft`), a solid fill with its own ink (`bg-<tone> text-<tone>-foreground`) and solid borders,
  rings and outlines pass. The tones come from `lib/status-tones.generated.mjs`, generated from the grammar by
  `packages/stylelint` (`npm run vocabulary`), never listed in the rule.

- **Breaking: `starciFeConfig({ hfs: loadHfs(import.meta.url) })` replaces `starciFeConfig({ layout })`.** The factory reads the
  repository's `hfs.json` and the shipped slot manifest (`runtime/`, refreshed by `packages/hfs/scripts/sync-runtime.mjs`), lints
  every app's and every workspace package's `src/` with typed linting (`parserOptions.projectService`) and the e2e tree
  syntax-only, ignores build output, `__generated__/` and `.starci/`, and puts the slot view in `settings.starci.hfs`
  (`lib/hfs.mjs` `hfsOf(context)`); `lib/types.mjs` holds the type-aware helpers. `LAYOUTS`/`LAYOUT_GLOBS` are deleted.
- **Breaking: the `lint-adoption` law and its `effective-config` audit are deleted**, with `audits`/`auditOwners`: the
  managed `eslint.config.mjs` one-liner that `hfs check` compares with its render (R17) is the one proof that no rule is off.
- `linterOptions` lives in `lib/config.mjs` only (the copy in `lint-escape-hatch.mjs` is gone).
- New peer dependency `typescript >=5.9`; `@typescript-eslint/parser` is a dependency. Tests build typed cases with
  `fixtures/typed/tester.mjs` (`typedTester`, `slotTester`, `at`).

- **Breaking: `no-direct-heroicon-import` is deleted.** It was a second name for a second copy of
  `no-vendor-icon-outside-icon-leaf` (icon law); one obligation has one rule (redundancy RED20). The copy in
  `vendor-boundary.mjs` is gone; `no-vendor-icon-outside-icon-leaf` is unchanged.
- New law `size-growth` (R20 `HFS_SIZE_GROWTH`): `file-size-growth` refuses a new source file over the line budget and an existing file over it that is longer than at the parent commit. The budget is `ruleParams.fe.fileLines` of the slot manifest, read through the slot view (`hfsOf(context).ruleParams`, the package's own `runtime/` copy) (`packages/hfs/scripts/sync-runtime.mjs` keeps it equal to the runtime's); the rule takes no option.
- **Breaking: `no-internal-starci-href` is deleted.** It was a second, weaker copy of `no-hardcoded-route` (which already refuses a
  route literal in any JSX `href` and any navigation call, specs excluded); one obligation has one rule. `no-hardcoded-route` gained a
  passing case for `mailto:` on `<a>` and a violating case for `<a href="/tasks">`. R93 no longer lists it.
- **Fix: `no-direct-const-alias` fired on `export const generateMetadata = x` in a Next route segment file.** The names Next reserves
  (`generateMetadata`, `metadata`, `viewport`, `dynamic`, ... in `lib/next.mjs`, the list of the architecture machine's
  `NEXT_RESERVED_EXPORTS`) are exempt when the file is a route segment file (slot `fe.route`, stem `page`/`layout`/`template`/...);
  a non-reserved alias in a route file and a reserved name elsewhere still fire. The rule now needs the slot view (`hfsOf`).
- **Fix: `no-barrel-spec` fired on every `index.spec.ts`.** It now reads and parses the sibling `index.ts(x)` and fires only when the
  sibling holds nothing but import and export declarations (a barrel); an `index.ts` with a function, class or value (starci-next-fe
  `modules/browser-storage`) may have its spec, and a missing sibling is no finding. It also covers `.tsx`.
- **Fix: `no-mocked-translations` refused a `next-intl/server` mock that serves the real catalogue.** A server helper has no provider to
  render inside; the mock is allowed when its factory (or a `vi.hoisted` block it reads) uses an import that resolves into the app's
  `modules/i18n/messages/`. Client `next-intl` mocks, literal/key-echoing server mocks and automocks still fire, now with a
  server-specific message (`mockedServer`) naming `createTranslator` over the real messages. The rule needs the slot view (`hfsOf`).
- **Fix: `no-hand-typed-wire` fired on `(await response.json()) as unknown`, the narrowing entry `no-type-assertion` allows.** It now
  fires only when a value read from `.json()` (directly or through a `const`) is asserted or annotated to a type that is not `unknown`
  and not imported from a `__generated__/` module (decided from the file's import declarations). **Breaking:** the `declared` branch
  (a name suffix `Wire|Dto|DTO|Response|Payload` on an interface or alias in `modules/api`) and the `graphqlType` branch (a name
  pattern `GraphQl*`) are deleted; detection by name is not a detection.
- Every rule is catalogued under an HFS rule id (R91 FE_SOURCE_FORM, R92 FE_COMPONENT_API, R93 FE_VENDOR_BOUNDARY added).
- **One client, one Outcome, one i18n stack, grammar components (lane F0-D).**
  - `lib/scope.mjs`: `isConfigModule`, `isApiClient` and the new `isOutcomeModule` are slot questions (`fe.modules.config`, `fe.transport.client` / `fe.package.api.client`, `fe.transport.outcome` / `fe.package.api.outcome`) taking the rule `context`, not path regexes; `PACKAGE_TIERS` is deleted (`use-client-only-at-boundary` asks slot `fe.package.ui` and reads the tier below the package root); `slotOfFile`, `inSlot` and `globalReferences` (scope-resolved globals) are new. Their rule tests run under `slotTester()`/`typedTester()` with `at("apps/web/src/...")` filenames.
  - `fetch-only-in-api-client` resolves the global `fetch` (and `globalThis.fetch`, `window.fetch`, `self.fetch`, aliases, destructuring), `new Request`, `new EventSource`, `navigator.sendBeacon` by scope, and fetch libraries (axios, ky, got, undici, ofetch, graphql-request, urql, `@apollo/*`, `@urql/*`) by module specifier; the one file allowed is slot `fe.transport.client` or `fe.package.api.client`. `client-fetch-has-signal` and `no-shared-transport-state` ask the same slots (the shared api package is covered).
  - `client-maps-auth-to-refused` judges a real branch: the fetch response's status (typed `Response`) compared with 401 and 403 whose consequent builds `kind: "refused"`; three literals anywhere no longer pass.
  - New `one-outcome-union` (R51): a union alias of object types sharing a literal `ok` or `kind` discriminant is declared only in the outcome slot.
  - New `i18n-stack-in-one-module` (R59): `defineRouting`, `createNavigation`, `getRequestConfig`, `createMiddleware` (by import specifier) are called only in slot `fe.package.i18n`, or `fe.modules.i18n` of a one-app repository. `no-second-i18n-stack` stays: it refuses another i18n library, a different obligation.
  - New `no-raw-structural-element` (`grammar-boundary`, R62): raw `h1-h6 p span hr label form fieldset dl dt dd table..th ul ol li header footer nav section main figure figcaption` in app slots and non-`ui` packages; `div br aside article` have no grammar component and stay allowed.

- **Breaking: the timer rule is now `effect-subscription-needs-cleanup`** (`FE_EFFECT_CLEANUP`, no alias). Inside a React `useEffect` / `useLayoutEffect` callback (resolved through the import) and inside a `useSyncExternalStore` subscribe (also when passed by name), every `setTimeout` / `setInterval` handle, `requestAnimationFrame` id, `addEventListener` (target, type, listener), `.observe`d `ResizeObserver` / `IntersectionObserver` / `MutationObserver`, `WebSocket` / `EventSource` / `BroadcastChannel` and subscription object (`unsubscribe` / `off` / `close` in its type) must be released by the returned cleanup against the SAME handle (scope binding or member path), not by any `clearTimeout` in it. The `/modules/` exemption is gone: outside an effect a timer or frame is accepted only when the function that starts it releases it (the 5.1.2 returned-closure acceptance and the API client's `finally` both hold structurally). Typed linting is required.
- **`no-data-fetch-in-effect` sees indirect loads.** A call executed synchronously in the effect body whose value is a promise (`void load()` with `load` async anywhere, an SWR `mutate()` / `refresh()`), is `.then`-ed, or is `void`-ed and untyped is a finding; a promise started inside a listener or timer callback the effect registers is not. The effect is React's export, resolved through the import.
- **New rule `server-module-marks-server-only`** (R55, new code `FE_SERVER_ONLY_MARK`): a module that imports `next/headers`, `next/server`, `next-intl/server`, a Node built-in, or a module that resolves to a file starting with `import "server-only"` must itself start with `import "server-only"`. Route files (slots `fe.route`, `fe.source-root-pinned`) are exempt. `client-no-server-import` also refuses `next-intl/server` and `next/server`.
- **`no-hardcoded-copy` (R58)** reads template literals with substitutions whose static parts hold a word (`${count} installed`) in JSX children and copy attributes, and any object property whose value is a whole sentence under any key (`{ ready: "Your course is ready" }`); class names, URLs, ids, keys, units and format tokens still pass.
- **`no-inline-lint-config` (R18)** also refuses `NOSONAR`, `@sonar-ignore`, `istanbul ignore`, `c8 ignore`, `v8 ignore`, `prettier-ignore` and `stylelint-disable` comments.
- New `lib/bindings.mjs` (scope bindings, imports, stable keys), `lib/platform.mjs` (platform symbols) and `lib/react.mjs` (React exports by import).

## 5.1.2 - 2026-09-30

## 5.1.1 - 2026-09-30

- **Fix: `use-client-only-at-boundary` knew only the app layout.** A workspace package keeps its grammar tiers directly under `src/` (`packages/<pkg>/src/{composites,branches,leaves}`, the `fe.package.ui` slot), but the rule accepted the directive only under `/components/...`, so nivo-fe's `packages/nivo-ui` reported 13 false findings. The tier names come from `PACKAGE_TIERS` in `lib/scope.mjs` (the slot's layers, no repo name); a package branch or leaf is a boundary, a package composite is not, and the app layout is unchanged.
- **Fix: the `monorepo` layout scanned only `packages/ui`.** `LAYOUT_GLOBS.monorepo` named the shared package literally (`packages/ui/src/**`), so a workspace package with any other name (nivo-fe's `packages/nivo-ui`) was governed by no starci-fe rule and a deliberate bare `<img>` there printed nothing. The source glob is now `packages/*/src/**/*.{ts,tsx}` and the e2e glob adds `packages/*/e2e/**/*.{ts,tsx}`; every package is judged by the same rules.

## 5.1.0 - 2026-09-29

Round 2 of the FE enforcers, measured on nivo-fe, starci-next-fe and miamia-fe. Twenty-two rules, every one an error; no rule of 5.0.0 changed. Each is registered in `knowledge/hfs/rules.yaml` under the catalogue rule it enforces, with a Vietnamese failure code.

- **Type safety (R22, `FE_TYPE_ESCAPE`)**: `no-type-assertion` (`as T`, `<T>x`; `as const` and `as unknown` stay), `no-non-null-assertion`, `no-explicit-any`. `no-double-cast` now has a why entry.
- **Lists (R65, `FE_LIST_KEY`)**, new law `lists`: `list-item-has-key`, `no-index-key`, `no-inline-literal-prop-in-list`.
- **Runtime hygiene (R65, R50)**, new law `hygiene`: `effect-subscription-needs-cleanup` (`FE_EFFECT_CLEANUP`), `no-data-fetch-in-effect` (`FE_EFFECT_FETCH`), `no-empty-catch` (`FE_SWALLOWED_ERROR`), `no-console` (`FE_CONSOLE_CALL`).
- **Formatting (R59, `FE_I18N_FORMATTER`)**, new law `formatting`: `use-intl-formatter` (`toLocale*String`, `new Intl.*Format`, displayed `toFixed`, currency glued to a template, date libraries).
- **Next conventions**: `page-exports-metadata` (R54, `FE_PAGE_METADATA_MISSING`), `no-null-suspense-fallback` (R53, `FE_SUSPENSE_NULL_FALLBACK`), `navigation-from-intl` and `no-native-anchor` (R59, `FE_I18N_NAVIGATION`), `no-hardcoded-route` (R57, `FE_ROUTE_HARDCODED`).
- **Client boundary (R55)**: `client-no-server-import` (`FE_CLIENT_SERVER_IMPORT`), `web-storage-only-in-modules` (`FE_STORAGE_OUTSIDE_MODULES`), `no-dangerous-html` (`FE_DANGEROUS_HTML`).
- **Native controls (R62, `FE_NATIVE_IMAGE`)**: `no-native-img`, `image-has-size`.
- **Transport (R51, `FE_OUTCOME_KIND_UNHANDLED`)**: `outcome-kinds-exhaustive`.
- `lib/ast.mjs` holds the JSX attribute, call-name and effect-callback readers the new laws share. One doc page per new law; type-safety gained its page.

## 5.0.0 - 2026-09-29

HFS Phase 0 item 0.6. Breaking: the factory signature, the retired rules and the level of every rule.

- **`starciFeConfig({ layout })`** returns two flat-config blocks (source and e2e) and owns the law: every published rule at `error` (the factory throws if one is not), the React Hooks rules (`eslint-plugin-react-hooks` 7, recommended set lifted to `error`, `set-state-in-effect` and `refs` required), and `linterOptions` (`noInlineConfig` plus `reportUnusedDisableDirectives: "error"`). The `plugin`, `recommended` and `linterOptions` inputs are gone. `eslint-plugin-react-hooks >=7` is a new peer dependency.
- **`vn-ok` is removed entirely.** `no-second-language-in-source` and `no-hardcoded-copy-in-vocabulary` are replaced by `no-hardcoded-copy` (R58): no literal copy at any tier, in any language, no pragma, no endonym or `resources/` exemption. Same notion of literal as nivo-fe's `check-i18n-catalog.mjs` (a word is two or more letters). A `vn-ok:` comment is now itself a finding of `no-inline-lint-config`, which also refuses `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-env` and inline `eslint rule:` config, and now covers specs and the e2e tree.
- New laws and rules: `env-owner` (R49: `no-env-outside-config`, `no-hardcoded-endpoint-fallback`), `transport` (R50-R52: `fetch-only-in-api-client`, `client-fetch-has-signal`, `no-shared-transport-state`, `client-maps-auth-to-refused`, `no-http-status-collapse`, `no-hand-typed-wire`), `client-boundary` (R55: `use-client-only-at-boundary`), `hooks-folder` (R56 lint half: `hooks-folder-holds-hooks-only`), `next-conventions` (`no-middleware-file`, `locale-segment-is-locale`, `no-second-i18n-stack`, `html-lang-from-locale`), `brand-values` (R61 TypeScript half: `no-raw-brand-value`), `native-controls` (R62: `no-native-form-control`), `size-and-state-budget` (R65: `component-line-budget`, `unit-hook-budget`, `no-hand-rolled-polling`), `e2e-shape` (R66, seven rules on `e2e/**` and `playwright.config.*`), `spec-quality` (R67 and the real-catalogue half of R60: six rules).
- `sourceRecommended` and `e2eRecommended` are exported beside `recommended` (their union); the effective-config audit compares a production probe against `sourceRecommended`.
- `why[rule]` is `{ code, vi, fixVi }`: the catalogue finding code and the Vietnamese why for every rule of the catalogued laws.
- One doc page per law under `docs/`.
