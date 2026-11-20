// The optional shared-service opt-in of a Swarm environment (`environments.<env>.services`, contexts/project/shared-services.md): every consumer it names is a
// service of the rendered model, and a docker-compose environment declares none (the shared services run beside a Swarm stack on the server). The schema
// holds the field shapes; the stack render (stack/shared-services.mts `sharedServicesOf`) refuses the same problems at deploy time, with the sealed members
// it can see. A member not sealed yet is the report-only STACKS_SEALED_MEMBER_PENDING of rules/stacks-deploy.mts, never a finding here.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import type { Parsed } from './rule-types.mjs';

/** The problems of one environment's shared-service opt-in against the rendered model; none when it declares none. */
export function sharedServiceIssues({ environment, spec, model }: { environment: Parsed; spec: Parsed; model: Parsed }): Array<{ code: string; at: string; message: string }> {
  const block = spec?.services;
  if (block === undefined) return [];
  const at = `environments.${environment}.services`;
  const bad = (message: string) => ({ code: 'HFS_STACKS_SHAPE', at, message });
  if (spec?.runtime !== 'docker-swarm') return [bad('only a docker-swarm environment opts in to the shared services of its server; remove the block from this environment')];
  if (!plain(block)) return [bad('the shared-service opt-in is a mapping of service name to {member, key, consumers}')];
  const services = plain(model?.services) ? model.services : {};
  const images = plain(spec?.deploy?.images) ? Object.keys(spec.deploy.images) : [];
  const issues = [];
  for (const [name, entry] of Object.entries<Parsed>(block)) {
    const consumers: string[] = Array.isArray(entry?.consumers) ? entry.consumers.map(String) : images;
    if (consumers.length === 0) issues.push(bad(`${name} has no consumer: name the stack services that call it in consumers`));
    for (const service of consumers) if (!Object.hasOwn(services, service)) issues.push(bad(`${name}.consumers names the service ${service}, which the rendered model does not hold`));
  }
  return issues;
}
