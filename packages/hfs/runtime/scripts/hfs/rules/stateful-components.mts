// stateful-components.mts - the one definition of "this component keeps state" of a stack declaration. R267 (BACKUP_UNDECLARED: a swarm
// environment's backup records) and R426 (DATA_STORE_INVALID: a store or a derived entry of the data declaration) both ask it, so the two
// rules can never disagree on which components owe recovery.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import type { Parsed } from './rule-types.mjs';

const mapping = (value: Parsed) => plain(value) ? value : {};
const present = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());

function persistentVolume(volume: unknown) {
  if (plain(volume)) return volume.type === 'volume' && present(volume.source);
  if (!present(volume)) return false;
  const source = volume.split(':')[0] as string; // split always yields one element
  return volume.includes(':') && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(source);
}

/** True when `component` (its declaration) or `service` (its compiled service) keeps state: a stateful role, a database, a volume. */
export function stateful(component: Parsed, service: Parsed) {
  return component.role === 'stateful' || component.stateful === true
    || present(component.database) || present(component.database?.provider)
    || (Array.isArray(component.volumes) && component.volumes.length > 0)
    || (Array.isArray(service.volumes) && service.volumes.some(persistentVolume));
}

/** The components of the selection that owe recovery: every declared backing, and every stateful component of `spec.components` or `model.services`. */
export function recoveryComponents({ doc, spec, model }: { doc: Parsed; spec: Parsed; model: Parsed }) {
  const components = mapping(doc.components), services = mapping(model?.services);
  const selected = new Set([...Object.keys(mapping(spec.components)), ...Object.keys(services)]);
  // Every declared backing (the db: backing.db naming its component) owes a backup, as every stateful component does.
  const required = new Set(Object.entries<Parsed>(mapping(doc.backing)).filter(([, entry]) => typeof entry?.provider === 'string').map(([id]) => id));
  for (const id of selected) if (stateful(mapping(components[id]), mapping(services[id]))) required.add(id);
  return [...required];
}

/** The components of a whole stack declaration that owe recovery, whatever the environment: every declared component (and backing) judged by `stateful`. */
export function statefulComponentsOf(doc: Parsed): string[] {
  return recoveryComponents({ doc, spec: { components: mapping(doc?.components) }, model: {} });
}
