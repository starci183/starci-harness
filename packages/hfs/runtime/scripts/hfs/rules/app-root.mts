// app-root.mts - the tree checks of `starci app check` that read the WHOLE app from its root (app-relative paths over every tracked
// file of both sides): one list of the rule modules of the app root, so scripts/hfs/check.mts runs them as one step.
//   HFS_DEP_VERSION_SKEW (R14, deps.mts), HFS_PEER_INTEGRATION_MISSING (R111, peer-integrations.mts), the monorepo shape
//   (HFS_MONO_*, monorepo.mts), the one cli app (BE_CLI_REQUIRED, cli.mts), BE_INTEGRATION_SPEC_MISSING (R112,
//   integration-specs.mts), FE_GRAPHQL_CONTRACT (R113, fe-contract-documents.mts), HFS_CI_MISSING_CANON (R13, pipeline.mts),
//   BE_TEST_TOPOLOGY (R47, test-topology.mts), HFS_PROOF_COMMAND_FILE_MISSING (R105, proof-commands.mts), the app front-end
//   tree (FE_WIRE_GENERATED, FE_I18N_PLACEMENT, frontend-tree.mts), HFS_STACKS_SHAPE (R10, stacks.mts) and the root seed data
//   (HFS_SEED_*: R375, seeds.mts). A rule of one side runs only when the project declares that side, and a rule that joins the two (the fe wire
//   generated from the be contract, the fe GraphQL documents against it) only when it declares both (PROJECT-1, project-sides.mts).
import { cliFindings } from './cli.mjs';
import { sideDeclared } from '../project-sides.mjs';
import { contractCompatFindings } from './contract-compat.mjs';
import { depFindings } from './deps.mjs';
import { dockerFindings } from './docker.mjs';
import { eventClassContractFindings, patternSpecFindings } from './event-bus.mjs';
import { feContractFindings } from './fe-contract-documents.mjs';
import { appFrontendFindings } from './frontend-tree.mjs';
import { integrationSpecFindings } from './integration-specs.mjs';
import { kindFindings } from './kinds.mjs';
import { monorepoFindings } from './monorepo.mjs';
import { peerIntegrationFindings } from './peer-integrations.mjs';
import { pipelineFindings } from './pipeline.mjs';
import { proofCommandFindings } from './proof-commands.mjs';
import { sagaFindings } from './saga.mjs';
import { seedsFindings } from './seeds.mjs';
import { serviceFindings } from './services.mjs';
import { stacksFindings } from './stacks.mjs';
import { testTopologyFindings } from './test-topology.mjs';
import type { Parsed, Repo } from './rule-types.mjs';
import type { Resolver } from '../slots.mjs';

/**
 * The findings of the app-root rules: `files` are the root's own tracked paths, `all` every tracked path of the app, `repo` the
 * resolved app declaration, `resolver` its slot resolver and `pins` the canon pins.
 */
export function appRootFindings({ repoRoot, files, all, repo, resolver, pins, phase }: { repoRoot: string; files: string[]; all: string[]; repo: Repo; resolver: Resolver; pins: Parsed; phase: Parsed }) {
  const be = sideDeclared(repo, 'be');
  const fe = sideDeclared(repo, 'fe');
  return [
    ...depFindings({ repoRoot, files: all }),
    ...peerIntegrationFindings({ repoRoot, files: all }),
    ...monorepoFindings({ repoRoot, files: all, repo }),
    ...dockerFindings({ repoRoot, files: all, repo }),
    ...(be ? cliFindings({ repoRoot, files: all, repo, resolver }) : []),
    ...contractCompatFindings({ repoRoot, files: all }),
    ...eventClassContractFindings({ repoRoot, files: all, repo }),
    ...patternSpecFindings({ repoRoot, files: all, repo }),
    ...serviceFindings({ repoRoot, files: all, repo }),
    ...sagaFindings({ repoRoot, files: all }),
    ...(be ? kindFindings({ files: all, repo }) : []),
    ...integrationSpecFindings({ repoRoot, files: all }),
    ...(be && fe ? feContractFindings({ repoRoot, files: all }) : []),
    ...pipelineFindings({ repoRoot, files, pins }),
    ...testTopologyFindings({ repoRoot, files }),
    ...proofCommandFindings({ repoRoot, files: all, resolver, sides: Object.keys(repo.sides ?? {}).filter((side) => side !== 'be' && side !== 'fe' || sideDeclared(repo, side)) }),
    ...(fe ? appFrontendFindings({ repoRoot, files: all, repo, phase }) : []),
    ...stacksFindings({ repoRoot, files, resolver }),
    ...seedsFindings({ repoRoot, files }),
  ];
}
