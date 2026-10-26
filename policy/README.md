# Policy

Which gates run where, and how they are configured. Policy selects and configures; it never restates a rule. What a
gate or marker detects is code (`cli/src/core/check/`, `cli/src/shared/secrets.ts`), and the lint and config rules
live in the canon packages ([packages/](../packages/README.md)). The CLI validates every file here when it reads it.

| file | holds | read by |
|---|---|---|
| [quality.yaml](quality.yaml) | the two gate tiers, the profiles, the default profile of each kind of tree, and `requireCi` | `check run`, `task verify`, the actions `requireCi` lists |
| [canon.yaml](canon.yaml) | the canon package of each stack and tool, by npm name | the `canon` gate |
| [loosening.yaml](loosening.yaml) | the banned loosening markers, the scan bounds and the declared exceptions | `check loosening` |
| [security.yaml](security.yaml) | the secret scan's configuration: sops envelopes per profile, `neverRead`, exceptions | `check secrets`, `release push` |

## Tiers

- **Runtime tier**: `starci check run` before a push and `task verify` on the clean checkout run it, scoped to what
  changed, each process bounded by `stepTimeoutSeconds`.
- **CI tier**: CI runs it on main after the push. Nobody waits for it, except the actions `requireCi` lists, which
  refuse `CI_NOT_GREEN` unless `starci release ci-status` of their commit is green. A deliver contract that ships main
  waits for CI with the `ci-green` check preset ([ops/checks.yaml](../ops/checks.yaml)).

A gate name the CLI does not implement is refused when the file is read.

## Profiles and project overlays

A project picks its profile in its `hfs.json` (`"policy": "<profile>"`); without one, `defaults` in `quality.yaml`
chooses by the kind of tree. `starci doctor` prints the profile and why.

A project may carry its own `policy/loosening.yaml` and `policy/security.yaml` at its repository root. An overlay only
tightens: it bans more markers, adds `neverRead` globs and declares its own exceptions, each one file, one marker or
rule, and the reason. It never unbans, and a project that carries `quality.yaml` or `canon.yaml` is refused
(`POLICY_OVERLAY_REFUSED`).
