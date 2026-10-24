import type { OperationTable } from "./operation-contract"

/** Runtime boundary pipe declaration for symbol-provenance lint fixtures. */
export class OperationValidationPolicy<Table extends OperationTable> {
    constructor(readonly table: Table) {}
}
