# CI deploy runner (GitHub Free plan)

This runner deploys an app from CI without GitHub ever holding an age key or an opened value (owner, 2026-11-21). It exists because a private repository on the Free plan has no Environment secrets or rulesets, so the managed `stack-deploy.yml` (which needs `SOPS_AGE_KEY` in an Environment) cannot run there.

```
push v* ──► deploy-runner.yml ──ssh (forced command)──► starci-deploy-gate ──sudo (one rule)──► starci-deploy-run (root)
                                  "deploy <app> <env> <tag>"     checks the request              fetch tag (read-only repo key)
                                                                  logs it                         npm ci (pinned Node)
                                                                                                  image digests (the job's GITHUB_TOKEN on stdin)
                                                                                                  starci app stack deploy --execute
                                                                                                  (server's own age key, /root/.config/sops/age/keys.txt)
```

| file | where it goes |
|---|---|
| `starci-deploy-gate` | `/usr/local/sbin/`. It is the forced command of `starci-runner`'s key, and it admits only `deploy <app> <env> <vX.Y.Z>` (exit 126 otherwise, without echoing the request). |
| `starci-deploy-run` | `/usr/local/sbin/`, root. It checks its arguments again, then holds one deploy at a time per server (`flock /run/starci-runner.lock`). |
| `install.sh` | Run as root: `base`, `app`, `repo-key`, `registry-token`, `ci-key`, `status`, `uninstall`. Secrets arrive only on stdin. |
| `deploy-runner.yml` | The app's `.github/workflows/`. It triggers only on a push of `v*`. |

## Install (each step's undo is `install.sh uninstall`)

```sh
L='<root-capable ssh login>'
ssh $L 'cat > /tmp/starci-runner-install.sh' < install.sh                   # the script once; each step below feeds its own stdin
ssh $L 'sudo -n bash /tmp/starci-runner-install.sh base'                    # (STARCI_RUNNER_LOCAL=<dir> installs the gate and runner from a local copy)
ssh $L 'sudo -n bash /tmp/starci-runner-install.sh app <app>' < <app>.conf  # REPO_URL, IMAGE_PREFIX, SERVICES_staging, SERVICES_production
gh repo deploy-key add <pub> --repo <owner/app> --title <server>-runner     # READ-ONLY (never --allow-write); its private half:
... | ssh $L 'sudo -n bash /tmp/starci-runner-install.sh repo-key <app>'     # on stdin, from memory
# registry: none needed; the CI job sends its own GITHUB_TOKEN (packages: read) on stdin. registry-token <app> is the optional fallback file.
... | ssh $L 'sudo -n bash /tmp/starci-runner-install.sh ci-key <app>'       # the CI key's PUBLIC half; its private half goes to gh secret set RUNNER_SSH_KEY
```

`SERVICES_<env>` lists `service=image[:suffix]` words. For example, `web=web:-staging` reads `<prefix>web:sha-<sha>-staging`, which is the staging web image `deploy-runner.yml` builds with the staging build arguments.

## Logs (for the owner, after the fact)

| file | what it records |
|---|---|
| `/var/log/starci-runner/gate.log` | every admitted and refused request (time, client IP, words) |
| `/var/log/starci-runner/runs.log` | one verdict line per run (app, env, tag, sha, exit) |
| `/var/log/starci-runner/<app>.log` | the deploy's full report |

Specs: `cli/src/harness/vps/runner.test.ts` (the gate's alphabet and words). The docker proof (AlmaLinux 8) is in the lane report.
