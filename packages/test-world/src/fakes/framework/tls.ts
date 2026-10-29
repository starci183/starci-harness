/**
 * The TLS material of HTTPS fakes: an ephemeral certificate authority made once per process (so once per run of the fakes
 * host) and one server certificate it signs for the loopback names a fake is reached by (`127.0.0.1`, `::1`, `localhost`,
 * `host.docker.internal`). Nothing is written to disk and nothing is trusted globally: the CA's PEM goes to the app through
 * the wiring (`w.fake.<name>.ca`), and the app's own HTTP client trusts it for that call only. TLS verification is never
 * turned off.
 *
 * The certificates are encoded here (X.509 v3 in DER, ECDSA P-256 with SHA-256) over `node:crypto`, so no dependency is
 * needed to generate them.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import type { KeyObject } from "node:crypto"

/** The TLS material an HTTPS fake serves with and an app trusts. */
export interface FakeTls {
    /** PEM of the run's fake certificate authority: the one certificate a client adds to its trusted list. */
    readonly ca: string
    /** PEM of the server certificate the CA signed for the loopback names. */
    readonly cert: string
    /** PEM (PKCS#8) of the server certificate's private key. */
    readonly key: string
}

/** The names the server certificate covers: every host the wiring points an app at a fake by. */
export const FAKE_TLS_DNS_NAMES: ReadonlyArray<string> = ["localhost", "host.docker.internal"]
export const FAKE_TLS_IP_ADDRESSES: ReadonlyArray<string> = ["127.0.0.1", "::1"]

// --- DER ---

const encodeLength = (length: number): Buffer => {
    if (length < 0x80) return Buffer.from([length])
    const bytes: Array<number> = []
    for (let rest = length; rest > 0; rest = Math.floor(rest / 0x100)) bytes.unshift(rest % 0x100)
    return Buffer.from([0x80 | bytes.length, ...bytes])
}

const tlv = (tag: number, ...content: ReadonlyArray<Buffer>): Buffer => {
    const body = Buffer.concat(content)
    return Buffer.concat([Buffer.from([tag]), encodeLength(body.length), body])
}

const sequence = (...items: ReadonlyArray<Buffer>): Buffer => tlv(0x30, ...items)
const set = (...items: ReadonlyArray<Buffer>): Buffer => tlv(0x31, ...items)
const octetString = (content: Buffer): Buffer => tlv(0x04, content)
const bitString = (content: Buffer, unusedBits = 0): Buffer => tlv(0x03, Buffer.from([unusedBits]), content)
const utf8String = (text: string): Buffer => tlv(0x0c, Buffer.from(text, "utf8"))
const explicit = (index: number, content: Buffer): Buffer => tlv(0xa0 | index, content)
const booleanTrue = (): Buffer => tlv(0x01, Buffer.from([0xff]))

/** A non-negative INTEGER from its big-endian magnitude. */
const unsignedInteger = (magnitude: Buffer): Buffer => {
    let start = 0
    while (start < magnitude.length - 1 && magnitude[start] === 0) start += 1
    const trimmed = magnitude.subarray(start)
    return tlv(0x02, (trimmed[0] ?? 0) >= 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed)
}

const objectIdentifier = (dotted: string): Buffer => {
    const arcs = dotted.split(".").map(Number)
    const bytes: Array<number> = [40 * (arcs[0] ?? 0) + (arcs[1] ?? 0)]
    for (const arc of arcs.slice(2)) {
        const chunk: Array<number> = [arc % 0x80]
        for (let rest = Math.floor(arc / 0x80); rest > 0; rest = Math.floor(rest / 0x80)) chunk.unshift(0x80 | rest % 0x80)
        bytes.push(...chunk)
    }
    return tlv(0x06, Buffer.from(bytes))
}

/** UTCTime (every validity of an ephemeral run certificate falls before 2050). */
const utcTime = (at: Date): Buffer => {
    const two = (value: number): string => String(value).padStart(2, "0")
    const text = `${two(at.getUTCFullYear() % 100)}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}Z`
    return tlv(0x17, Buffer.from(text, "ascii"))
}

const ipAddressBytes = (address: string): Buffer => {
    if (address.includes(":")) {
        const [head = "", tail = ""] = address.split("::")
        const left = head === "" ? [] : head.split(":")
        const right = tail === "" ? [] : tail.split(":")
        const groups = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
        return Buffer.from(groups.flatMap((group) => [Math.floor(parseInt(group, 16) / 0x100), parseInt(group, 16) % 0x100]))
    }
    return Buffer.from(address.split(".").map(Number))
}

// --- X.509 ---

const OID = {
    ecdsaWithSha256: "1.2.840.10045.4.3.2",
    commonName: "2.5.4.3",
    organization: "2.5.4.10",
    subjectKeyIdentifier: "2.5.29.14",
    keyUsage: "2.5.29.15",
    subjectAltName: "2.5.29.17",
    basicConstraints: "2.5.29.19",
    authorityKeyIdentifier: "2.5.29.35",
    extKeyUsage: "2.5.29.37",
    serverAuth: "1.3.6.1.5.5.7.3.1",
} as const

const signatureAlgorithm = (): Buffer => sequence(objectIdentifier(OID.ecdsaWithSha256))

const distinguishedName = (commonName: string): Buffer =>
    sequence(
        set(sequence(objectIdentifier(OID.organization), utf8String("StarCi test-world"))),
        set(sequence(objectIdentifier(OID.commonName), utf8String(commonName))),
    )

const extension = (oid: string, critical: boolean, value: Buffer): Buffer =>
    critical ? sequence(objectIdentifier(oid), booleanTrue(), octetString(value)) : sequence(objectIdentifier(oid), octetString(value))

const serialNumber = (): Buffer => {
    const bytes = randomBytes(16)
    bytes[0] = ((bytes[0] ?? 0) & 0x7f) | 0x01
    return unsignedInteger(bytes)
}

interface CertificateRequest {
    readonly subject: string
    readonly issuer: string
    readonly publicKey: KeyObject
    readonly signer: KeyObject
    readonly notBefore: Date
    readonly notAfter: Date
    readonly extensions: ReadonlyArray<Buffer>
}

const keyIdentifier = (publicKey: KeyObject): Buffer =>
    createHash("sha1").update(publicKey.export({ type: "spki", format: "der" })).digest()

const certificate = (request: CertificateRequest): Buffer => {
    const tbs = sequence(
        explicit(0, unsignedInteger(Buffer.from([2]))),
        serialNumber(),
        signatureAlgorithm(),
        distinguishedName(request.issuer),
        sequence(utcTime(request.notBefore), utcTime(request.notAfter)),
        distinguishedName(request.subject),
        request.publicKey.export({ type: "spki", format: "der" }),
        explicit(3, sequence(...request.extensions)),
    )
    const signature = sign("sha256", tbs, { key: request.signer, dsaEncoding: "der" })
    return sequence(tbs, signatureAlgorithm(), bitString(signature))
}

const pem = (label: string, der: Buffer): string => {
    const lines = der.toString("base64").match(/.{1,64}/g) ?? []
    return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`
}

/** Makes a fresh CA and a server certificate it signs; every call is new material (specs use it for an unrelated CA). */
export const issueFakeTls = (now: Date = new Date()): FakeTls => {
    const notBefore = new Date(now.getTime() - 60 * 60 * 1000)
    const notAfter = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const authority = generateKeyPairSync("ec", { namedCurve: "P-256" })
    const server = generateKeyPairSync("ec", { namedCurve: "P-256" })
    const authorityName = `StarCi test-world fake CA ${randomBytes(4).toString("hex")}`
    const authorityKeyId = keyIdentifier(authority.publicKey)

    const ca = certificate({
        subject: authorityName,
        issuer: authorityName,
        publicKey: authority.publicKey,
        signer: authority.privateKey,
        notBefore,
        notAfter,
        extensions: [
            extension(OID.basicConstraints, true, sequence(booleanTrue(), tlv(0x02, Buffer.from([0])))),
            // keyCertSign (bit 5) and cRLSign (bit 6): 0b0000_0110, one unused bit.
            extension(OID.keyUsage, true, bitString(Buffer.from([0x06]), 1)),
            extension(OID.subjectKeyIdentifier, false, octetString(authorityKeyId)),
        ],
    })
    const alternativeNames = sequence(
        ...FAKE_TLS_DNS_NAMES.map((name) => tlv(0x82, Buffer.from(name, "ascii"))),
        ...FAKE_TLS_IP_ADDRESSES.map((address) => tlv(0x87, ipAddressBytes(address))),
    )
    const leaf = certificate({
        subject: "127.0.0.1",
        issuer: authorityName,
        publicKey: server.publicKey,
        signer: authority.privateKey,
        notBefore,
        notAfter,
        extensions: [
            extension(OID.basicConstraints, true, sequence()),
            // digitalSignature (bit 0): 0b1000_0000, seven unused bits.
            extension(OID.keyUsage, true, bitString(Buffer.from([0x80]), 7)),
            extension(OID.extKeyUsage, false, sequence(objectIdentifier(OID.serverAuth))),
            extension(OID.subjectAltName, false, alternativeNames),
            extension(OID.subjectKeyIdentifier, false, octetString(keyIdentifier(server.publicKey))),
            extension(OID.authorityKeyIdentifier, false, sequence(tlv(0x80, authorityKeyId))),
        ],
    })
    return {
        ca: pem("CERTIFICATE", ca),
        cert: pem("CERTIFICATE", leaf),
        key: server.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    }
}

let processTls: FakeTls | null = null

/**
 * The TLS material every HTTPS fake of this process serves with: made on first use, kept in memory only, gone with the
 * process. One CA per run, so an app trusts one PEM for all of its HTTPS fakes.
 */
export const fakeTls = (): FakeTls => {
    processTls ??= issueFakeTls()
    return processTls
}
