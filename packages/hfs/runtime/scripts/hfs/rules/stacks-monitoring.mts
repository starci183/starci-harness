// The optional monitoring opt-in of a Swarm environment (`environments.<env>.monitoring`, contexts/project/monitoring.md): every service it names
// (metrics, exporters, traces, profiles) is a service of the rendered model, a scraped service is named once, probes are at most 10 http(s) URLs,
// and a docker-compose environment declares none (the shared monitoring stack runs beside a Swarm stack). The schema holds the field shapes; the
// stack render (stack/monitoring.mts `monitoringOf`) refuses the same problems at deploy time, with the sealed members it can see.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import type { Parsed } from './rule-types.mjs';

const SIDECAR_KINDS = new Set(['postgres', 'redis']);
const URL_FORM = /^https?:\/\/\S+$/u;

/** The problems of one environment's monitoring opt-in against the rendered model; none when it declares no opt-in. */
export function monitoringIssues({ environment, spec, model, doc }: { environment: Parsed; spec: Parsed; model: Parsed; doc?: Parsed }): Array<{ code: string; at: string; message: string }> {
  const block = spec?.monitoring;
  if (block === undefined) return [];
  const at = `environments.${environment}.monitoring`;
  const bad = (message: string) => ({ code: 'HFS_STACKS_SHAPE', at, message });
  if (spec?.runtime !== 'docker-swarm') return [bad('only a docker-swarm environment opts in to the shared monitoring stack; remove the block from this environment')];
  if (!plain(block)) return [bad('the monitoring opt-in is a mapping of network, logs, logPush, metrics, probes, exporters, traces and profiles')];
  const services = plain(model?.services) ? model.services : {};
  const has = (service: string) => Object.hasOwn(services, service);
  const issues = [];
  const scraped = new Set<string>();
  const scrape = (where: string, service: string) => {
    if (!has(service)) issues.push(bad(`${where} names the service ${service}, which the rendered model does not hold`));
    if (scraped.has(service)) issues.push(bad(`${where} names the service ${service} a second time: one metrics port per service`));
    scraped.add(service);
  };
  for (const entry of Array.isArray(block.metrics) ? block.metrics : []) scrape('metrics', String(entry?.service ?? ''));
  const backingPostgres = Object.values(plain(doc?.backing) ? doc.backing : {}).map((entry: Parsed) => (entry?.provider === 'postgres' ? String(entry?.component ?? '') : '')).find((component) => component !== '');
  for (const entry of Array.isArray(block.exporters) ? block.exporters : []) {
    const kind = String(entry?.kind ?? '');
    const service = String(entry?.service ?? (kind === 'postgres' ? backingPostgres ?? '' : ''));
    if (!SIDECAR_KINDS.has(kind)) { scrape(`exporters (${kind})`, service); continue; }
    if (!has(service)) issues.push(bad(`exporters (${kind}) names the service ${service || '(none)'}, which the rendered model does not hold`));
    if (kind === 'postgres' && entry?.password === undefined) issues.push(bad(`exporters (postgres) of ${service} needs password: {member, key}, the sealed password of its read-only monitoring role`));
    if (kind === 'redis' && entry?.password !== undefined) issues.push(bad(`exporters (redis) of ${service}: a password is not supported yet`));
  }
  if (Array.isArray(block.probes)) {
    if (block.probes.length > 10) issues.push(bad(`probes holds ${block.probes.length} URLs; at most 10`));
    for (const url of block.probes) if (!URL_FORM.test(String(url))) issues.push(bad(`probes holds ${JSON.stringify(url)}, which is no http(s) URL`));
  }
  for (const flag of ['traces', 'profiles', 'logPush']) for (const service of Array.isArray(block[flag]) ? block[flag].map(String) : []) if (!has(service)) issues.push(bad(`${flag} names the service ${service}, which the rendered model does not hold`));
  return issues;
}
