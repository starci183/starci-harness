import { mockEntityManager } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import { DatabaseErrorCode } from "./errors/database.error"
import { recordWebhookDelivery, webhookReceiptInsert } from "./webhook-inbox.client"

const INSERT = webhookReceiptInsert("spec_inbox")
const PAYLOAD = { id: "delivery-1" }

const record = (manager: EntityManager, deliveryId: string | undefined) =>
    recordWebhookDelivery({ manager, table: "spec_inbox", provider: "spec", deliveryId, payload: PAYLOAD })

describe("webhookReceiptInsert", () => {
    it("refuses a table name that is not a lowercase identifier", () => {
        expect(() => webhookReceiptInsert("spec; drop table x")).toThrow(TypeError)
    })
})

describe("recordWebhookDelivery", () => {
    it("records a new delivery through the caller's transaction manager", async () => {
        const manager = mockEntityManager({ query: [INSERT, [{ id: "inbox-1" }]] })

        const receiptId = await record(manager, "  delivery-1  ")

        expect(manager.query).toHaveBeenCalledTimes(1)
        expect(manager.query).toHaveBeenCalledWith(INSERT, ["spec", "delivery-1", JSON.stringify(PAYLOAD)])
        expect(receiptId).toBe("inbox-1")
    })

    it("acknowledges a duplicate without any completion or business write", async () => {
        const manager = mockEntityManager({ query: [INSERT, []] })

        const receiptId = await record(manager, "delivery-1")

        expect(manager.query).toHaveBeenCalledTimes(1)
        expect(receiptId).toBeUndefined()
    })

    it.each([["no", undefined], ["a blank", "   "]])("refuses %s delivery id before writing a receipt", async (_label, deliveryId) => {
        const manager = mockEntityManager()

        await expect(record(manager, deliveryId)).rejects.toMatchObject({ code: DatabaseErrorCode.WebhookDeliveryIdRequired })

        expect(manager.query).not.toHaveBeenCalled()
    })
})
