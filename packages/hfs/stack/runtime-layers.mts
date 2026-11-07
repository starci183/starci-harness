// runtime-layers.mts - the harness runtime layers a dev stack builds on (images/README.md "The OpenClaw runtime layer"; R374 STACKS_IMAGE_BASE_NOT_FORK).
// An app image folder `.starcistacks/images/<name>/Dockerfile` is `FROM ghcr.io/starci183/<layer>:<tag>[@sha256:<digest>]`. While the harness has not
// published that layer (or the host cannot pull it), `starci app stack up` builds it from the recipe this package ships (stack/images/<layer>/,
// byte-equal to the harness repository's images/<layer>/, which `npm run bundles` copies and a spec compares) and tags it with the reference the
// app names minus its digest, so the compose build of the app image finds it in the local store. The build is a governed heavy command
// (hard rule 8): an agent never runs docker by hand. A reference whose image the host already holds, or can pull, is left alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StackContext } from './context.mjs';
import { failure } from './errors.mjs';
import type { LocalConfig } from './local-config.mjs';

/** The registry path of the harness-owned layers: `<prefix><layer>`. */
export const LAYER_PREFIX = 'ghcr.io/starci183/';
/** The layers whose recipe this package ships. */
export const SHIPPED_LAYERS: readonly string[] = Object.freeze(['openclaw-runtime']);

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The folder holding the recipe of a layer in this package. */
export const recipeDirectory = (layer: string): string => path.join(HERE, 'images', layer);

/** One layer an app image builds on: the layer, the reference as the Dockerfile writes it and the tag a local build gives it. */
export interface LayerUse { layer: string; reference: string; tag: string; dockerfile: string }

/** The layers `.starcistacks/images/*` of the app builds on (each distinct reference once), from the `FROM` lines of its Dockerfiles. */
export function layersUsed(repoRoot: string): LayerUse[] {
  const folder = path.join(repoRoot, '.starcistacks', 'images');
  if (!fs.existsSync(folder)) return [];
  const found = new Map<string, LayerUse>();
  for (const entry of fs.readdirSync(folder, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const dockerfile = path.join(folder, entry.name, 'Dockerfile');
    if (!fs.existsSync(dockerfile)) continue;
    for (const line of fs.readFileSync(dockerfile, 'utf8').split(/\r?\n/u)) {
      const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)/iu.exec(line)?.[1];
      if (from?.startsWith(LAYER_PREFIX) !== true) continue;
      const reference = from;
      const tag = reference.replace(/@sha256:[0-9a-f]+$/u, '');
      const layer = tag.slice(LAYER_PREFIX.length).replace(/:.*$/u, '');
      if (SHIPPED_LAYERS.includes(layer) && !found.has(reference)) found.set(reference, { layer, reference, tag: tag.includes(':') ? tag : `${tag}:latest`, dockerfile: path.relative(repoRoot, dockerfile).split(path.sep).join('/') });
    }
  }
  return [...found.values()];
}

/** Whether the host holds `reference` or can pull it: the local store first, then the registry's manifest. */
async function available(ctx: StackContext, use: LayerUse): Promise<boolean> {
  if ((await ctx.spawn('docker', ['image', 'inspect', use.tag])).status === 0) return true;
  return (await ctx.spawn('docker', ['manifest', 'inspect', use.reference])).status === 0;
}

/** The lines of the plan a dry run prints for the layers the app builds on. */
export const layerPlan = (local: LocalConfig): string[] => layersUsed(local.repoRoot).map((use) => `plan runtime layer ${use.layer}: ${use.tag} is built from the shipped recipe when the host holds none and the registry has none`);

/** Builds every layer the app names that the host neither holds nor can pull; returns one line per layer. */
export async function ensureRuntimeLayers(ctx: StackContext, local: LocalConfig): Promise<string[]> {
  const lines: string[] = [];
  for (const use of layersUsed(local.repoRoot)) {
    if (await available(ctx, use)) { lines.push(`runtime layer ${use.layer}: ${use.tag} is available`); continue; }
    const recipe = recipeDirectory(use.layer);
    if (!fs.existsSync(path.join(recipe, 'Dockerfile'))) throw failure('STACK_LOCAL_RUNTIME_LAYER', `${use.dockerfile} builds on ${use.reference}, which is not published, and this package ships no recipe for ${use.layer}`);
    const argv = ['docker', 'build', '-t', use.tag, recipe];
    const built = ctx.heavy ? await ctx.heavy({ kind: 'build', label: `${local.project} runtime layer ${use.layer}`, cwd: local.repoRoot, argv, env: ctx.env }) : await ctx.spawn('docker', argv.slice(1), { cwd: local.repoRoot, env: ctx.env });
    if (built.status !== 0) throw failure('STACK_LOCAL_RUNTIME_LAYER', `docker build of the runtime layer ${use.layer} failed: ${(built.stderr.trim().split(/\r?\n/u)[0] ?? '').slice(0, 200)}`);
    lines.push(`runtime layer ${use.layer}: ${use.reference} is not published; built ${use.tag} from the recipe this package ships`);
  }
  return lines;
}
