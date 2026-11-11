// project-name.mts - a project's name says what it is (contexts/project/README.md PROJECT-4): `<base>[-lite][-data]`. An app of the lite edition is
// `<base>-lite`, an app of the full edition never ends in `-lite`, and `-data` is kept for a project's separate data repository
// (`<project name>-data`), so no app name ends in it. The name read is hfs.json `project`: the one declared identity, beside the `edition` it must
// agree with; the root package.json name and the stack's repository are written from it.

/** The suffix of a lite edition project. */
export const LITE_SUFFIX = '-lite';
/** The suffix kept for a project's separate data repository. */
export const DATA_SUFFIX = '-data';

/** Why the app name `name` does not fit `edition` (absent: full), or null when it does. Pure. */
export function projectNameProblem(name: string, edition: string | undefined): string | null {
  if (name.endsWith(DATA_SUFFIX)) return `the project name ${name} ends in ${DATA_SUFFIX}, which names a project's separate data repository (<project name>${DATA_SUFFIX}), never an app`;
  const lite = (edition ?? 'full') === 'lite';
  if (lite && !name.endsWith(LITE_SUFFIX)) return `the project ${name} is of the lite edition, so its name ends in ${LITE_SUFFIX} (${name}${LITE_SUFFIX})`;
  if (!lite && name.endsWith(LITE_SUFFIX)) return `the project ${name} is of the full edition, so its name does not end in ${LITE_SUFFIX} (${name.slice(0, -LITE_SUFFIX.length)})`;
  return null;
}
