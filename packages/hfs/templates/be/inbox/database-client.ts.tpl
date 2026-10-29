import type { EntityManager } from "typeorm"
import { DatabaseError, DatabaseErrorCode } from "./errors/database.error"
import { returnedRows, rowShape } from "./returned-rows.policy"

interface RecordWebhookDelivery {
    readonly manager: EntityManager
    /** The provider inbox table under public, created by its db migration. */
    readonly table: string
    readonly provider: string
    readonly deliveryId: string | undefined
    readonly payload: object
}

type WebhookReceiptId = string | undefined

/** The row the receipt insert returns to the winning transaction. */
const isReceiptRow = rowShape({ id: "string" })

/** A provider inbox table name: a lowercase identifier, never a value. */
const TABLE = /^[a-z_][a-z0-9_]*$/

/** The conflict-safe insert of one pending delivery into `public.<table>`, answering its id only to the winning transaction. */
export const webhookReceiptInsert = (table: string): string => {
    if (!TABLE.test(table)) throw new TypeError(`${table} is not a provider inbox table name`)
    return `INSERT INTO public.${table} (provider, delivery_id, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT (provider, delivery_id) DO NOTHING RETURNING id`
}

/**
 * Records one pending delivery using the intake's transaction manager and returns its durable receipt identity.
 * Business processing and the completion marker belong to the reactor or job that consumes the committed row.
 */
export const recordWebhookDelivery = async ({
    manager,
    table,
    provider,
    deliveryId,
    payload,
}: RecordWebhookDelivery): Promise<WebhookReceiptId> => {
    const normalizedDeliveryId = deliveryId?.trim()
    if (!normalizedDeliveryId) {
        throw new DatabaseError({ code: DatabaseErrorCode.WebhookDeliveryIdRequired })
    }
    const inserted: unknown = await manager.query(webhookReceiptInsert(table), [
        provider,
        normalizedDeliveryId,
        JSON.stringify(payload),
    ])
    return returnedRows(inserted, isReceiptRow)[0]?.id
}
