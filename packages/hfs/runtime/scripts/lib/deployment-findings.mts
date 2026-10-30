/** Project issues from available rendered deployments with the caller's finding factory. */
export function deploymentFindings<D extends { unavailable?: boolean; file?: string }, I extends { code: string; at: string; message: string }, F>(
  deployments: readonly D[],
  issuesFor: (entry: D) => readonly I[],
  findingFor: (code: string, file: string, message: string) => F,
  defaultFile: string,
): F[] {
  return deployments.filter(entry => !entry.unavailable).flatMap(entry => {
    const file = entry.file ?? defaultFile;
    return issuesFor(entry).map(issue => findingFor(issue.code, file, `${file}: ${issue.at}: ${issue.message}`));
  });
}
