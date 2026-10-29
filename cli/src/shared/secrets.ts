import { SPEC_FILE } from "./spec-file.js"

/** One secret the scan found: where, and which rule, never the value. */
export interface SecretFinding {
    readonly file: string
    readonly line: number | null
    readonly pattern: string
}

/** A finding with the text of its line, trimmed (empty for a finding of a whole file): only the exception check reads it, no report shows it. */
export interface SecretHit extends SecretFinding {
    readonly text: string
}

interface PathRule {
    readonly name: string
    readonly test: (file: string) => boolean
}

interface ValueRule {
    readonly name: string
    readonly pattern: RegExp
    /** Files whose values are inputs, not credentials (specs), or identifiers (source for the unquoted form). */
    readonly skipFile?: RegExp
    /** A captured value that is no credential, so no candidate: a stand-in that names itself one, or a key's name. */
    readonly notCredential?: (value: string) => boolean
}

/** Paths that are secrets by being what they are. */
const FORBIDDEN_PATHS: readonly PathRule[] = [
    { name: "env-file", test: (file) => /(^|\/)\.env(\.[^/]*)?$/i.test(file) && !/\.env\.(example|sample|template)$/i.test(file) },
    { name: "secrets-dir", test: (file) => /(^|\/)\.secrets\//i.test(file) },
    { name: "private-key-file", test: (file) => /\.(pem|key|p12|pfx)$/i.test(file) || /(^|\/)id_(rsa|ed25519|ecdsa)$/i.test(file) },
    { name: "credentials-json", test: (file) => /(^|\/)(credentials|service-account|client_secret)[^/]*\.json$/i.test(file) },
]

const PLACEHOLDER = /fixture|stub|fake|dummy|placeholder|example|sample|changeme|redacted|mock/i

/**
 * The name of an environment or custody key (`IDENTITY_KEYCLOAK_CLIENT_SECRET`, an error code alike): two or more words of
 * capitals and digits, each opening with a capital, joined by underscores. It names where a credential lives, never holds one.
 */
const KEY_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)+$/

/** A captured value that is no credential: a stand-in that says so, or a key's name. */
const notCredential = (value: string): boolean => PLACEHOLDER.test(value) || KEY_NAME.test(value)

const SECRET_WORD = "password|passwd|passphrase|secret|credentials?|token|api[_-]?key|private[_-]?key|secret[_-]?key|signing[_-]?key|service[_-]?role[_-]?key"

/** Provider-shaped credentials, always refused, plus the keyword-assignment heuristic. */
const VALUE_RULES: readonly ValueRule[] = [
    { name: "private-key-block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
    { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_\w{50,}\b/ },
    { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
    { name: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
    { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
    { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { name: "telegram-bot-token", pattern: /\b\d{8,10}:AA[0-9A-Za-z_-]{33}\b/ },
    { name: "stripe-secret", pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/ },
    { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    { name: "age-secret-key", pattern: /\bAGE-SECRET-KEY-1[0-9A-Z]{20,}\b/ },
    { name: "password-connection-string", pattern: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:[^@\s/${}]{8,}@/iu },
    {
        name: "assigned-secret",
        pattern: new RegExp(`(?<![A-Za-z0-9_$])[A-Za-z_$][A-Za-z0-9_$.-]*(?:${SECRET_WORD})\\s*[:=]\\s*['"\`]([^'"\`\\n\\s$<{]{12,})['"\`]`, "i"),
        skipFile: SPEC_FILE,
        notCredential,
    },
]

/**
 * The base64 payload of a `data:` URI whose mime is a font, image, audio or video: content a page embeds, never a credential, so it
 * is set aside (the `data:<mime>;base64,` prefix stays) before any rule reads the text. Everything around it is read as written.
 */
const CONTENT_PAYLOAD = /(\bdata:(?:font|image|audio|video)\/[\w.+-]+(?:;[\w.+-]+=[\w.+-]+)*;base64,)[A-Za-z0-9+/]+=*/gi

/** The text the secret rules judge: `text` with every embedded font, image and media payload set aside. */
export const judgedText = (text: string): string => text.replace(CONTENT_PAYLOAD, "$1")

/** A sops-encrypted file: it carries sops metadata and only ENC[...] values. */
const isSopsEnvelope = (text: string): boolean => /(^|\n)sops:/.test(text) && text.includes('ENC[AES256_GCM,')

/** The secret rules one line of one file breaks, by name, judged on its text with embedded content payloads set aside. */
export const lineFindings = (file: string, text: string): string[] => {
    const judged = judgedText(text)
    return VALUE_RULES.filter((rule) => {
        if (rule.skipFile?.test(file) === true) return false
        const hit = rule.pattern.exec(judged)
        if (hit === null) return false
        return rule.notCredential?.(hit[1] ?? "") !== true
    }).map((rule) => rule.name)
}

/**
 * The text with every value a value rule recognises replaced by `[redacted:<rule>]` (an assigned secret keeps its name, a
 * stand-in or a key's name its value): the one redactor of tool output the harness shows or keeps as evidence.
 */
export const redactSecrets = (text: string): string =>
    VALUE_RULES.reduce(
        (out, rule) =>
            out.replace(new RegExp(rule.pattern.source, `${rule.pattern.flags}g`), (match: string, value: unknown) => {
                if (typeof value !== "string") return `[redacted:${rule.name}]`
                return rule.notCredential?.(value) === true ? match : match.replace(value, `[redacted:${rule.name}]`)
            }),
        text,
    )

const HUNK_HEADER =/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** True for the path of a sops envelope a repository commits: a legacy `.enc`, or an app member `.enc.yaml` (ruling app-secrets-one-standard). */
export const isSealedPath = (file: string): boolean => file.endsWith(".enc") || file.endsWith(".enc.yaml")

const isEncryptedFile = (file: string, readFile: (file: string) => string | undefined): boolean => isSealedPath(file) && isSopsEnvelope(readFile(file) ?? "")

const forbiddenPathFindings = (files: readonly string[]): SecretHit[] =>
    files.flatMap((file) => FORBIDDEN_PATHS.filter((rule) => rule.test(file)).map((rule): SecretHit => ({ file, line: null, pattern: rule.name, text: "" })))

/** Scans the added lines of a unified diff (git diff -U0) and its changed file list; returns findings with the text of their line. */
export const scanDiff = (diff: string, files: readonly string[], readFile: (file: string) => string | undefined): SecretHit[] => {
    const findings: SecretHit[] = forbiddenPathFindings(files)
    let file = ""
    let line = 0
    for (const raw of diff.split(/\r?\n/)) {
        if (raw.startsWith("+++ ")) {
            file = raw.slice(4).replace(/^b\//, "")
            continue
        }
        const hunk = HUNK_HEADER.exec(raw)
        if (hunk !== null) {
            line = Number(hunk[1])
            continue
        }
        if (!raw.startsWith("+")) continue
        if (!isEncryptedFile(file, readFile)) for (const pattern of lineFindings(file, raw.slice(1))) findings.push({ file, line, pattern, text: raw.slice(1).trim() })
        line += 1
    }
    return findings
}
