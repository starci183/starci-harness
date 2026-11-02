import { builder } from "@starci/jest-preset"
import { OrderEntity } from "@modules/domain/order/persistence/entities/order.entity"

/** A shared factory whose initializer, rather than its signature or filename, proves its origin. */
export const orderOf = builder<OrderEntity>({ id: "default" })
