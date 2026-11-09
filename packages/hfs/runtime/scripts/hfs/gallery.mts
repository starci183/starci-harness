// gallery.mts - the screenshot gallery every app carries (R395, contexts/project/gallery.md PROJECT-GALLERY-1): the parameters the rule, the sync
// templates and the dev stack read from `ruleParams.gallery` of the slot manifest, and the one place the gallery port is derived from the project
// base port (`environments.<env>.local.basePort`, stack-base-port.mts): base + `portOffset`. Pure functions; nothing here touches the disk.
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { loadSlotManifest } from './slots.mjs';

/** The `ruleParams.gallery` block of the slot manifest. */
export interface GalleryParams {
  /** The folder of the gallery app at the app root. */
  dir: string;
  /** The package script that serves it. */
  devScript: string;
  /** The gallery port is the project base port plus this. */
  portOffset: number;
  /** The exact Vite version the managed package.json pins. */
  vite: string;
  /** The folder of the screenshots, app-root relative. */
  shots: string;
  /** The gitignore pattern, relative to the gallery folder, that keeps the PNGs out of git. */
  ignoredShots: string;
}

type Manifest = { ruleParams?: Record<string, unknown> };

/** The gallery parameters of the manifest (the bundled one by default). */
export function galleryParams(manifest: Manifest = loadSlotManifest() as Manifest): GalleryParams {
  const block = manifest.ruleParams?.['gallery'];
  if (!plain(block)) throw new Error('the slot manifest has no ruleParams.gallery');
  return block as unknown as GalleryParams;
}

/** The port the gallery of an app serves on, or null when the app declares no base port. */
export const galleryPort = (basePort: number | null | undefined, params: GalleryParams): number | null =>
  typeof basePort === 'number' && Number.isInteger(basePort) ? basePort + params.portOffset : null;

/** The `local.basePort` of a parsed stack declaration: the dev environment's when it declares one, else the first docker-compose environment's; null when none. */
export function declaredBasePort(doc: unknown): number | null {
  const environments = plain(doc) && plain((doc as Record<string, unknown>)['environments']) ? (doc as { environments: Record<string, unknown> }).environments : {};
  const order = ['dev', ...Object.keys(environments).filter((name) => name !== 'dev')];
  for (const name of order) {
    const spec = environments[name];
    if (!plain(spec) || (spec as Record<string, unknown>)['runtime'] !== 'docker-compose') continue;
    const local = (spec as Record<string, unknown>)['local'];
    const base = plain(local) ? (local as Record<string, unknown>)['basePort'] : undefined;
    if (Number.isInteger(base)) return base as number;
  }
  return null;
}
