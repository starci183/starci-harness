import { z } from "zod"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { requireCiGreen } from "../check/ci.js"
import { callerRole } from "../../shared/role.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, NUMBER, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    action: { kind: "string", summary: "up, down, status, prepare, doctor, connect, disconnect, build-args, render, deploy, converge, verify, rollback, prune, backup, jobs, task, ingress, retire, build or accept", required: true, positional: true },
    args: { kind: "rest", summary: "the action's operands (task: the task's name)" },
    stack: { kind: "string", summary: "up, down, status: stack definition directory" },
    services: { kind: "list", summary: "up, down, status: infrastructure services to keep warm, comma separated or once each" },
    "k3d": { kind: "boolean", summary: "up, down, status: also warm the k3d cluster and registry" },
    force: { kind: "boolean", summary: "up, down, status: stop the stack even while leases exist" },
    env: { kind: "string", summary: "environment of .starcistacks whose deploy block drives the action; required by every action with an effect (doctor, build-args, render and verify default to production)" },
    execute: { kind: "boolean", summary: "perform the effects; without it every effectful action is a dry run" },
    image: { kind: "list", summary: "render, deploy: service=registry/name@sha256:digest, repeatable or comma separated" },
    "source-sha": { kind: "string", summary: "render, deploy: the git commit the images were built from" },
    "target-binding": { kind: "string", summary: "deploy, verify: public native endpoint assertion; constrains the target and grants no authority" },
    previous: { kind: "string", summary: "render: the previous accepted release id (16 hex)" },
    out: { kind: "string", summary: "render, deploy: directory that receives stack.yaml, stack.generated.yaml and release.json" },
    release: { kind: "string", summary: "rollback, accept: release id (16 lowercase hex); rollback deploys it again (default the previous accepted release), accept accepts it" },
    since: { kind: "string", summary: "converge: ISO instant the deploy began" },
    timeout: { kind: "string", summary: "deploy, converge, rollback: seconds to wait for convergence" },
    retry: { kind: "string", summary: "deploy, verify, accept: seconds public checks keep retrying" },
    keep: { kind: "list", summary: "prune: release.json of a release whose secrets and configs stay" },
    app: { kind: "string", summary: "build-args: the app whose image receives the public build values" },
    "ssh-cmd": { kind: "string", summary: "prepare, doctor, deploy, accept, converge, verify, rollback, prune, backup, jobs, task, ingress, retire: ssh command to reach the manager instead of the configured alias" },
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
    urgent: { kind: "boolean", summary: "deploy: an urgent release (owner rulings urgent-release 2026-10-29, urgent-typecheck-build 2026-10-30): its pushed urgent record stands in for CI, and the safety floor runs first and is never skipped (fresh verified encrypted backup with a test decrypt, migrate preview then execute, readiness verify, automatic rollback). Without --image and --source-sha it is one command: release HEAD (typecheck and build, tag, push, the urgent record; needs --reason), build and push its images on this machine, then deploy their digests" },
    reason: { kind: "string", summary: "deploy --urgent without --image and --source-sha: why HEAD cannot wait for CI and the full gate, one line its urgent record keeps" },
    remote: { kind: "string", summary: "deploy --urgent without --image and --source-sha: the remote HEAD and its tag are pushed to (default origin)" },
    "db-url-env": { kind: "string", summary: "deploy --urgent: the environment variable holding the database URL the floor backs up and migrates (default the linked project of the database block)" },
    "backup-out": { kind: "string", summary: "deploy --urgent: the folder outside every repository that receives the floor's encrypted backup (default ~/.starci-backups/<project>)" },
    "first-start": { kind: "boolean", summary: "deploy --urgent: the first start of a self-hosted database the release itself starts: no backup (the floor proves the database empty), migrate preview then execute inside its container before converge; needs --db-service" },
    "db-service": { kind: "string", summary: "deploy --urgent --first-start: the stack service the database runs as" },
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
    run: async (context, flags) => {
        // Shipping production waits for a green CI when policy/quality.yaml lists deploy.prod in requireCi; --urgent lets the commit's urgent record stand in.
        if (flags.action === "deploy" && flags.execute && (flags.env ?? "production") === "production" && flags["source-sha"] !== undefined) {
            const accepted = await requireCiGreen(context, await repositoryRoot(context.cwd), "deploy.prod", flags["source-sha"], { urgent: flags.urgent })
            if (accepted !== undefined) context.progress(`deploy.prod: ${accepted.verdict === "urgent" ? accepted.detail : `CI of ${accepted.sha.slice(0, 9)} is green`}`)
        }
        return runHfs(context, "stack", hfsArgv(FLAGS, flags, CHOICES), true, undefined, { role: callerRole() ?? "owner" })
    },
})
