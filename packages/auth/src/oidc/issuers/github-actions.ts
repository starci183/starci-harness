import type { JWTPayload } from "jose"
import { OIDC_ERROR_CODES } from "../../contracts/oidc.ts"
import { OidcError } from "../errors.ts"
import type { IssuerEndpoints, IssuerMapping, IssuerPreset } from "./issuer.ts"
import { mapped, unmapped } from "./issuer.ts"

/** The issuer of GitHub Actions OIDC tokens. */
export const GITHUB_ACTIONS_ISSUER = "https://token.actions.githubusercontent.com"
/** Its signing keys. */
export const GITHUB_ACTIONS_JWKS_URI = "https://token.actions.githubusercontent.com/.well-known/jwks"

/** The claims a CI run token must carry beyond `sub` and `exp`. */
export const GITHUB_ACTIONS_CLAIMS = ["repository", "repository_id", "workflow", "workflow_ref", "ref", "run_id", "sha"] as const

/** Which runs the app trusts: always one repository, optionally pinned further. */
export interface GitHubActionsIssuerOptions {
    /** The audience the workflow asked for (`core.getIDToken(audience)`): required, so a token minted for another service never passes. */
    readonly audience: string | readonly string[]
    /** The repository the run belongs to (`owner/name`), compared without case as GitHub names are. */
    readonly repository: string
    /** The numeric repository id: pins the repository across a rename or a deleted-and-recreated name. */
    readonly repositoryId?: string | undefined
    /** The workflow files admitted (`.github/workflows/ci.yml`), matched against the path of `workflow_ref`; any when absent. */
    readonly workflows?: readonly string[] | undefined
    /** The refs admitted (`refs/heads/main`, `refs/tags/v1.0.0`); any when absent. */
    readonly refs?: readonly string[] | undefined
    /** A test double's addresses. */
    readonly endpoints?: IssuerEndpoints | undefined
}

/** What a verified CI run token attests. */
export interface GitHubActionsRun {
    /** The `sub` claim (`repo:owner/name:ref:refs/heads/main`). */
    readonly subject: string
    readonly repository: string
    readonly repositoryId: string
    /** The owner part of `repository`. */
    readonly repositoryOwner: string
    /** The workflow name. */
    readonly workflow: string
    /** `owner/name/.github/workflows/<file>@<ref>`. */
    readonly workflowRef: string
    /** The workflow file path of `workflowRef` (`.github/workflows/ci.yml`). */
    readonly workflowPath: string
    readonly ref: string
    readonly sha: string
    readonly runId: string
    /** The attempt of the run (`1`), when the token names one. */
    readonly runAttempt: string | null
    /** Who started the run, when the token names them. */
    readonly actor: string | null
    /** What started it (`push`, `pull_request`), when the token names it. */
    readonly eventName: string | null
    /** The deployment environment, when the job has one. */
    readonly environment: string | null
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)

/** `owner/name/.github/workflows/ci.yml@refs/heads/main` -> `.github/workflows/ci.yml` for the given repository, else null. */
const workflowPathOf = (workflowRef: string, repository: string): string | null => {
    const at = workflowRef.lastIndexOf("@")
    const path = at < 0 ? workflowRef : workflowRef.slice(0, at)
    const prefix = `${repository}/`
    return path.toLowerCase().startsWith(prefix.toLowerCase()) && path.length > prefix.length ? path.slice(prefix.length) : null
}

const RUN_ID = /^\d{1,20}$/u

/** The run a verified token's claims attest, or a refusal: a claim of the wrong shape is `claims`, one the policy does not admit is `policy`. */
const runOf = (claims: JWTPayload, options: GitHubActionsIssuerOptions): IssuerMapping<GitHubActionsRun> => {
    const subject = text(claims.sub)
    const repository = text(claims.repository)
    const repositoryId = text(claims.repository_id)
    const workflow = text(claims.workflow)
    const workflowRef = text(claims.workflow_ref)
    const ref = text(claims.ref)
    const sha = text(claims.sha)
    const runId = text(claims.run_id)
    if (subject === null || repository === null || repositoryId === null || workflow === null || workflowRef === null || ref === null || sha === null || runId === null || !RUN_ID.test(runId)) return unmapped("claims")
    const wanted = options.repository.toLowerCase()
    if (repository.toLowerCase() !== wanted) return unmapped("policy", "repository")
    if (!subject.toLowerCase().startsWith(`repo:${wanted}:`)) return unmapped("policy", "sub")
    if (options.repositoryId !== undefined && repositoryId !== options.repositoryId) return unmapped("policy", "repository_id")
    const workflowPath = workflowPathOf(workflowRef, repository)
    if (workflowPath === null) return unmapped("policy", "workflow_ref")
    if (options.workflows !== undefined && !options.workflows.includes(workflowPath)) return unmapped("policy", "workflow_ref")
    if (options.refs !== undefined && !options.refs.includes(ref)) return unmapped("policy", "ref")
    return mapped({
        subject,
        repository,
        repositoryId,
        repositoryOwner: repository.slice(0, repository.indexOf("/")),
        workflow,
        workflowRef,
        workflowPath,
        ref,
        sha,
        runId,
        runAttempt: text(claims.run_attempt),
        actor: text(claims.actor),
        eventName: text(claims.event_name),
        environment: text(claims.environment),
    })
}

const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u

/**
 * The GitHub Actions preset: the OIDC token a workflow run mints (`permissions: id-token: write`), RS256 against GitHub's pinned key set,
 * for an audience the app names, from one repository, optionally pinned to its id, its workflow files and its refs. A CI attestation port
 * (a run proving which repository, workflow, ref and commit it is) composes this inside `integrations/keycloak`.
 */
export const githubActionsIssuer = (options: GitHubActionsIssuerOptions): IssuerPreset<GitHubActionsRun> => {
    const audience = typeof options.audience === "string" ? [options.audience] : options.audience
    if (audience.length === 0 || audience.some((entry) => entry === "")) throw new OidcError(OIDC_ERROR_CODES.ConfigurationInvalid, { params: { key: "audience" } })
    if (!REPOSITORY.test(options.repository)) throw new OidcError(OIDC_ERROR_CODES.ConfigurationInvalid, { params: { key: "repository" } })
    return {
        name: "github-actions",
        issuer: options.endpoints?.issuer ?? GITHUB_ACTIONS_ISSUER,
        issuerAliases: [],
        keys: { kind: "jwks", uri: options.endpoints?.jwksUri ?? GITHUB_ACTIONS_JWKS_URI },
        algorithms: ["RS256"],
        audience,
        requiredClaims: [...GITHUB_ACTIONS_CLAIMS],
        identityOf: (claims) => runOf(claims, options),
    }
}
