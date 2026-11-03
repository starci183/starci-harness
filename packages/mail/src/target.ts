import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"
import { MAIL_ERROR_CODES, MailError } from "./errors.ts"

/** The ports a public mail server listens on. */
export const PUBLIC_MAIL_PORTS: ReadonlySet<number> = new Set([25, 465, 587, 2465, 2525, 2587])

const NON_PUBLIC = new BlockList()
for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const) {
    NON_PUBLIC.addSubnet(network, prefix, "ipv4")
}
for (const [network, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
] as const) {
    NON_PUBLIC.addSubnet(network, prefix, "ipv6")
}

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu

/** Whether an address is one a mail server on the public internet never has: loopback, private, link-local, unique-local, shared (CGNAT), multicast, reserved or unspecified. An IPv4-mapped IPv6 address is judged as its IPv4. */
export const isPrivateAddress = (address: string): boolean => {
    const mapped = MAPPED_V4.exec(address)?.[1]
    const text = mapped ?? address
    const family = isIP(text)
    if (family === 0) return true
    return NON_PUBLIC.check(text, family === 4 ? "ipv4" : "ipv6")
}

const LABEL = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/u

/** Whether a text is a host name (dot-separated ASCII labels) or an IP literal. */
export const isWellFormedHost = (host: string): boolean => {
    if (host.length === 0 || host.length > 253) return false
    if (isIP(host) !== 0) return true
    return host.split(".").every((label) => LABEL.test(label))
}

/** The addresses a host name resolves to; the default resolver of `assertSmtpTarget`. */
export type ResolveAddresses = (host: string) => Promise<readonly string[]>

const systemResolver: ResolveAddresses = async (host) => (await lookup(host, { all: true })).map((record) => record.address)

/** What `assertSmtpTarget` may be told. */
export interface SmtpTargetPolicy {
    /** Also admit private, loopback and link-local addresses and any port: a development mail catcher. Defaults to false. */
    readonly allowPrivate?: boolean
    /** The resolver; a spec passes a fixed one. Defaults to the system's. */
    readonly resolve?: ResolveAddresses
}

/**
 * Judges a mail server a user chose (a workspace's own SMTP account): a well-formed host, a valid port that is a public mail
 * port, and a host that resolves, after DNS, only to public addresses. Refuses with `MAIL_DNS` (not a host, or it does not
 * resolve) or `MAIL_CONNECT` (a port that is not a mail port, or an address inside the network) and answers the addresses
 * otherwise.
 */
export const assertSmtpTarget = async (host: string, port: number, policy: SmtpTargetPolicy = {}): Promise<readonly string[]> => {
    if (!isWellFormedHost(host)) throw new MailError(MAIL_ERROR_CODES.Dns, { detail: host.slice(0, 80) })
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new MailError(MAIL_ERROR_CODES.Connect, { detail: `port ${String(port)}` })
    const relaxed = policy.allowPrivate === true
    if (!relaxed && !PUBLIC_MAIL_PORTS.has(port)) throw new MailError(MAIL_ERROR_CODES.Connect, { detail: `port ${String(port)} is not a mail port` })
    let addresses: readonly string[]
    if (isIP(host) !== 0) addresses = [host]
    else {
        try {
            addresses = await (policy.resolve ?? systemResolver)(host)
        } catch (cause) {
            throw new MailError(MAIL_ERROR_CODES.Dns, { cause, detail: host.slice(0, 80) })
        }
    }
    if (addresses.length === 0) throw new MailError(MAIL_ERROR_CODES.Dns, { detail: host.slice(0, 80) })
    if (!relaxed && addresses.some(isPrivateAddress)) throw new MailError(MAIL_ERROR_CODES.Connect, { detail: "private address" })
    return addresses
}
