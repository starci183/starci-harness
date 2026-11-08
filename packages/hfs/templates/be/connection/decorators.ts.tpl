import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { EntityManager } from "typeorm"

/** Token of the shared EntityManager of the `@@name@@` database; the database module provides it for the connection it opens. */
export const @@NAME@@_ENTITY_MANAGER: unique symbol = Symbol("platform.database.@@name@@-entity-manager")

/** Injects the shared EntityManager of the `@@name@@` database. Parameter type: EntityManager. */
export const Inject@@Pascal@@EntityManager = (): TypedParameterDecorator<EntityManager> =>
    injector<EntityManager>(@@NAME@@_ENTITY_MANAGER)
