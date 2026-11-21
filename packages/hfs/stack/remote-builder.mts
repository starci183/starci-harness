// remote-builder.mts - the client side of the remote BuildKit of a managed VPS (owner decision "A", 2026-11-21): the names the images workflow
// (sync/stack-images.mts) and `starci app stack build --builder-host` (build.mts) share. They match the harness's ops/vps/services/buildkit/service.yaml
// (access.user, access.builder), whose server side - the rootless buildkitd, the gate admitting only `buildctl dial-stdio`, the per-repository keys
// of `starci vps build-key` - lives in the harness CLI.

/** The ssh user of the remote builder, the buildx builder name, the ssh alias CI writes, and how long a bootstrap may take. */
export const REMOTE_BUILDER = Object.freeze({ user: 'starci-build', builder: 'starci-remote', alias: 'starci-builder', bootstrapSeconds: 60 });

/** The repository secrets of the remote builder (`starci vps build-key add` sets them; ci.yml passes them to images.yml). */
export const BUILDER_SECRETS = Object.freeze(['STARCI_BUILDER_SSH_KEY', 'STARCI_BUILDER_HOST', 'STARCI_BUILDER_KNOWN_HOSTS'] as const);

/** The one line the images job prints when it builds on the runner instead. */
export const RUNNER_FALLBACK = 'remote builder unreachable, building on the runner';
