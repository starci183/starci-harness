// nivoos.mts - R436: the nivoos packages a project declares (hfs.json `sides.nivoos.packages`, nivoos-side.mts, contexts/project/business-repo.md
// PROJECT-BUSINESS-1) agree with its tree, each way:
//   HFS_NIVOOS_PACKAGE_MISSING   a declared package lacks its folder's package.json, tsconfig.json or its entry (default src/<name>.package.ts);
//   HFS_NIVOOS_UNDECLARED        a root package (packages/<name>/package.json) depends on the nivoos SDK or its CLI but hfs.json does not declare it:
//                                the canon back-end lint would judge its SDK-authored source (default exports, Vietnamese copy) and refuse it.
//                                A package listed in hfs.json `publishes` (the platform's own SDK, CLI or catalogue) and the SDK package itself are no business package: exempt.
// The package check itself (`nivoos package check`, HFS_NIVOOS_PACKAGE_CHECK) runs as a step of `starci app check` (cache/nivoos-package-check.mts).
import { dependsOnNivoosSdk, NIVOOS_SDK_DEPENDENCY, type NivoosPackage } from '../nivoos-side.mjs';
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
  for (const file of files) {
    const match = /^packages\/([^/]+)\/package\.json$/u.exec(file);
    if (match === null || names.has(match[1] as string) || published.has(`packages/${match[1] as string}`)) continue;
    const manifest = readJson(repoRoot, file);
    if (typeof (manifest as { name?: unknown } | null)?.name === 'string' && NIVOOS_SDK_DEPENDENCY.test((manifest as { name: string }).name)) continue;
    if (dependsOnNivoosSdk(manifest)) findings.push(found('HFS_NIVOOS_UNDECLARED', file, `${file} depends on the nivoos SDK, so packages/${match[1] as string}/ is a business package, but hfs.json does not declare it: add { "name": "${match[1] as string}" } to sides.nivoos.packages so the SDK authoring lint profile and \`nivoos package check\` judge it, or drop the dependency (PROJECT-BUSINESS-1)`, { package: match[1] }));
  }
  return findings;
}
