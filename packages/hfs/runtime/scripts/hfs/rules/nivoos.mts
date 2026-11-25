// nivoos.mts - R436: the nivoos packages a project declares (hfs.json `sides.nivoos.packages`, nivoos-side.mts, contexts/project/business-repo.md
// PROJECT-BUSINESS-1) agree with its tree, each way:
//   HFS_NIVOOS_PACKAGE_MISSING   a declared package lacks its folder's package.json, tsconfig.json or its entry (default src/<name>.package.ts);
//   HFS_NIVOOS_UNDECLARED        a root package (packages/<name>/package.json) depends on the nivoos SDK or its CLI but hfs.json does not declare it:
//                                the canon back-end lint would judge its SDK-authored source (default exports, Vietnamese copy) and refuse it.
//                                A package listed in hfs.json `publishes` (the platform's own SDK, CLI or catalogue) and the SDK package itself are no business package: exempt.
//   HFS_NIVOOS_SPEC_MISSING      a cell or flow of a declared package has no spec beside it (owner 2026-11-25, BE-TEST-13): the package's cells and flows are its
//                                `<name>.cell.ts` and `<name>.workflow.ts` files below src/, the spec of a cell is `<name>.cell.spec.ts` and of a flow
//                                `<name>.flow.spec.ts` (or `<name>.workflow.spec.ts`), in the same folder. A test obligation: judged only while the app's test and
//                                coverage gates run, `off (declared)` when the app switches either off (coverageObligationsOff).
// The package check itself (`nivoos package check`, HFS_NIVOOS_PACKAGE_CHECK) runs as a step of `starci app check` (cache/nivoos-package-check.mts).
import { dependsOnNivoosSdk, NIVOOS_SDK_DEPENDENCY, type NivoosPackage } from '../nivoos-side.mjs';
import { coverageObligationsOff } from '../coverage-tiers.mjs';
import { found, readJson } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

/** The findings of R436 over the tracked tree `all` of the app root. */
export function nivoosFindings({ repoRoot, files, repo }: { repoRoot: string; files: readonly string[]; repo: Repo }): Finding[] {
  const findings: Finding[] = [];
  const tracked = new Set(files);
  const declared: readonly NivoosPackage[] = repo.nivoosPackages ?? [];
  const names = new Set(declared.map((entry) => entry.name));
  const published = new Set((repo.publishes as readonly string[] | undefined) ?? []);
  for (const entry of declared) {
    const folder = `packages/${entry.name}`;
    for (const required of ['package.json', 'tsconfig.json', entry.entry]) {
      if (!tracked.has(`${folder}/${required}`)) findings.push(found('HFS_NIVOOS_PACKAGE_MISSING', `${folder}/${required}`, `hfs.json declares the nivoos package ${entry.name}, but ${folder}/${required} is not tracked: add it, or remove ${entry.name} from sides.nivoos.packages (PROJECT-BUSINESS-1)`, { package: entry.name }));
    }
  }
  // A spec per cell and flow is a test obligation: not judged while the app declares its test or coverage gate off (PROJECT-LINT-4), which the run reports as off (declared).
  if (coverageObligationsOff(repoRoot) === null) findings.push(...nivoosSpecFindings(declared, tracked));
  for (const file of files) {
    const match = /^packages\/([^/]+)\/package\.json$/u.exec(file);
    if (match === null || names.has(match[1] as string) || published.has(`packages/${match[1] as string}`)) continue;
    const manifest = readJson(repoRoot, file);
    if (typeof (manifest as { name?: unknown } | null)?.name === 'string' && NIVOOS_SDK_DEPENDENCY.test((manifest as { name: string }).name)) continue;
    if (dependsOnNivoosSdk(manifest)) findings.push(found('HFS_NIVOOS_UNDECLARED', file, `${file} depends on the nivoos SDK, so packages/${match[1] as string}/ is a business package, but hfs.json does not declare it: add { "name": "${match[1] as string}" } to sides.nivoos.packages so the SDK authoring lint profile and \`nivoos package check\` judge it, or drop the dependency (PROJECT-BUSINESS-1)`, { package: match[1] }));
  }
  return findings;
}

/** The node kinds of a business package that each carry a spec of their own: the suffix of the file and the suffixes its sibling spec may take. */
export const NIVOOS_SPEC_KINDS: readonly { readonly kind: string; readonly suffix: string; readonly specs: readonly string[] }[] = Object.freeze([
  { kind: 'cell', suffix: '.cell.ts', specs: ['.cell.spec.ts'] },
  { kind: 'flow', suffix: '.workflow.ts', specs: ['.flow.spec.ts', '.workflow.spec.ts'] },
]);

/** HFS_NIVOOS_SPEC_MISSING: every cell and flow file below the src/ of a declared package has its spec beside it. */
export function nivoosSpecFindings(declared: readonly NivoosPackage[], tracked: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  for (const entry of declared) {
    const source = `packages/${entry.name}/src/`;
    for (const file of [...tracked].filter((path) => path.startsWith(source)).sort()) {
      const kind = NIVOOS_SPEC_KINDS.find((candidate) => file.endsWith(candidate.suffix));
      if (kind === undefined) continue;
      const stem = file.slice(0, -kind.suffix.length);
      const specs = kind.specs.map((spec) => `${stem}${spec}`);
      if (specs.some((spec) => tracked.has(spec))) continue;
      findings.push(found('HFS_NIVOOS_SPEC_MISSING', file, `${file} is a ${kind.kind} of the business package ${entry.name} with no spec beside it: add ${specs[0] as string} (every cell and flow of a business package has a spec, owner 2026-11-25, BE-TEST-13)`, { package: entry.name, kind: kind.kind }));
    }
  }
  return findings;
}
