/** The app-relative path of a topic file, whose root defaults to the back end. */
export const patternFilePath = (file: string, root = 'be'): string => root === 'app' ? file : `${root}/${file}`;

const unquote = (item: string) => item.trim().replace(/^["']|["']$/g, '');

/** Derives slots for files/liteFiles entries through the app resolver supplied by the caller. */
export function derivePatternFileSlots(text: string, classify: (path: string) => string | null | undefined): { text: string, problems: string[] } {
  const lines = text.split('\n');
  const problems: string[] = [];
  let inFiles = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(line)) inFiles = /^(?:files|liteFiles):\s*$/.test(line);
    if (!inFiles) continue;
    const match = /^ {2}- path: (.+)$/.exec(line);
    if (!match) continue;
    const entry = deriveFileSlot(lines, i, match[1]!, classify); // the pattern has one group
    if ('problem' in entry) problems.push(entry.problem);
    else lines[entry.slotAt] = `    slot: ${entry.slot}`;
  }
  return { text: lines.join('\n'), problems };
}

/** The fields of one file entry stop at the next entry or top-level YAML key. */
function deriveFileSlot(lines: readonly string[], start: number, file: string, classify: (path: string) => string | null | undefined): { problem: string } | { slotAt: number, slot: string } {
  let end = start + 1;
  while (end < lines.length && !/^(?:[A-Za-z][A-Za-z0-9_-]*:| {2}- )/.test(lines[end] ?? '')) end += 1;
  const slotAt = lines.findIndex((line, index) => index > start && index < end && /^ {4}slot: /.test(line));
  if (slotAt < 0) return { problem: `${file} has no slot line` };
  const rootLine = lines.slice(start + 1, end).find((line) => /^ {4}root: /.test(line));
  const root = rootLine ? unquote(rootLine.replace(/^ {4}root: /, '')) : 'be';
  const slot = classify(patternFilePath(unquote(file), root));
  return slot ? { slotAt, slot } : { problem: `${file} is owned by no slot` };
}
