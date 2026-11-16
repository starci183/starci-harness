import { createHash } from "node:crypto"

/** The docker network every container of the shared stack joins. */
export const STACK_NETWORK = "starci-test-net"
/** Label marking a container as part of the shared stack. */
export const LABEL_STACK = "starci.test-stack"
/** Label carrying the service name of a container. */
export const LABEL_SERVICE = "starci.service"
/** Label carrying the full image reference of a container. */
export const LABEL_IMAGE = "starci.image"

/** The toxiproxy image. */
export const TOXIPROXY_IMAGE = "ghcr.io/shopify/toxiproxy:2.9.0"
/** The container port of the toxiproxy REST API. */
export const TOXIPROXY_API_PORT = 8474
/** The first host port (and container port) of the pre-published proxy listen range. */
export const PROXY_PORT_FIRST = 30100
/** The last host port (and container port) of the pre-published proxy listen range. */
export const PROXY_PORT_LAST = 30227
/** The service label value of the toxiproxy container. */
export const TOXIPROXY_SERVICE = "toxiproxy"

/** The first 8 hex characters of the sha256 of an image reference: the key of a shared container. */
export const imageKey = (image: string): string => createHash("sha256").update(image).digest("hex").slice(0, 8)

/** The deterministic container name of a service on an image: `starci-ts-<service>-<imageKey>`. */
export const containerName = (service: string, image: string): string => `starci-ts-${service}-${imageKey(image)}`

/** The name of the toxiproxy proxy of one run and service. */
export const proxyNameOf = (runId: string, service: string): string => `${runId}-${service}`

/**
 * The ONE Kafka image of the StarCi stacks (dev, test world, prod): Apache Kafka in KRaft mode (Kafka 4 has no ZooKeeper
 * mode), pinned by its multi-arch index digest. The stack definition must name exactly this reference.
 */
export const KAFKA_IMAGE = "apache/kafka:4.2.2@sha256:1213eb3943d551e5ed1fca7a4e109001cee35770b66a02a0c37a8964efe09b69"

/** How many slot listeners the broker has: one per concurrently attached data slot, machine-wide. */
export const KAFKA_SLOT_LISTENERS = 8

/** The broker's shape, part of its container identity: a container of another shape is another container, never reused. */
const KAFKA_SHAPE = `slot-listeners-${KAFKA_SLOT_LISTENERS}`

/**
 * The ONE Debezium Server image of the StarCi stacks, pinned by its multi-arch index digest like Kafka: the stack definition
 * must name exactly this reference (the Postgres connector with the Redis stream sink ships in it).
 */
export const DEBEZIUM_IMAGE = "quay.io/debezium/server:3.0.8.Final@sha256:b898e3709abfe0a6fe6a51b7b8f23bba8a1ed26076e8bce8e4137a5e2d54f0c4"

/** How many replication slots and WAL senders a logical Postgres allows: one of each per attached data slot (8 machine-wide), doubled for the leftovers of a crashed run. */
export const POSTGRES_LOGICAL_CAPACITY = 16

/** The server arguments that turn logical decoding on; they are part of the container identity of a logical Postgres. */
export const POSTGRES_LOGICAL_ARGS: ReadonlyArray<string> = ["-c", "wal_level=logical", "-c", `max_replication_slots=${POSTGRES_LOGICAL_CAPACITY}`, "-c", `max_wal_senders=${POSTGRES_LOGICAL_CAPACITY}`]

/** The Postgres container shape of a logical-replication request: the image plus the arguments, so it never reuses (or alters) the default container. */
const POSTGRES_LOGICAL_SHAPE = POSTGRES_LOGICAL_ARGS.join(" ")

/** The container name of a service on an image; the Kafka broker's name also carries its listener shape, a logical Postgres its server arguments. */
export const serviceContainerName = (service: string, image: string, logicalReplication = false): string => {
    if (service === "kafka") return containerName(service, `${image}#${KAFKA_SHAPE}`)
    if (service === "postgresql" && logicalReplication) return containerName(service, `${image}#${POSTGRES_LOGICAL_SHAPE}`)
    return containerName(service, image)
}

/** The longest name Postgres accepts for a replication slot or a publication. */
const POSTGRES_NAME_LENGTH = 63

/** The replication slot and publication name of a data slot's Debezium: `<namespace.snake>_cdc`, shortened with a hash of the namespace when it would exceed Postgres's limit. */
export const debeziumSlotName = (snake: string): string => {
    const name = `${snake}_cdc`
    if (name.length <= POSTGRES_NAME_LENGTH) return name
    const hash = imageKey(snake)
    return `${snake.slice(0, POSTGRES_NAME_LENGTH - "_cdc".length - hash.length - 1)}_${hash}_cdc`
}

/** The name of the toxiproxy proxy of one slot listener (1-based) of the Kafka broker of one image. */
export const kafkaProxyName = (image: string, listener: number): string => `kafka-${imageKey(image)}-s${listener}`
