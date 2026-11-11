// a15-findings.mts - the one place where the alpha.15 content rules (R247-R280) are wired into `starci app check`.
// Each rule module of a batch exports a synchronous finder `({ repoRoot, files, all, repo, resolver, manifest, isRoot, inScope }) => finding[]`
// and is wired here by appending ONE import line and ONE entry to FINDERS. Nothing else in this file changes; the file is union-merged.
// A finder judges its own edition (`repo.edition`): lite and full are both in scope unless the rule says otherwise.
// finders-import-begin
import { featureFileFindings } from './feature-files.mjs';
import { lexiconFindings } from './lexicon.mjs';
import { textIntegrityFindings } from './text-integrity.mjs';
import { assetsFindings } from './assets.mjs';
import { unusedSymbolFindings } from './unused-symbol.mjs';
import { databaseBaselineFindings } from './database-baseline.mjs';
import { databaseQueuesFindings } from './database-queues.mjs';
import { databaseConfigFindings } from './database-config.mjs';
import { docFreshFindings } from './doc-fresh.mjs';
import { releaseProvenanceFindings } from './release-provenance.mjs';
import { feStackAllowlistFindings } from './fe-stack.mjs';
import { appEnvRequiredFindings } from './app-env-required.mjs';
import { ageKeyCustodyFindings } from './secrets.mjs';
import { canonCopyDriftFindings } from './canon-copy-drift.mjs';
import { secretCustodyOnlyFindings } from './secret-custody-only.mjs';
import { bootProofFindings } from './boot-proof.mjs';
import { bootLoggerFindings } from './boot-logger.mjs';
import { flowFailureFindings } from './flow-failure.mjs';
import { packageSlotFindings, rulePackCheckFindings } from './app-extension-findings.mjs';
import { coverageBelowFindings } from './coverage-below.mjs';
import { deployScanFindings } from './deploy-scan.mjs';
import { deployWorkflowFindings } from './deploy-workflow.mjs';
import { scriptHygieneFindings } from './script-hygiene.mjs';
import { supplyChainFindings } from './supply-chain.mjs';
import { envParityFindings } from './env-parity.mjs';
import { envValueShapeFindings } from './env-value-shape.mjs';
import { liteProofLaneFindings } from './lite-proof-lane.mjs';
import { stacksSwarmFindings } from './stacks-swarm.mjs';
import { stacksReleaseFindings } from './stacks-release.mjs';
import { stacksIngressFindings } from './stacks-ingress.mjs';
import { stacksLiteBackingFindings } from './stacks-lite-backing.mjs';
import { stackToolingFindings } from './stack-tooling.mjs';
import { stacksDeployFindings } from './stacks-deploy.mjs';
import { stacksLocalFindings } from './stacks-local.mjs';
import { stacksServiceImageFindings } from './stacks-service-images.mjs';
import { stacksAuthCookieDomainFindings } from './stacks-auth-cookie-domain.mjs';
import { ciCustodyFindings } from './ci-custody.mjs';
import { workflowContextsFindings } from './workflow-contexts.mjs';
import { ciStandardAppFindings } from './ci-standard.mjs';
import { feBuildArgsFindings } from './fe-build-args.mjs';
import { appGalleryFindings } from './gallery.mjs';
import { restContractFindings } from './rest-contract.mjs';
import { projectSidesFindings } from './project-sides.mjs';
import type { Parsed } from './rule-types.mjs';
import type { CheckFinding } from '../check.mjs';
import { memoKeyed } from '../rule-memo.mjs';
// finders-import-end

/** The failure codes the finders above emit, so `starci app check` ships their labels (check.mts adds them to CHECK_CODES). Append-only; the coordinator regenerates it at merge time. */
export const A15_CODES = [
  // codes-begin
  'HFS_SIDE_FOLDER_MISSING', 'HFS_SIDE_UNDECLARED', 'STACKS_SIDES_UNDECLARED', 'STACKS_SIDES_DRIFT', 'STACKS_COMPONENT_SIDE',
  'BE_REST_OPERATION_ID', 'BE_REST_UNTYPED', 'BE_REST_ERROR_SHAPE', 'BE_REST_PAGINATION', 'BE_REST_SECURITY', 'BE_REST_APP_GRAPHQL',
  'HFS_APP_GALLERY_MISSING', 'HFS_APP_GALLERY_SCRIPT', 'HFS_APP_GALLERY_VITE_UNPINNED', 'HFS_APP_GALLERY_SHOTS_TRACKED',
  'FE_STACK_FAMILY_LINT_MISSING',
  'HFS_TEXT_CORRUPT',
  'FE_PUBLIC_BUILD_ARG_MISSING',
  'HFS_WORKFLOW_CONTEXT',
  'CI_STANDARD',
  'CI_SECRET_SEALED', 'APP_SECRET_IN_CI', 'CI_DECLARATION_DRIFT',
  'STACKS_LOCAL_CONFIG_INVALID', 'STACKS_DEV_UNDECLARED', 'STACKS_RUNBOOK_DOCKER_COMMAND', 'STACKS_BASE_PORT_ROLE', 'STACKS_BASE_PORT_UNDECLARED',
  'BACKUP_PROOF_MISSING', 'BACKUP_UNDECLARED', 'BE_APP_BOOT_PROOF_MISSING', 'BOOT_PROOF_TIMEOUT', 'BE_APP_ENV_REQUIRED', 'BE_APP_MODULE_LIST_INLINE', 'BE_FLOW_FAILURE_SWALLOWED', 'BE_LITE_PROOF_LANE_MISSING', 'DB_ARCHIVE_MUTATED', 'DB_BASELINE_SHAPE', 'DB_EXTENSION_ALLOWED', 'DB_MIGRATION_DESTRUCTIVE', 'DB_PGMQ_DECLARED', 'DB_VAULT_WRITE', 'ENV_DUPLICATE', 'ENV_EXAMPLE_DRIFT', 'ENV_PUBLIC_SEALED', 'ENV_REQUIRED_UNSET', 'ENV_SEALED_UNREAD', 'ENV_VALUE_SHAPE', 'FE_STACK_CORE_MISSING', 'FE_STACK_UNLISTED', 'HFS_AGE_KEY_CUSTODY', 'HFS_APP_LEXICON', 'HFS_APP_WORKFLOW_TRIGGER', 'HFS_ASSET_KIND', 'HFS_ASSET_OVERSIZE', 'HFS_AUDIT_STEP_MISSING', 'HFS_AUTH_COOKIE_DOMAIN_MISSING', 'HFS_BOOT_LOGGER_SILENCED', 'HFS_CANON_COPY_DRIFT', 'HFS_CI_TOOL_INSTALL', 'HFS_COVERAGE_BELOW', 'HFS_DB_DEPLOY_UNGUARDED', 'HFS_DEPENDABOT_MISSING', 'HFS_DEPLOY_COMPOSE_ON_VPS', 'HFS_DEPLOY_NO_LOGIC', 'HFS_DEPLOY_SCHEDULER', 'HFS_DEPLOY_WORKFLOW', 'HFS_DOC_COMMAND_UNKNOWN', 'HFS_DOC_ENV_UNKNOWN', 'HFS_DOC_PATH_MISSING', 'HFS_DOC_RULE_UNKNOWN', 'HFS_FEATURE_FILE_BUDGET', 'HFS_HOST_CRON', 'HFS_RELEASE_TAG_MISMATCH', 'HFS_SBOM_MISSING', 'HFS_SCHEDULE_UNDECLARED', 'HFS_SCRIPT_PLAINTEXT_LOAD', 'HFS_SCRIPT_XTRACE', 'HFS_SECRET_OUTSIDE_ENC', 'HFS_SECRET_PLAINTEXT_FILE', 'HFS_SEED_PII', 'HFS_UNUSED_SYMBOL', 'HFS_WORKFLOW_PIN', 'STACKS_DEPLOY_CONFIG_INVALID', 'STACKS_DNS_UNDECLARED', 'STACKS_HEALTHCHECK_MISSING', 'STACKS_HOST_UNROUTED', 'STACKS_INGRESS_UNDECLARED', 'STACKS_INGRESS_UNKNOWN', 'STACKS_LITE_REDIS_PERSISTENCE', 'STACKS_LITE_SELFHOSTED_DB', 'STACKS_MODEL_UNAVAILABLE', 'STACKS_PLACEMENT_MISSING', 'STACKS_PORT_PUBLISHED', 'STACKS_REALTIME_SCALED', 'STACKS_RELEASE_UNDECLARED', 'STACKS_SECOND_INGRESS', 'STACKS_SECRET_ENV_LITERAL', 'STACKS_SECRET_NOT_EXTERNAL', 'STACKS_SECRET_UNVERSIONED', 'STACKS_SIDECAR_DB_UNSUPPORTED', 'STACKS_SIDECAR_VOLUME_UNDECLARED', 'STACKS_TLS_UNDECLARED', 'STACKS_UPDATE_POLICY_MISSING', 'STACK_TOOLING_REIMPLEMENTED',
  'HFS_RULE_PACK_INVALID', 'HFS_PACKAGE_SLOTS_INVALID', 'HFS_PACKAGE_SLOT_MISSING', 'HFS_PACKAGE_SLOT_DISALLOWED', 'HFS_PACKAGE_SLOT_UNPLACED',
  // codes-end
];

export const FINDERS = [
  // finders-begin
  projectSidesFindings,
  restContractFindings,
  appGalleryFindings,
  feBuildArgsFindings,
  workflowContextsFindings,
  ciStandardAppFindings,
  featureFileFindings,
  lexiconFindings,
  textIntegrityFindings,
  assetsFindings,
  unusedSymbolFindings,
  databaseBaselineFindings,
  databaseQueuesFindings,
  databaseConfigFindings,
  docFreshFindings,
  releaseProvenanceFindings,
  feStackAllowlistFindings,
  appEnvRequiredFindings,
  ageKeyCustodyFindings,
  canonCopyDriftFindings,
  secretCustodyOnlyFindings,
  bootProofFindings,
  bootLoggerFindings,
  flowFailureFindings,
  coverageBelowFindings,
  deployScanFindings,
  deployWorkflowFindings,
  scriptHygieneFindings,
  supplyChainFindings,
  envParityFindings,
  envValueShapeFindings,
  liteProofLaneFindings,
  stacksSwarmFindings,
  stacksReleaseFindings,
  stacksIngressFindings,
  stacksLiteBackingFindings,
  stackToolingFindings,
  stacksDeployFindings,
  stacksLocalFindings,
  stacksServiceImageFindings,
  stacksAuthCookieDomainFindings,
  ciCustodyFindings,
  rulePackCheckFindings,
  packageSlotFindings,
  // finders-end
];

/**
 * The finders the result cache keeps by the files they read: each reads the tracked tree only through `readText` / `readJson` (rules/read.mts) and the tracked
 * path lists it is given, so its findings are a function of those. `check-cache-structure-rules.spec.mts` proves every member under a file-system recorder
 * and fails on a read it does not go through the gateway. A finder that stats, lists or walks the work tree (stacks-release, the stacks gate) is not a member.
 */
export const KEYED_FINDERS: ReadonlySet<(context: Parsed) => Parsed> = new Set([docFreshFindings, scriptHygieneFindings, databaseConfigFindings, feBuildArgsFindings, bootLoggerFindings, flowFailureFindings]);

/** Findings of every alpha.15 content rule over one repository. */
export function a15Findings(context: Parsed) {
  // `starci app check` always passes the full context; a partial one (a finder spec driving the registry with only the fields its rule reads) must not crash the finders of other rules.
  const full = Boolean(context.repoRoot && context.repo && context.resolver && context.manifest);
  return FINDERS.flatMap((finder) => {
    const run = () => finder(context);
    const once = KEYED_FINDERS.has(finder) && full ? () => memoKeyed(context.repoRoot, finder.name, run as () => CheckFinding[]) as ReturnType<typeof run> : run;
    if (full) return once();
    try { return once(); } catch { return []; }
  });
}

// A02: include every deployment and supply-chain finding in the bundled app-check catalog.
