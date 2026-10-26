---
slots: [be.app.cli, be.cli]
files:
  - path: apps/cli/Dockerfile
    slot: repo.app-image
    optional: true
    role: the one cli image, run as `cli <group> <command>`
    rules:
      - BE_CLI_REQUIRED
  - path: apps/cli/src/main.ts
    slot: be.app.cli
    optional: true
    role: CommandFactory.run(AppModule, logger); never serves
    rules:
      - BE_CLI_BOOTSTRAP
      - BE_ENTRYPOINT_ONLY_IN_APPS
  - path: apps/cli/src/app.module.ts
    slot: be.app.cli
    optional: true
    role: composes the platform modules and CliModule; no business code
    rules:
      - BE_APP_COMPOSITION_ONLY
      - BE_CLI_BOOTSTRAP
  - path: apps/cli/src/cli.options.ts
    slot: be.app.cli
    optional: true
    role: env-derived values and port bindings without parsing, the connection list it migrates among them
    rules:
      - BE_CLI_REQUIRED
      - BE_SCHEMA_AUTHORITY
  - path: apps/cli/src/cli.env.ts
    slot: be.app.cli
    optional: true
    role: 'exports interface CliEnv and readCliEnv(env: EnvSource): CliEnv; fail-fast parsing only, no localhost fallback, logic, composition, business code or feature imports; secrets use env.secret with _FILE first'
    rules:
      - BE_CONFIG_OWNER
      - BE_APP_OPTIONS_COMPOSITION
      - BE_APP_COMPOSITION_BUDGET
  - path: src/features/cli/index.ts
    slot: be.cli
    optional: true
    role: exports CliModule to the cli app
    rules:
      - BE_PUBLIC_SURFACE
  - path: src/features/cli/cli.module.ts
    slot: be.cli
    optional: true
    role: the static cli feature root module; imports each group module
    rules:
      - BE_CLI_COMMAND_SHAPE
      - BE_MODULE_SHAPE
  - path: src/features/cli/migrate/migrate.cli.ts
    slot: be.cli
    optional: true
    role: the migrate group @Command and its subCommands
    rules:
      - BE_CLI_COMMAND_SHAPE
      - BE_CLI_OWNER
    spec: src/features/cli/migrate/migrate.cli.spec.ts
  - path: src/features/cli/migrate/migrate.module.ts
    slot: be.cli
    optional: true
    role: "the static migrate group module: provides its command and sub-commands"
    rules:
      - BE_CLI_COMMAND_SHAPE
      - BE_MODULE_SHAPE
  - path: src/features/cli/migrate/subs/run.cli.ts
    slot: be.cli
    optional: true
    role: "`cli migrate run`: one delegating call on the migration runner of `platform/database`, the one runner of the schema"
    rules:
      - BE_CLI_COMMAND_SHAPE
      - BE_SCHEMA_AUTHORITY
    spec: src/features/cli/migrate/subs/run.cli.spec.ts
  - path: src/features/cli/seed/seed.cli.ts
    slot: be.cli
    optional: true
    role: the seed group @Command and its subCommands
    rules:
      - BE_CLI_COMMAND_SHAPE
      - BE_CLI_OWNER
    spec: src/features/cli/seed/seed.cli.spec.ts
  - path: src/features/cli/seed/seed.module.ts
    slot: be.cli
    optional: true
    role: "the static seed group module: provides its command and sub-commands"
    rules:
      - BE_CLI_COMMAND_SHAPE
      - BE_MODULE_SHAPE
  - path: src/features/cli/seed/subs/run.cli.ts
    slot: be.cli
    optional: true
    role: "`cli seed run [--env <name>]`: one delegating call on the seed runner of `platform/database`"
    rules:
      - BE_CLI_COMMAND_SHAPE
    spec: src/features/cli/seed/subs/run.cli.spec.ts
  - path: src/features/cli/<group>/<group>.cli.ts
    slot: be.cli
    role: the group @Command and its subCommands
    template: cli/group.cli.ts.tpl
    rules:
      - BE_CLI_COMMAND_SHAPE
      - BE_CLI_OWNER
  - path: src/features/cli/<group>/<group>.cli.spec.ts
    slot: be.cli
    role: the unit spec of the group, beside it
    template: cli/group.cli.spec.ts.tpl
  - path: src/features/cli/<group>/<group>.options.ts
    slot: be.cli
    template: cli/group.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/cli/<group>/<group>.module-definition.ts
    slot: be.cli
    template: cli/group.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/cli/<group>/<group>.module.ts
    slot: be.cli
    role: "the static group module: provides its command and sub-commands"
    template: cli/group.module.ts.tpl
    rules:
      - BE_CLI_COMMAND_SHAPE
      - BE_MODULE_SHAPE
  - path: src/features/cli/<group>/subs/run.cli.ts
    slot: be.cli
    role: the first sub-command of the group; one delegating call on the injected runner service
    template: cli/sub.run.cli.ts.tpl
    rules:
      - BE_CLI_COMMAND_SHAPE
  - path: src/features/cli/<group>/subs/run.cli.spec.ts
    slot: be.cli
    role: the unit spec of the sub-command, beside it
    template: cli/sub.run.cli.spec.ts.tpl
---
# Cli

Decides where a one-off action (migrate, seed, sync, backup, an operator command) lives: a command of the one cli app, laid out as
groups and sub-commands, thin and unit-tested. That migrations run only through it is persistence.md (BE-PERSISTENCE-2); its env
reader follows config.md.

## BE-CLI-1 One cli app boots nest-commander and never serves
Every one-off action runs in one app, `be/apps/cli` (kind `cli`), required as soon as the back end declares a connection or tracks
a command, with its own image run as `cli <group> <command>`. `main.ts` boots with `CommandFactory.run(AppModule, logger)` and
never serves: no `NestFactory.create*`, `.listen()`, microservice connection or platform adapter. `app.module.ts` composes the
platform modules the commands need (the database capability over every connection, BE-PERSISTENCE-11) and the static
`CliModule`. Its `cli.env.ts`, `cli.options.ts` and compose groups follow BE-ARCHITECTURE-2 and BE-CONFIG-1; the options carry
the connection list it migrates.

Why: one image for every operator action gives one place to find, deploy and audit them, and a process that never listens cannot
become a second, unguarded door.

- Entry:
  ```ts
  async function bootstrap(): Promise<void> {
      const env = EnvSource.fromProcess()
      const options = createCliAppOptions(readCliEnv(env))
      await CommandFactory.run(AppModule.register(options), new JsonLinesLogger())
  }
  void bootstrap()
  ```

Enforced by: R147 BE_CLI_REQUIRED, R148 BE_CLI_BOOTSTRAP.

## BE-CLI-2 Commands live in the cli feature root as groups and sub-commands
`@Command` and `@SubCommand` are declared only under `src/features/cli/`: `index.ts`, `cli.module.ts` and per group
`<group>/<group>.cli.ts` (the group `@Command` with its `subCommands`), `<group>/<group>.module.ts` and
`<group>/subs/<name>.cli.ts` (a `@SubCommand` extending `CommandRunner`), one command per file. Every module there has its module
definition and options (BE-ARCHITECTURE-3) and no `register` override; `CliModule` imports each group as
`<Group>Module.register({})`. A command takes its options from its own `@Option` (`cli seed run --env <name>`). The suffix is
`.cli.ts` because `.command.ts` is the CQRS message.

Why: a fixed layout maps the command line `cli <group> <command>` to one file path, so a command and its spec are found from the
name alone.

Enforced by: R149 BE_CLI_COMMAND_SHAPE, R295 BE_MODULE_DEFINITION_MISSING.

## BE-CLI-3 A command is an action runner with its own unit spec
`run` maps the command line and makes one delegating call into the modules (a runner service such as the migrate and seed runners
of `platform/database`, a domain service or a platform capability), with no branch, loop, `try`, `throw` or computation. It is
exempt from the transport-shape law but owes `<name>.cli.spec.ts` beside it, built like a service spec, asserting the delegation;
its slot is never a coverage target. A command never imports an api feature; what it shares with a request lives in a domain
capability. A command that writes is safe to re-run or refuses a second run explicitly.

Why: an operator action runs against production data, often once, on a path no e2e exercises, so the unit spec is the only
automatic proof that it hands its inputs to the right module.

Enforced by: R203 BE_FEATURE_THIN, R149 BE_CLI_COMMAND_SHAPE, R102 BE_SPEC_PLACEMENT.

## BE-CLI-4 Only the cli parses the command line
`nest-commander` is imported only by `be/apps/cli` and `src/features/cli/`. No source parses arguments itself: `process.argv` and
argument-parser libraries are refused everywhere, the cli included.

Why: a flag read in an api `main.ts` or a script beside the source is an operator door no review sees and no spec covers.

- When an api `main.ts` reads `--seed` to seed before listening → the seed is `cli seed <name>`, run as its own job.

Enforced by: R150 BE_CLI_OWNER.
