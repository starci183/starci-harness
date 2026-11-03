# StarCi OpenClaw runtime layer: the harness-pinned source-built fork (images/openclaw, sources.json) plus the generic gateway wrapper.
# An app image does `FROM ghcr.io/starci183/openclaw-runtime@sha256:...` and only COPYs its own plugins into /opt/starci/plugins/<name>/;
# it carries no wrapper code (images/README.md "The OpenClaw runtime layer"). The base below is the recorded `published.reference` of the
# `openclaw` entry of sources.json; a new fork build raises it here in the same change.
FROM ghcr.io/starci183/openclaw:2026.10.10-beta.5-starci.1@sha256:0770c1da11ec4a46607ec16957ac3cff68d05db4a287f59f0e1d0e76de980ff8

USER root
# The wrapper is root-owned and not writable by the runtime user; the plugin directory is root-owned and world-readable, so a plugin an
# app copies in cannot be rewritten by the gateway it runs inside.
COPY --chmod=0555 entrypoint.sh /opt/starci/entrypoint.sh
COPY --chmod=0444 openclaw-init.mjs openclaw-relay.mjs /opt/starci/
RUN mkdir -p /opt/starci/plugins \
    && chown -R root:root /opt/starci \
    && chmod 0755 /opt/starci /opt/starci/plugins

# The container starts as root only for the entrypoint to hand the gateway's state folder (a bind mount the host may have created as root) to
# the runtime user, then drops to that user for good: STARCI_RUNTIME_USER is the one place the image names it.
USER root
ENV STARCI_RUNTIME_USER=node
ENV STARCI_PLUGINS_DIR=/opt/starci/plugins
ENTRYPOINT ["tini", "-s", "--", "sh", "/opt/starci/entrypoint.sh"]
