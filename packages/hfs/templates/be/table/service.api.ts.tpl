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

/** The id of the row an insert saved; a save that answered none throws the typed not-created error. */
const createdRow = (row: {{Singular}}Entity): {{Name}}Result => {
    if (!row.id) throw new {{Name}}Error({ code: {{Name}}ErrorCode.NotCreated })
    return { id: row.id }
}

@Injectable()
/** The {{name}} rows reached only through the {{Singular}}Entity on the shared primary EntityManager. */
export class {{Name}}Service {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** Answers one row owned by the authenticated principal; absent and denied rows share one typed not-found result. */
    {{nameCamel}}(principalId: string, id: string): Promise<{{Name}}Result> {
        return requireOwnedEntity(this.entityManager, {{Singular}}Entity, id, principalId, notFound)
    }

    /** Creates one row owned by the authenticated principal and answers its id. */
    create{{Singular}}(principalId: string): Promise<{{Name}}Result> {
        return this.entityManager.save({{Singular}}Entity, { ownerId: principalId }).then(createdRow)
    }
}
