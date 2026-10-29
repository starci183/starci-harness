// entity-list.mjs - where an app keeps its TypeORM entity list, read by `starci app db drift` and by the release gate that runs it.
import fs from 'node:fs';
import path from 'node:path';

/** The app's one entity list: it re-exports the arrays each capability's persistence/entities/index.ts exports. */
export const ENTITY_LIST = 'be/src/modules/platform/database/entities.ts';

/** True when the app at `root` keeps an entity list: the apps whose entities `starci app db drift` checks and whose release gate runs it. */
export const hasEntityList = (root) => fs.existsSync(path.join(root, ENTITY_LIST));
