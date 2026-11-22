// env.mts - the one place the runtime reads a named environment variable (smell S8-01/S8-02/S11-04; scripts/checks/check-env.mjs).
// modules/schemas/env.yaml catalogues every variable with its purpose and kind. Production code reads a variable here
// (readEnv) or takes an injected `env` parameter; it never reads `process.env.NAME` itself. The test runner is observed
// in exactly one place, isSpecRun: code that must not touch the host's real state during a spec asks it.

/** The value of the environment variable `name` in `env` (default: the process environment), or undefined. */
export const readEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string | undefined => env[name];

/**
 * The executable search path of `env` (default: the process environment), or ''. Windows spells the variable `Path`, and a plain copy of
 * process.env (`{ ...process.env }`, the env a verb or a spec hands down) keeps that spelling with case-sensitive keys, so `env.PATH` of the copy
 * is undefined: `PATH` is read first, else the key that is `path` in any case.
 */
export const readPath = (env: NodeJS.ProcessEnv = process.env): string => {
  const key = env.PATH === undefined ? Object.keys(env).find((name) => name.toLowerCase() === 'path') : 'PATH';
  return key === undefined ? '' : String(env[key] ?? '');
};

/** `env` as a copy whose search path is `value` under the one key `PATH`: every other spelling is dropped, since a Windows child handed both `Path` and `PATH` takes either. */
export const withPath = (env: NodeJS.ProcessEnv, value: string): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(env).filter(([name]) => name.toLowerCase() !== 'path')),
  PATH: value,
});

/** True when `env` (default: the process environment) belongs to a spec run (`node --test` marks its children with NODE_TEST_CONTEXT). */
export const isSpecRun = (env = process.env) => Boolean(env.NODE_TEST_CONTEXT);

/**
 * The environment for a child that is itself a test runner: `env` without the mark of an enclosing spec run. A `node --test` that inherits NODE_TEST_CONTEXT believes it is a
 * subtest of that run: it reports to its parent and exits 0 whatever its tests did, so a verb that runs specs as a child (the package clean-test, the scaffold e2e, the release cut)
 * would pass red specs from inside a test process. The runner marks the spec files it starts itself, so isSpecRun stays true inside them.
 */
export function withoutTestRunner(env = process.env) {
  const rest = { ...env };
  delete rest.NODE_TEST_CONTEXT;
  return rest;
}
