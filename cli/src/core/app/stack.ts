import { z } from "zod"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, NUMBER, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    action: { kind: "string", summary: "up, down, status, prepare, doctor, connect, disconnect, build-args, render, deploy, converge, verify, rollback, prune, backup, jobs, task, ingress, retire, build or accept", required: true, positional: true },
    args: { kind: "rest", summary: "the action's operands (task: the task's name)" },
    stack: { kind: "string", summary: "up, down, status: stack definition directory" },
    services: { kind: "list", summary: "up, down, status: infrastructure services to keep warm, comma separated or once each" },
    "k3d": { kind: "boolean", summary: "up, down, status: also warm the k3d cluster and registry" },
    force: { kind: "boolean", summary: "up, down, status: stop the stack even while leases exist" },
    env: { kind: "string", summary: "environment of .starcistacks whose deploy block drives the action (default production)" },
    execute: { kind: "boolean", summary: "perform the effects; without it every effectful action is a dry run" },
    image: { kind: "list", summary: "render, deploy: service=registry/name@sha256:digest, repeatable or comma separated" },
    "source-sha": { kind: "string", summary: "render, deploy: the git commit the images were built from" },
    "target-binding": { kind: "string", summary: "deploy, verify: public native endpoint assertion; constrains the target and grants no authority" },
    previous: { kind: "string", summary: "render: the previous accepted release id (16 hex)" },
    out: { kind: "string", summary: "render, deploy: directory that receives stack.yaml, stack.generated.yaml and release.json" },
    release: { kind: "string", summary: "rollback: release id (16 lowercase hex) to deploy again; default the previous accepted release" },
    since: { kind: "string", summary: "converge: ISO instant the deploy began" },
    timeout: { kind: "string", summary: "deploy, converge, rollback: seconds to wait for convergence" },
    retry: { kind: "string", summary: "deploy, verify: seconds public checks keep retrying" },
    keep: { kind: "list", summary: "prune: release.json of a release whose secrets and configs stay" },
    app: { kind: "string", summary: "build-args: the app whose image receives the public build values" },
    "ssh-cmd": { kind: "string", summary: "prepare, doctor, backup, jobs, task, deploy, rollback: ssh command to reach the manager instead of the configured alias" },
    "extra-compose": { kind: "list", summary: "render: an additional compose file for a local throwaway swarm" },
    "allow-unpinned": { kind: "boolean", summary: "render: accept stand-in images without a digest (a local throwaway swarm; never the placeholder digest)" },
    "init-swarm": { kind: "boolean", summary: "prepare: run the one-time docker swarm init (needs --execute and --owner-approved)" },
    "owner-approved": { kind: "boolean", summary: "prepare: the owner approved the one-time docker swarm init (with --init-swarm --execute)" },
    "fix-live-restore": { kind: "boolean", summary: "prepare: disable docker live-restore (incompatible with swarm), restart dockerd and report the containers that came back; needs --owner-approved --execute" },
    project: { kind: "list", summary: "retire: an old docker compose project whose containers are stopped (restart policy off, nothing removed)" },
    push: { kind: "boolean", summary: "build: push the images to the registry with the operator's own docker login and print their digests (needs --execute)" },
    "swarm-state": { kind: "boolean", summary: "backup: also archive /var/lib/docker/swarm, encrypted" },
    "skip-public": { kind: "boolean", summary: "deploy, verify: skip the public HTTP checks (deploy then leaves the release pending until accept)" },
    "skip-internal": { kind: "boolean", summary: "verify: skip the checks run inside a service task" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    action: z.enum(["up", "down", "status", "prepare", "doctor", "connect", "disconnect", "build-args", "render", "deploy", "converge", "verify", "rollback", "prune", "backup", "jobs", "task", "ingress", "retire", "build", "accept"]),
    timeout: NUMBER,
    retry: NUMBER,
} as const

/** `starci app stack`: Swarm deploy tooling of an app (prepare to rollback, dry runs without --execute) and the full edition's local test-world infrastructure; @starci/hfs runs it in-process in the app. */
export const appStackVerb = defineVerb({
    path: ["app", "stack"],
    summary: "Swarm deploy tooling of an app (prepare to rollback, dry runs without --execute) and the full edition's local test-world infrastructure",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "release", "supervisor", "op", "worker", "agent"],
    schema: "starci/app-stack@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "stack", hfsArgv(FLAGS, flags, CHOICES), true),
})
