---
slots: [be.app.cli, be.cli, repo.app-image]
---
# Cli

Where a one-off action (migrate, seed, sync, cleanup, an operator command) lives: a command of the one cli app, laid
out as groups and sub-commands, thin and unit-tested. That migrations run only through it is BE-PERSISTENCE-2.

## BE-CLI-1 One cli app boots nest-commander and never serves

Every one-off action runs in `be/apps/cli` (kind `cli`), with its own image run as `cli <group> <command>`. `main.ts`
reads the environment once and calls `CommandFactory.run(AppModule.register(readCliEnv(env)), { logger: false,
...createCliFailureHandlers(logger) })`; it never creates an HTTP app or listens. `app.module.ts` composes the platform
modules the commands need and `CliModule`; its env, options and compose groups follow BE-ARCHITECTURE-2.

Why: one image for every operator action gives one place to find, deploy and audit them, and a process that never
listens cannot become an unguarded door.

Enforced by: `cli-bootstrap` (R148), R147.

## BE-CLI-2 Commands are groups and sub-commands under `features/cli`

`src/features/cli/` holds `index.ts` (exporting `CliModule`), `cli.module.ts` importing each group as
`<Group>Module.register({})`, and per group `<group>/<group>.cli.ts` (the `@Command` listing its `subCommands`, whose own
`run` shows help), `<group>/<group>.module.ts` with its definition and options, and `<group>/subs/<name>.cli.ts` (a
`@SubCommand` extending `CommandRunner`), one command per file, each with its `.cli.spec.ts` beside it. A command reads
its flags through its own `@Option`.

Why: the command line `cli <group> <command>` maps to one file path, so a command and its spec are found from the name.

Enforced by: `cli-command-shape`, `unit-test-colocated` (R149), `module-definition-required` (R295).

## BE-CLI-3 A command delegates once and is unit-tested

`run` maps its options and makes one delegating call into the modules (a runner of `platform/database`, a domain
service), with no branch, loop, `try` or computation. Its spec builds it through the testing module with a `mock<T>()`
of the delegate and asserts the call and the result. A command never imports an api feature, and a writing command is
safe to re-run or refuses a second run.

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

## BE-CLI-4 Only the cli parses the command line

`nest-commander` is imported only by `be/apps/cli` and `src/features/cli/`; `process.argv`, `commander`, `yargs` and
`minimist` are imported nowhere.

Why: a flag read in an api `main.ts` is an operator door no review sees and no spec covers.

Enforced by: `cli-owner` (R150).
