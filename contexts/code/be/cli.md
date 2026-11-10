---
slots: [be.app.cli, be.app.client-cli, be.app.client-cli.package, be.cli, be.client-cli, repo.app-image]
---
# Cli

Where a command line lives: a cli app on nest-commander whose commands sit in its own feature root, laid out as groups and
sub-commands, thin and unit-tested. A back end has one ops cli for its one-off actions (migrate, seed, sync, cleanup, an
operator command) and one client cli for each command line a user installs. That migrations run only through the ops cli
is BE-PERSISTENCE-2.

## BE-CLI-1 The one ops cli app boots nest-commander and never serves

Every one-off action runs in `be/apps/cli`, the only app of kind `cli`, with its own image run as `cli <group> <command>`;
it never ships to a user. `main.ts` reads the environment once and calls `CommandFactory.run(AppModule.register(...), {
logger: createNestLogger(logger), errorHandler })`, the error handler printing the failure on stderr and exiting non-zero;
it never turns the logger off, since a provider the root does not compose then ends every command silently, and it never
creates an HTTP app or listens. `app.module.ts` composes the platform modules the commands need and `CliModule`; its env,
options and compose groups follow BE-ARCHITECTURE-2. A client cli (BE-CLI-5) boots the same way.

Why: one image for every operator action gives one place to find, deploy and audit them, and a process that never
listens cannot become an unguarded door.

Enforced by: `cli-bootstrap` (R148), R147, R376 (`boot-logger`: no `logger: false` in an app root's main), and the boot proof R272.

## BE-CLI-2 Commands are groups and sub-commands under the feature root of their cli app

The ops cli keeps its commands in `src/features/cli/`: `index.ts` (exporting `CliModule`) and `cli.module.ts`. A client
cli keeps its own in `src/features/client-cli/<app>/`: `index.ts` (exporting `<App>Module`) and `<app>.module.ts`. Either
root module imports each group as `<Group>Module.register({})`, and per group the root holds `<group>/<group>.cli.ts` (the
`@Command` listing its `subCommands`, whose own `run` shows help), `<group>/<group>.module.ts` with its definition and
options, and `<group>/subs/<name>.cli.ts` (a `@SubCommand` extending `CommandRunner`), one command per file, each with its
`.cli.spec.ts` beside it. A command reads its flags through its own `@Option`. A cli app composes its own root and no
other.

Why: the command line `<bin> <group> <command>` maps to one file path, so a command and its spec are found from the name,
and a root per app keeps the commands of one audience out of the build of the other.

Enforced by: `cli-command-shape`, `unit-test-colocated` (R149), `module-definition-required` (R295), R45 (an app composes
only the root its kind composes).

## BE-CLI-3 A command delegates once and is unit-tested

`run` maps its options and makes one delegating call into the modules (a runner of `platform/database` or a domain
service for an ops command, an integration client for a client command), with no branch, loop, `try` or computation. Its
spec builds it through the testing module with a `mock<T>()` of the delegate and asserts the call and the result. A
command never imports an api feature, and a writing command is safe to re-run or refuses a second run.

Why: an operator action runs against production data, often once, on a path nothing else exercises.

```ts
@SubCommand({ name: "run", description: "Apply the pending migrations" })
/** `cli migrate run`: delegates to the one migration runner. */
export class RunCli extends CommandRunner {
    constructor(private readonly migrations: MigrationRunnerService) {
        super()
    }

    /** Runs the migrations and propagates their failure. */
    async run(): Promise<void> {
        await this.migrations.run()
    }
}
```

Enforced by: `feature-thin` (R203), `cli-command-shape` (R149), `spec-placement` (R102).

## BE-CLI-4 Only a cli app parses the command line

`nest-commander` is imported only by the cli apps and their feature roots; `process.argv`, `commander`, `yargs` and
`minimist` are imported nowhere.

Why: a flag read in an api `main.ts` is an operator door no review sees and no spec covers.

Enforced by: `cli-owner` (R150).

## BE-CLI-5 A client cli is its own app, published to npm

A command line a user installs and runs on their own machine is an app of kind `client-cli`, declared in `hfs.json` with
the npm package it is published as and the command it installs: `{ "name": "<app>", "kind": "client-cli", "package":
"<npm name>", "bin": "<command>" }`, with `client-cli` among `sides.be.kinds`. It is the client of a server app: its
commands call the server through an integration client (`modules/integrations/<provider>`) and compose platform
capabilities only. It imports no domain, events, queues or projections module, nothing of `platform/database` or of a
persistence folder, no `typeorm`, `@nestjs/typeorm` or `pg`, and no feature of another kind, the ops root `features/cli`
included.

It ships as a package, never as an image: `be/apps/<app>/` tracks no Dockerfile and holds `package.json` (that name, `bin`
`{ "<command>": "dist/apps/<app>/src/main.js" }`, not private, `files` `["dist"]`, a version, its runtime dependencies at
the versions the app root pins) and `tsconfig.build.json` (extends `../../tsconfig.build.json`; `outDir` `./dist`,
`rootDir` `../..`, `files` `["src/main.ts"]`, `include` `[]`), with an optional `README.md`. `npm run build:<app>`, which
`starci app sync` renders, compiles the import closure of its `main.ts` into `be/apps/<app>/dist/`, and the package is
packed and published from `be/apps/<app>` (`npm pack`, `npm publish`); the root `cli`, `migrate`, `start:*` and
`docker:build*` scripts and the images workflow never name it.

Why: what reaches a user's machine must hold nothing of the server, so the audience is a kind of app, with its own root,
build and manifest, and the ops commands cannot ride along in its package.

Enforced by: R397 (the declaration, the feature root, the manifest and the build config), `cli-client-boundary` (R398),
R156 (no feature of another kind), R45 (it composes only its own root). That the package lists every dependency its
closure needs, and its publication, are held by review: the harness publishes no app package.
