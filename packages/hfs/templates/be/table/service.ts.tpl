import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectPrimaryEntityManager, requireOwnedEntity } from "@modules/platform/database"
import { {{Name}}Error, {{Name}}ErrorCode } from "./errors/{{name}}.error"
import { {{Singular}}Entity } from "./persistence/entities/{{name}}.entity"

/** What the capability answers for one row: its id. */
type {{Name}}Result = Pick<{{Singular}}Entity, "id">

/** Throws the typed not-found error of one id: absent and denied rows share it. */
const notFound = (id: string): never => {
    throw new {{Name}}Error({ code: {{Name}}ErrorCode.NotFound, params: { id } })
}

@Injectable()
/** The {{name}} rows reached only through the {{Singular}}Entity on the shared primary EntityManager. */
export class {{Name}}Service {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** Answers one row owned by the authenticated principal; absent and denied rows share one typed not-found result. */
    {{nameCamel}}(principalId: string, id: string): Promise<{{Name}}Result> {
        return requireOwnedEntity(this.entityManager, {{Singular}}Entity, id, principalId, notFound)
    }
}
