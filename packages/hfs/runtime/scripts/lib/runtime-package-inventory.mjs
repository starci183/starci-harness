// The root archive's names equal npm's selection from tracked inputs and verified generated copies.
import { byCodeUnit } from './list.mjs';

const relativeFile = (file) => typeof file === 'string' && file.length > 0 && !/^[a-z]:/i.test(file) && !file.includes('\0') && !file.includes('\\') && !file.split('/').some((part) => !part || part === '.' || part === '..');

/** Exact selected-set proof; source-byte equality remains owned by verifyPackedDependencies. */
export function runtimePackageInventory({ files, tracked, generated = [], selected }) {
  if (!Array.isArray(tracked) || !tracked.length || !tracked.every(relativeFile)) return { unrun: 'the tracked file inventory of the root is unavailable or malformed' };
  if (!Array.isArray(selected) || !selected.length || !selected.every(relativeFile) || new Set(selected).size !== selected.length) return { unrun: 'npm did not return a complete, unique tracked-projection inventory' };
  if (!Array.isArray(generated) || !generated.every(relativeFile)) return { unrun: 'the verified generated file inventory is malformed' };
  const trackedSet = new Set(tracked), generatedSet = new Set(generated), selectedSet = new Set(selected);
  const unknown = selected.filter((file) => !trackedSet.has(file) && !generatedSet.has(file));
  if (unknown.length) return { unrun: `npm selected files outside the tracked projection: ${unknown.slice(0, 5).join(', ')}` };
  const packed = [...files.keys()];
  const foreign = packed.filter((file) => !file.startsWith('package/') || !selectedSet.has(file.slice('package/'.length))).sort(byCodeUnit);
  if (foreign.length) return { red: `root archive carries ${foreign.length} file(s) outside npm's tracked-only selection (ignored build output or scratch): ${foreign.slice(0, 5).join(', ')}` };
  const missing = selected.filter((file) => !files.has(`package/${file}`)).sort(byCodeUnit);
  if (missing.length) return { red: `root archive omits ${missing.length} file(s) from npm's tracked-only selection: ${missing.slice(0, 5).join(', ')}` };
  const generatedCount = selected.filter((file) => !trackedSet.has(file) && generatedSet.has(file)).length;
  return { tracked: selected.length - generatedCount, generated: generatedCount };
}
