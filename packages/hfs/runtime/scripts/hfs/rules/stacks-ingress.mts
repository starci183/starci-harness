// R275 and R266: each Swarm environment has one declared, digest-pinned ingress, or declares that the ingress is an external shared stack
// (`ingress.external: { stack }` with `hosts`): then the stack renders no ingress of its own and publishes no port.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { repositoryOf } from '../../lib/stack-services.mjs';
import { stacksDeploymentFindings } from './stacks-runtime.mjs';
import type { Parsed } from './rule-types.mjs';

const PINNED = /@sha256:[a-f0-9]{64}$/i;
const SUPPORTED = new Set(['traefik', 'caddy', 'caddy-docker-proxy']);
const mapping = (value: Parsed) => plain(value) ? value : {};
const present = (value: Parsed) => typeof value === 'string' && Boolean(value.trim());
const imageName = (image: string) => present(image) ? repositoryOf(image).toLowerCase() : '';
const ingressImage = (image: string) => SUPPORTED.has(imageName(image));

function ingressIds(components: Parsed, bindings: Parsed, services: Parsed, chosen: Parsed) {
  const ids = new Set();
  if (present(chosen)) ids.add(chosen);
  for (const id of Object.keys(bindings)) {
    const component = mapping(components[id]);
    if (component.role === 'ingress' || ingressImage(component.image)) ids.add(id);
  }
  for (const [id, entry] of Object.entries(services)) {
    const service = mapping(entry), component = mapping(components[id]);
    if (component.role === 'ingress' || ingressImage(service.image)) ids.add(id);
  }
  return [...ids];
}

/** True when the environment declares a shared edge ingress (`ingress.kind: shared-edge`): the stack renders no ingress, and its deploy renders the router labels from `ingress.routes`. */
export const sharedEdge = (spec: Parsed): boolean => spec?.ingress?.kind === 'shared-edge';

/** The routes of a shared edge declaration, as written. */
export const edgeRoutes = (spec: Parsed): Parsed[] => (Array.isArray(spec?.ingress?.routes) ? spec.ingress.routes : []);

/** The name of the shared external ingress stack the environment declares, or null. */
export const externalIngressStack = (spec: Parsed) => present(spec?.ingress?.external?.stack) ? spec.ingress.external.stack : null;

function externalIssues({ spec, candidates, at }: { spec: Parsed; candidates: Parsed; at: Parsed }) {
  const ingress = mapping(spec.ingress), errors = [];
  if (externalIngressStack(spec) === null || present(ingress.component) || !Array.isArray(ingress.hosts) || ingress.hosts.length === 0)
    errors.push({ code: 'STACKS_INGRESS_UNDECLARED', at,
      message: 'an external ingress is declared as ingress.external.stack with ingress.hosts and without ingress.component' });
  if (candidates.length > 0)
    errors.push({ code: 'STACKS_SECOND_INGRESS', at,
      message: 'a stack that declares an external shared ingress must not render an ingress of its own' });
  return errors;
}

function declarationIssues({ chosen, components, bindings, services, candidates, at }: { chosen: Parsed; components: Parsed; bindings: Parsed; services: Parsed; candidates: Parsed; at: Parsed }) {
  const errors = [];
  if (!present(chosen) || components[chosen]?.role !== 'ingress' || !Object.hasOwn(bindings, chosen) || !Object.hasOwn(services, chosen))
    errors.push({ code: 'STACKS_INGRESS_UNDECLARED', at,
      message: 'Swarm ingress must name one component with role ingress that is inventoried, bound and present in the rendered model' });
  const undeclared = candidates.filter((id: string) => id !== chosen);
  if (undeclared.length)
    errors.push({ code: 'STACKS_INGRESS_UNDECLARED', at,
      message: 'every rendered ingress must be the environment\'s declared ingress component' });
  if (candidates.length > 1)
    errors.push({ code: 'STACKS_SECOND_INGRESS', at,
      message: 'a Swarm environment must run exactly one ingress component; a second ingress is forbidden' });
  return errors;
}

function ingressImageIssues(ids: Parsed, components: Parsed, services: Parsed) {
  const errors = [];
  for (const id of ids) {
    for (const [prefix, source] of [['components', components], ['services', services]]) {
      if (!Object.hasOwn(source, id)) continue;
      const image = source[id]?.image;
      if (!SUPPORTED.has(imageName(image)) || !PINNED.test(String(image)))
        errors.push({ code: 'STACKS_INGRESS_UNKNOWN', at: `${prefix}.${id}.image`,
          message: 'the declared ingress must use Traefik or Caddy pinned by a sha256 digest' });
    }
  }
  return errors;
}

function sharedEdgeIssues({ spec, candidates, at }: { spec: Parsed; candidates: Parsed; at: Parsed }) {
  const ingress = mapping(spec.ingress), errors = [];
  const routes = edgeRoutes(spec);
  const bad = (message: string) => errors.push({ code: 'STACKS_INGRESS_UNDECLARED', at, message });
  if (!present(ingress.network) || !present(ingress.certResolver)) bad('a shared-edge ingress declares ingress.network (the edge overlay network) and ingress.certResolver');
  if (routes.length === 0 || routes.some((route: Parsed) => !present(route?.host) || !present(route?.service) || !Number.isInteger(route?.port)))
    bad('a shared-edge ingress declares ingress.routes, each with host, service and port: the stack deploy renders the Traefik labels from them');
  if (present(ingress.component) || ingress.external !== undefined) bad('a shared-edge ingress has no ingress.component and no ingress.external: the edge is shared, not part of this stack');
  const hosts = new Set(routes.map((route: Parsed) => String(route?.host).toLowerCase()));
  if (Array.isArray(ingress.hosts) && (ingress.hosts.length !== hosts.size || ingress.hosts.some((host: Parsed) => !hosts.has(String(host).toLowerCase()))))
    bad('ingress.hosts, when given beside shared-edge routes, must list exactly the hosts of ingress.routes: declare each host once, in routes');
  if (candidates.length > 0) errors.push({ code: 'STACKS_SECOND_INGRESS', at, message: 'a stack that declares a shared edge ingress must not render an ingress of its own' });
  return errors;
}

/** Static ingress contract shared by HFS and the rendered stacks gate. */
export function ingressIssues({ doc, environment, spec = doc?.environments?.[environment], model }: { doc: Parsed; environment: Parsed; spec?: Parsed; model: Parsed }) {
  if (spec?.runtime !== 'docker-swarm') return [];
  const components = mapping(doc?.components), bindings = mapping(spec.components), services = mapping(model?.services);
  const chosen = spec.ingress?.component, candidates = ingressIds(components, bindings, services, chosen);
  const at = `environments.${environment}.ingress`;
  if (sharedEdge(spec)) return sharedEdgeIssues({ spec, candidates, at });
  if (mapping(spec.ingress).external !== undefined) return externalIssues({ spec, candidates, at });
  const own = Array.isArray(spec.ingress?.hosts) && spec.ingress.hosts.length > 0 ? [] : [{ code: 'STACKS_INGRESS_UNDECLARED', at, message: 'an own ingress declares ingress.hosts, the public hosts it routes (a shared edge declares ingress.routes instead)' }];
  return [
    ...own,
    ...declarationIssues({ chosen, components, bindings, services, candidates, at }),
    ...ingressImageIssues(candidates, components, services),
  ];
}

/** HFS finder over the tracked rendered Swarm environments. */
export function stacksIngressFindings(context: Parsed) {
  return stacksDeploymentFindings(context, ingressIssues);
}
