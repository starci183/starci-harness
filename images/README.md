# Source-built service images

The harness owns the Dockerfile of each service image it builds from a StarCi fork's source; today that is MinIO
(`minio/`). The complete fork stays on GitHub. [sources.json](sources.json) owns, per image, the immutable source
context, release build arguments, platforms and already-published GHCR reference. A fork's default branch is
`starci/build`; builds use the recorded commit rather than that moving branch.

Each Dockerfile is imported byte-for-byte from `sourceDockerfile` at that commit. Its base images, dependency
installation, build stages, runtime files, user and entrypoint remain the published recipe. MinIO retains its upstream
release/commit build metadata and AGPL license files. Recipe changes are made here.

## Build context and command

Every `COPY` reads the pinned fork root, including its lockfiles, scripts and `.dockerignore`. The harness root and the
individual `images/<name>/` directory are not source contexts. Passing the local Dockerfile through stdin with a remote
Git context follows [Docker's documented form](https://docs.docker.com/build/concepts/context/#remote-context-with-dockerfile-from-stdin).

For the managed build owner, these PowerShell arguments build one selected recipe (a key of `sources.json`, such as
`minio`) into a scratch OCI archive. Start in the harness checkout. The command neither pushes a tag nor changes an
existing image. Machine execution follows [harness rule 8](../contexts/harness/rules.md); adding a recipe does not start
a build.

```powershell
$name = 'minio'
$images = Get-Content -Raw ./images/sources.json | ConvertFrom-Json
$image = $images.$name
if ($null -eq $image) { throw 'Unknown source image' }
$output = Join-Path $env:TEMP "starci-$name-$($image.commit).oci.tar"
$buildArgs = @('buildx', 'build', '--file', '-', '--platform', ($image.platforms -join ','),
    '--sbom=true', '--provenance=mode=max', '--output', "type=oci,dest=$output")
foreach ($arg in $image.buildArgs.PSObject.Properties) {
    $buildArgs += @('--build-arg', "$($arg.Name)=$($arg.Value)")
}
$buildArgs += "$($image.repository).git#$($image.commit)"
Get-Content -Raw -Encoding utf8 "./images/$name/Dockerfile" | & docker @buildArgs
if ($LASTEXITCODE -ne 0) { throw 'Source image build failed' }
```

The context commit identifies the source, not a guarantee of byte-identical future output: the recipe still contains
its existing package-manager and distribution refresh steps. A new build receives its own output digest.

## Published provenance

`published.run` links the successful fork workflow whose logs record `containerimage.digest` and the completed push of
`published.reference`. MinIO's workflow passes its release arguments and builds both recorded platforms. The workflow
also updates `latest`; that moving alias is not the stored reference.

The recorded images already exist. Importing a recipe does not rebuild, republish, retag or select it for an app.
Runtime adoption separately verifies the product's version, protocol, mounts and configuration against its managed
stack before changing a pinned image. The app base-image pins remain owned by
[contexts/stack/pins.yaml](../contexts/stack/pins.yaml).

## How an app uses a fork image

A service of an app that customises a forked service builds it from its own image folder
`.starcistacks/images/<service>/Dockerfile`, whose final stage is `FROM` the fork's published reference
(`ghcr.io/starci183/<image>:<tag>@sha256:...`) and adds only the app's own files. The app runs that one image in dev
and production and bind-mounts no code, plugins or scripts into it
([contexts/project/stacks.md](../contexts/project/stacks.md) PROJECT-STACKS-11, lint R374, whose fork list is
`packages/hfs/runtime/knowledge/hfs/fork-images.yaml`, held equal to this `sources.json`).
