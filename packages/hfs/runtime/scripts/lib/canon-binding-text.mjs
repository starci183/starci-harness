// Canon release binding edits preserve authored profile text and update only the selected binding's identity.

const KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function supportedBinding(value) {
  const keys = typeof value === 'string' ? value.split('.') : [];
  return (keys.length === 1 && keys[0] === 'canon') || (keys.length === 2 && keys[0] === 'familyCanons' && KEY.test(keys[1]));
}

function lineEntry(line, index) {
  const text = line.slice(0, line.length - lineEnding(line).length);
  if (!text.trim() || text.trimStart().startsWith('#')) return null;
  let indent = 0;
  while (text[indent] === ' ') indent++;
  const colon = text.indexOf(':', indent);
  const key = colon < 0 ? '' : text.slice(indent, colon);
  if (!KEY.test(key)) return { index, indent };
  let valueAt = colon + 1;
  while (text[valueAt] === ' ' || text[valueAt] === '\t') valueAt++;
  return { index, indent, key, prefix: text.slice(0, valueAt), value: text.slice(valueAt) };
}

function lineEnding(line) {
  if (line.endsWith('\r\n')) return '\r\n';
  return line.endsWith('\n') ? '\n' : '';
}

function linesOf(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\n') continue;
    lines.push(text.slice(start, index + 1));
    start = index + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function child(entries, parent, key, at) {
  const nested = entries.filter(entry => entry.index > parent.start && entry.index < parent.end && entry.indent > parent.indent);
  const directIndent = Math.min(...nested.map(entry => entry.indent));
  const found = nested.filter(entry => entry.indent === directIndent && entry.key === key);
  if (found.length !== 1) throw new Error(`${at}: expected one ${key} field, found ${found.length}`);
  const entry = found[0];
  const boundary = entries.find(candidate => candidate.index > entry.index && candidate.index < parent.end && candidate.indent <= entry.indent);
  return { ...entry, start: entry.index, end: boundary?.index ?? parent.end };
}

function mapping(entries, parent, key, at) {
  const node = child(entries, parent, key, at);
  if (node.value.trim() && !node.value.trim().startsWith('#')) throw new Error(`${at}.${key}: expected a block mapping`);
  return node;
}

function scalar(entries, parent, key, at) {
  const node = child(entries, parent, key, at);
  if (!node.value.trim() || node.value.trim().startsWith('#')) throw new Error(`${at}.${key}: expected a scalar value`);
  return node;
}

function scalarParts(value) {
  const quote = value[0] === "'" || value[0] === '"' ? value[0] : null;
  let end = quote ? value.indexOf(quote, 1) : 0;
  if (quote && end < 1) return null;
  if (quote) end++;
  else {
    while (end < value.length && value[end].trim() && !['#', "'", '"'].includes(value[end])) end++;
  }
  if (!end) return null;
  let tail = end;
  while (value[tail] === ' ' || value[tail] === '\t') tail++;
  if (tail < value.length && (tail === end || value[tail] !== '#')) return null;
  return { value: quote ? value.slice(1, end - 1) : value.slice(0, end), suffix: value.slice(end) };
}

function packageValue(value) {
  return scalarParts(value)?.value;
}

function replaceScalar(lines, node, value) {
  const parts = scalarParts(node.value);
  if (!parts) throw new Error(`Cannot replace malformed scalar ${node.key}`);
  lines[node.index] = `${node.prefix}${value}${parts.suffix}${lineEnding(lines[node.index])}`;
}

function bindingNode(entries, root, row) {
  const at = `profiles.${row.profile}.${row.binding}`;
  let node = mapping(entries, root, 'profiles', 'document');
  node = mapping(entries, node, row.profile, 'profiles');
  for (const key of row.binding.split('.')) node = mapping(entries, node, key, at);
  const declared = scalar(entries, node, 'package', at);
  if (packageValue(declared.value) !== row.package) throw new Error(`${at}: package does not match ${row.package}`);
  return { node, at };
}

/**
 * Render release version and digest updates at their exact profile binding paths without reserializing authored YAML.
 * Unrelated bytes, comments and newline style are preserved. Missing or duplicate mapping paths, unexpected packages,
 * incomplete digest blocks and invalid replacement identities throw before any caller writes the returned text.
 * @param {string} original - The authored code-pattern profile YAML.
 * @param {Array<{profile: string, binding: string, package: string, to: {version: string, value: string, files: number}}>} rows - Exact canon or family binding identities to replace.
 * @returns {string} Updated profile YAML; the input is returned unchanged when no rows are supplied.
 */
export function renderCanonBindingChanges(original, rows) {
  if (typeof original !== 'string' || !Array.isArray(rows)) throw new Error('canon binding changes need YAML text and identity rows');
  const lines = linesOf(original);
  const entries = lines.map((line, index) => lineEntry(line, index)).filter(Boolean);
  const root = { start: -1, end: lines.length, indent: -1 };
  const selected = new Set();
  for (const row of rows) {
    if (!KEY.test(row?.profile ?? '') || !supportedBinding(row?.binding) || typeof row?.package !== 'string' || !row.package) throw new Error('canon binding changes need a supported profile, package and binding path');
    const identity = `${row.profile}.${row.binding}`;
    if (selected.has(identity)) throw new Error(`${identity}: duplicate binding change`);
    selected.add(identity);
    if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(row.to?.version ?? '') || !/^[a-f0-9]{64}$/i.test(row.to?.value ?? '')
      || !Number.isSafeInteger(row.to?.files) || row.to.files < 1) throw new Error(`${identity}: invalid replacement version or digest`);
    const { node, at } = bindingNode(entries, root, row);
    const version = scalar(entries, node, 'version', at);
    const digest = mapping(entries, node, 'contentDigest', at);
    const value = scalar(entries, digest, 'value', `${at}.contentDigest`);
    const files = scalar(entries, digest, 'files', `${at}.contentDigest`);
    replaceScalar(lines, version, row.to.version);
    // A hexadecimal digest can contain digits only; quoting preserves its string identity in YAML.
    replaceScalar(lines, value, `'${row.to.value}'`);
    replaceScalar(lines, files, row.to.files);
  }
  return lines.join('');
}
