# Source-built service images

The harness owns the MinIO and OpenClaw Dockerfiles here. Each builds the corresponding fork's source; the complete
fork stays on GitHub. [sources.json](sources.json) owns the immutable source context, release build arguments,
platforms and already-published GHCR reference. The default branch of both forks is `starci/build`; builds use the
recorded commit rather than that moving branch.

The Dockerfiles were imported byte-for-byte from `sourceDockerfile` at that commit. Their base images, dependency
installation, build stages, runtime files, user and entrypoint remain the published recipes. MinIO retains its upstream
release/commit build metadata and AGPL license files; OpenClaw retains its pinned Node/Bun bases, frozen pnpm installs,
plugin selection, native-addon checks, non-root runtime and gateway health check. Recipe changes are made here.

## Build context and command

Every `COPY` reads the pinned fork root, including its lockfiles, scripts and `.dockerignore`. The harness root and the
individual `images/<name>/` directory are not source contexts. Passing the local Dockerfile through stdin with a remote
Git context follows [Docker's documented form](https://docs.docker.com/build/concepts/context/#remote-context-with-dockerfile-from-stdin).

For the managed build owner, these PowerShell arguments build one selected recipe into a scratch OCI archive. Start in
the harness checkout; select `minio` or `openclaw`. The command neither pushes a tag nor changes an existing image.
Machine execution follows [harness rule 8](../contexts/harness/rules.md); adding these recipes does not start a build.

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
if ($name -eq 'openclaw') {
    $buildArgs += @('--build-arg', "GIT_COMMIT=$($image.commit)",
        '--build-arg', "OPENCLAW_BUILD_TIMESTAMP=$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))")
}
$buildArgs += "$($image.repository).git#$($image.commit)"
Get-Content -Raw -Encoding utf8 "./images/$name/Dockerfile" | & docker @buildArgs
if ($LASTEXITCODE -ne 0) { throw 'Source image build failed' }
```

The context commit identifies the source, not a guarantee of byte-identical future output: the original recipes still
contain their existing package-manager and distribution refresh steps. A new build receives its own output digest.

## Published provenance

`published.run` links the successful fork workflow whose logs record `containerimage.digest` and the completed push of
`published.reference`. MinIO's workflow passes its release arguments and builds both recorded platforms; OpenClaw's
workflow supplies the source commit, UTC build timestamp and release version for its recorded platform. Both workflows
also updated `latest`; that moving alias is not the stored reference.

The recorded images already exist. Importing the recipes does not rebuild, republish, retag or select them for an app.
Runtime adoption separately verifies the product's version, gateway protocol, mounts and configuration against its
managed stack before changing a pinned image. The app base-image pins remain owned by
[contexts/stack/pins.yaml](../contexts/stack/pins.yaml).
