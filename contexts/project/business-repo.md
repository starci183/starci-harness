# A business repository

How one business is built on StarCi: one repository that holds the business's own services as an app, the business package its agents run from, and the seed standard that gives a new environment its data. This page owns the template; the rule that holds it is R436 ([hfs/rules.yaml](../hfs/rules.yaml)), the slot is `app.nivoos-package` ([hfs/slots.yaml](../hfs/slots.yaml)) and the lint profile is the SDK authoring profile of `@starci/eslint-canon-be` ([packages/README.md](../../packages/README.md)).

## PROJECT-BUSINESS-1 A business is one repository: an app, its nivoos package and its seed standard

A business is **one repository**, and everything it runs lives there:

| part | what it is | where | judged by |
|---|---|---|---|
| the app | the business's own services (a CRM, an API, a worker) as a StarCi app: its `be/` (and `fe/`), stack, CI and hooks ([edition.md](edition.md)) | `be/`, `fe/`, `.starcistacks/` | `starci app check`, the canon of its side |
| the nivoos package | what the business's agents run from, authored with the nivoos SDK: agents, workflows, cells, steps, brain documents, accounts and the seed document `nivoos package build` writes | `packages/<name>/` | the SDK authoring lint profile, `nivoos package check` |
| the seed standard | how a new environment is born: the business's reference data, plain and pinned by commit (PROJECT-STACKS-13) | the repository `<project>-seed-standard`, named by `data.sets` of the stack declaration | the data rules R400 to R435 |

The platform holds no business logic: a business that writes its package in its own repository and deploys it with `nivoos package deploy` runs. The package is a **root workspace package** ([README.md](README.md) PROJECT-3) that no side imports and that has no unit specs of its own; the nivoos CLI proves it. A repository may hold several packages (one business, several workspaces), each declared by name.

### Layout

```text
<business>/
  hfs.json                     sides.be (+ fe) and sides.nivoos
  be/ fe/                      the app: the business's own services
  packages/<name>/             one nivoos package (slot app.nivoos-package)
    package.json               name, scripts, nivoos SDK and CLI dependencies
    tsconfig.json              extends @starci/tsconfig
    src/<name>.package.ts      the entry: `export default { package, cells, workspaces } satisfies Package`
    src/agents/<agent>/        <agent>.agent.ts, <flow>.workflow.ts, <flow>.cell.ts, steps/<step>.step.ts, <agent>.guidance.ts
    src/accounts/              <account>.account.ts
    src/brain/                 the brain documents (*.md) and the brain index
    seed/<name>@<version>.json the seed document `nivoos package build` writes (committed)
    secrets.env.template       the secret names the package asks for (committed, no value)
    dev/deploy.mjs             optional: the deploy of the package into a nivoos workspace
  .starcistacks/ ...           the app's stack; data.sets pins the seed standard
```

One class per cell, step, event kind, brain document, agent, workflow and workspace is the SDK's own convention; the layout inside `src/` is the package's, and the slot holds no folder of it.

### The declaration

`hfs.json` of the business names each package. To use its SDK, CLI or provider templates in another repository before a release, it also lists their folders in `publishes` (`"publishes": ["packages/nivoos-sdk"]`), and `starci deps publish-local --execute` puts exactly those on the local registry ([authority/packages.md](../authority/packages.md) "An app's own packages"). `nivoos` is a declaration over the `packages/` folder, not a folder of its own, so it implies the packages side; nothing else of the declaration changes.

```json
{
  "hfs": 3,
  "kind": "app",
  "project": "nivo-web-lite",
  "sides": {
    "be": { "apps": [{ "name": "api", "kind": "api", "contract": "rest" }], "kinds": ["api"] },
    "nivoos": { "packages": [{ "name": "nivo-web" }] }
  }
}
```

Each entry is `{ name, entry?, out? }`: `name` is the folder `packages/<name>/` (kebab-case, one entry per folder), `entry` the package entry the SDK builds (default `src/<name>.package.ts`) and `out` the folder its seed is built into (default `seed`), both relative to the package. The name `nivoos` follows the SDK that authors the package, as `be` and `fe` follow the folders they hold; a business with no package declares none.

A folder of `packages/` that depends on the SDK (`@nivoos-lite/nivoos-sdk`, `@nivoos/sdk`) or its CLI (`nivoos`) and is not declared is `HFS_NIVOOS_UNDECLARED`; a declared package whose `package.json`, `tsconfig.json` or entry is not tracked is `HFS_NIVOOS_PACKAGE_MISSING` (R436, `runtime/scripts/hfs/rules/nivoos.mts`). A package at the app root, outside `packages/`, is no package of any slot: `HFS_ROOT_ENTRY_FORBIDDEN`, `HFS_SERVICE_PLACEMENT` and `HFS_SLOT_UNDECLARED` refuse it, as they refuse any folder with a manifest of its own.

### The lint profile

A declared package is the slot `app.nivoos-package`, and the slot's `lintProfile: nivoos` hands its source (`packages/<name>/src/**`) to the SDK authoring profile: the same canon as every root package, less what an SDK package cannot satisfy. The profile is chosen by the slot, never by a comment in a file (`noInlineConfig`), and the same code in a folder the project does not declare is judged by the whole back-end canon. `lib/nivoos-profile.ts` of `@starci/eslint-canon-be` holds the profile and each reason; the findings below are those of the worked case, `nivo-web` (508 findings under the plain canon, 96 under the profile, all of them source to fix).

| rule | under the profile | why | findings it held |
|---|---|---|---|
| `no-non-ascii-source` | not applied: Vietnamese is expected in a business package, in literals and comments alike (an emoji too) | the rule keeps source prose English for a reader who does not share the author's language; the readers of a business package share it, and its copy (titles, labels, prompts, guidance, brain) is Vietnamese. Identifiers stay ASCII by the package convention (one class per node, named for its key); the canon has no other rule for it | 56 (46 literals, 10 comments) |
| `no-default-export` | allowed in the entry `src/<name>.package.ts` only | the SDK loads the package by its default export | 1 (the entry; `index.ts` re-exporting it stays) |
| `explicit-export-surface` | not applied | nothing imports a package's source (the nivoos CLI loads the entry), the SDK's interfaces type every member, and the SDK's idioms (`extends NodeRun(Cell)<typeof State>`, `typeof` of an exported schema, `export default ... satisfies Package`) cannot be annotated | 186 |
| `require-public-member-jsdoc` | not applied | the public members of a cell, step or agent are the SDK interface's fields; the class JSDoc (`require-export-jsdoc`, kept) says what the node is for | 152 |
| `job-shape` | not applied | the canon's `<step>.step.ts` is the jobs capability's file kind; the SDK's `.step.ts` is a workflow step of the same suffix, and a package has no jobs capability | 17 |
| `throw-domain-error` | not applied | an SDK node fails by throwing an `Error` whose message starts with a snake_case code that the platform records; `DomainError` of `@starci/common` is not a dependency of an SDK package | 10 |

Everything else stays an error, and the findings left are real source: `schema-bounded` (a zod string without `.max(n)`; the shapes of a CRM answer bound at the CRM's real limits), `require-export-jsdoc`, `no-inline-object-type`, `array-type`, `no-duplicate-import`, `prefer-at`. A relaxation is added only with the finding that shows it, the reason the rule's purpose does not hold for SDK code and a spec in `nivoos-profile.spec.ts`; a rule that merely annoys stays.

Coverage follows the slot: a declared package has no unit specs and is measured at nothing, since `nivoos package check` is its proof. `starci app sync` therefore treats it as no library package: it is not a jest project in the rendered `be/jest.config.js`, not a path or a component of `codecov.yml`, not a `sonar.sources`, `sonar.tests` or `sonar.typescript.tsconfigPaths` entry of `sonar-project.properties`, and not a `build:modules` or `dev:be` watch entry of `package.json` (`libraryPackageFolders`, `sync/index.mts`); a library package beside it keeps all of them. Including it as a project of its own was refused: it would be a measured scope with every file excluded (a Codecov component over nothing, a Sonar test root with no spec) and a Sonar analysis that needs the SDK installed, which CI cannot resolve while the SDK is linked (the known gap below). Its source stays linted (the managed root `eslint.config.mjs` reaches it) and `nivoos package check` stays its gate. Its scripts are `typecheck`, `check` and `seed`; a script named `build` would be run by `build:modules` (`turbo run build --filter=./packages/*`) and rewrite the seed on every build.

### The check

`starci app check` runs, in its `checks` step beside the project checks (R402) and wherever the hfs gate runs, `nivoos package check <entry> --out <out>` for each declared package, from the package folder, with the Node that runs the check, through the heavy governor. The nivoos CLI type-checks the entry under the package's own `tsconfig.json`, loads it, builds the seed document in memory and fails when the committed seed or secrets template differs from that build, which is the whole proof that what is committed is what the code builds. A red package is `HFS_NIVOOS_PACKAGE_CHECK` naming the package, the exit and the last lines of the output (R436, `cache/nivoos-package-check.mts`); its verdict is never cached. The CLI is the package's own devDependency (`nivoos`), found in `packages/<name>/node_modules` and then in the app root's; when it is not installed the finding says so and how to add it, and nothing runs.

The seed is committed exactly as `nivoos package build` writes it, so it is never formatted: `starci app sync` renders each declared package's seed folder (`packages/<name>/<out>/`, `out` defaults to `seed`) into the managed `.prettierignore`, which is the file `HFS_FORMAT` and `npm run format` read, or the check would see a difference at the first reformatted character.

### Starting a business

There is no scaffold flag for a package yet: `starci app scaffold <name>` writes the app, and the package is added by hand.

1. Scaffold the app: `starci app scaffold <business>`; it writes `hfs.json`, `be/`, `.starcistacks/` and the managed files.
2. Create `packages/<name>/` with `package.json` (the SDK and zod pinned, `nivoos` and `@starci/tsconfig` in devDependencies, scripts `typecheck`, `check`, `seed`), a `tsconfig.json` extending `@starci/tsconfig` and the entry `src/<name>.package.ts`.
3. Declare it: add `"nivoos": { "packages": [{ "name": "<name>" }] }` to `sides` of `hfs.json`, then `starci app sync --execute` (the root files that follow from a root package: `eslint.config.mjs`, the workspace entry, the coverage scope).
4. Write the package against the SDK; run `npm run seed` to write `seed/<name>@<version>.json` and commit it; `starci app check` proves it.
5. Seed data goes in the business's seed standard, never in this repository (PROJECT-STACKS-13); the package's seed document is the package's own build output, not business data.

To move a package in from another repository (the way `nivo-web` came from the platform checkout): copy it to `packages/<name>/` with its history, declare it as above, set its seed script to the raw build, rebuild the seed once and fix the findings the profile leaves.

Known gap: while the SDK and CLI are not published, a package links them with `file:` dependencies on a sibling checkout (lane `sdk-external`), which `npm ci` at the root cannot resolve in CI, and the root `workspaces` entry `packages/*` includes the package. Until they are published a business installs the package on its own and keeps CI's install out of it; no harness rule judges that yet.
