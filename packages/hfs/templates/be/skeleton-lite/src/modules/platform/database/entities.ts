/**
 * The entity list of the primary connection: each capability's `<c>Entities` array (its `persistence/entities/index.ts`), by
 * name, no glob. Only an app's composition root imports this file, from the deep path `@modules/platform/database/entities`;
 * DatabaseModule and the database barrel never do, since the capability barrels import the database capability back.
 */
export const PRIMARY_ENTITIES: ReadonlyArray<Function> = []
