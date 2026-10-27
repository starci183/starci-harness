// The forms of the skip-index reading of HFS_BYPASS_MARKER: a test-runner member spelled as an index is a bypass, a word in an array literal is not.
// A plain fixture module: the owner-pinned loosening fixtures stay as pinned and these cases live beside them.
// FORBIDDEN_INDEX: [{ id, file, text, kind }] - the tree { [file]: text } holds a loosening of `kind`.
// LOOKALIKES_INDEX: [{ id, file, text }] - the same words as data, which the check leaves alone.

const SPEC = 'packages/x/src/a.spec.mjs';

export const FORBIDDEN_INDEX = [
  { id: 'skip spelled as an index of the runner', file: SPEC, text: "describe['skip']('x', () => {});\nit[\"only\"]('y', () => {});\n", kind: 'bypass' },
];

export const LOOKALIKES_INDEX = [
  { id: 'a test title word in an it.each row of a spec', file: SPEC, text: "it.each([\n  ['skip', 'idea', 'skipped'],\n  ['reopen', 'approved', 'draft'],\n])('records the %s transition', () => {});\nit('should skip the row', () => {});\n" },
  { id: 'marker words as array elements and arguments in a spec', file: SPEC, text: "const kinds = ['skip', 'only', 'todo'];\nexpect(list([\"skip\"])).toEqual(['only']);\nreturn ['todo'];\n" },
];
