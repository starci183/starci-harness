import { ordersEntities } from "@modules/domain/orders/persistence/entities"

/** Every entity of the app, one array per owning capability. */
export const entities = [...ordersEntities]
