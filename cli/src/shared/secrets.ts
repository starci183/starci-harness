/** One secret the scan found: where, and which rule, never the value. */
export interface SecretFinding {
    readonly file: string
    readonly line: number | null
    readonly pattern: string
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
    /** A captured value that names itself a stand-in is no candidate. */
    readonly placeholder?: RegExp
}

/** Paths that are secrets by being what they are. */
const FORBIDDEN_PATHS: readonly PathRule[] = [
    { name: "env-file", test: (file) => /(^|\/)\.env(\.[^/]*)?$/i.test(file) && !/\.env\.(example|sample|template)$/i.test(file) },
    { name: "secrets-dir", test: (file) => /(^|\/)\.secrets\//i.test(file) },
    { name: "private-key-file", test: (file) => /\.(pem|key|p12|pfx)$/i.test(file) || /(^|\/)id_(rsa|ed25519|ecdsa)$/i.test(file) },
    { name: "credentials-json", test: (file) => /(^|\/)(credentials|service-account|client_secret)[^/]*\.json$/i.test(file) },
]

const PLACEHOLDER = /fixture|stub|fake|dummy|placeholder|example|sample|changeme|redacted|mock/i

const SPEC_FILE = /\.(?:spec|test|e2e-spec)\.[cm]?[jt]sx?$/

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
        placeholder: PLACEHOLDER,
    },
]

/** A sops-encrypted file: it carries sops metadata and only ENC[...] values. */
const isSopsEnvelope = (text: string): boolean => /(^|\n)sops:/.test(text) && text.includes('ENC[AES256_GCM,')

/** The secret rules one line of one file breaks, by name. */
export const lineFindings = (file: string, text: string): string[] =>
    VALUE_RULES.filter((rule) => {
        if (rule.skipFile?.test(file) === true) return false
        const hit = rule.pattern.exec(text)
        if (hit === null) return false
        return !rule.placeholder?.test(hit[1] ?? "")
    }).map((rule) => rule.name)

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

const isEncryptedFile = (file: string, readFile: (file: string) => string | undefined): boolean => file.endsWith(".enc") && isSopsEnvelope(readFile(file) ?? "")

const forbiddenPathFindings = (files: readonly string[]): SecretFinding[] =>
    files.flatMap((file) => FORBIDDEN_PATHS.filter((rule) => rule.test(file)).map((rule): SecretFinding => ({ file, line: null, pattern: rule.name })))

/** Scans the added lines of a unified diff (git diff -U0) and its changed file list; returns findings without values. */
export const scanDiff = (diff: string, files: readonly string[], readFile: (file: string) => string | undefined): SecretFinding[] => {
    const findings: SecretFinding[] = forbiddenPathFindings(files)
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
        if (!isEncryptedFile(file, readFile)) for (const pattern of lineFindings(file, raw.slice(1))) findings.push({ file, line, pattern })
        line += 1
    }
    return findings
}
