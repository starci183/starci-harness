/** The app-relative path of a topic file, whose root defaults to the back end. */
export const patternFilePath = (file, root = 'be') => root === 'app' ? file : `${root}/${file}`;

const unquote = (item) => item.trim().replace(/^["']|["']$/g, '');

/** Derives slots for files/liteFiles entries through the app resolver supplied by the caller. */
export function derivePatternFileSlots(text, classify) {
  const lines = text.split('\n');
  const problems = [];
  let inFiles = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(lines[i])) inFiles = /^(?:files|liteFiles):\s*$/.test(lines[i]);
    if (!inFiles) continue;
    const match = /^ {2}- path: (.+)$/.exec(lines[i]);
    if (!match) continue;
    const entry = deriveFileSlot(lines, i, match[1], classify);
    if (entry.problem) problems.push(entry.problem);
    else lines[entry.slotAt] = `    slot: ${entry.slot}`;
  }
  return { text: lines.join('\n'), problems };
}

/** The fields of one file entry stop at the next entry or top-level YAML key. */
function deriveFileSlot(lines, start, file, classify) {
  let end = start + 1;
  while (end < lines.length && !/^(?:[A-Za-z][A-Za-z0-9_-]*:| {2}- )/.test(lines[end])) end += 1;
  const slotAt = lines.findIndex((line, index) => index > start && index < end && /^ {4}slot: /.test(line));
  if (slotAt < 0) return { problem: `${file} has no slot line` };
  const rootLine = lines.slice(start + 1, end).find((line) => /^ {4}root: /.test(line));
  const root = rootLine ? unquote(rootLine.replace(/^ {4}root: /, '')) : 'be';
  const slot = classify(patternFilePath(unquote(file), root));
  return slot ? { slotAt, slot } : { problem: `${file} is owned by no slot` };
}
