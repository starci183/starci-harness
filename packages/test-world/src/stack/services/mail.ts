import { TestWorldErrorCode, worldError } from "../../errors"
import type { RunMail } from "../contracts"
import { httpOk } from "../health"
import { createMailpitApi } from "../mail-api"
import type { MailpitApi } from "../mail-api"
import type { ServiceDefinition, ServiceTarget } from "./definition"

/** The SMTP port of the mailpit image: the port the app under test sends to, through toxiproxy. */
export const MAIL_SMTP_PORT = 1025
/** The HTTP API port of the mailpit image: read by the world directly. */
export const MAIL_API_PORT = 8025

const apiPortOf = (target: ServiceTarget): number => {
    const port = target.extraPorts?.[MAIL_API_PORT]
    if (port === undefined) throw worldError(TestWorldErrorCode.InfrastructureFailed, `${target.container} publishes no HTTP API port (${MAIL_API_PORT})`)
    return port
}

const apiOf = (target: ServiceTarget, port: number): MailpitApi => createMailpitApi(`http://${target.host}:${port}`, target.net.fetch)

/** Empties the sink and stops its chaos: what a new run and every spec file start from. */
const quiet = async (api: MailpitApi): Promise<void> => {
    await api.deleteAll()
    await api.acceptAll()
}

/**
 * Mail: the stack definition's mailpit, one container per data slot (the messages and the chaos of a mailpit are global to
 * the server, so a shared container would let a slot's refusal or reset reach another repository's mail). SMTP is the
 * proxied endpoint; the HTTP API is published beside it and read directly. Chaos is enabled so a spec can make the sink refuse
 * at the sender, the recipient or `AUTH`; the sink accepts any credentials over the plain channel an app on loopback uses.
 */
export const mailService: ServiceDefinition<RunMail> = {
    name: "mail",
    port: MAIL_SMTP_PORT,
    extraPorts: [MAIL_API_PORT],
    scope: "namespace",
    newSecrets: () => ({}),
    spec: () => ({
        env: { MP_ENABLE_CHAOS: "true", MP_SMTP_AUTH_ACCEPT_ANY: "true", MP_SMTP_AUTH_ALLOW_INSECURE: "true", MP_MAX_MESSAGES: "500" },
        command: [],
    }),
    ready: async (target) => {
        const port = target.extraPorts?.[MAIL_API_PORT]
        return port !== undefined && (await httpOk(target.net.fetch, `http://${target.host}:${port}/livez`))
    },
    provision: async (target) => {
        const apiPort = apiPortOf(target)
        await quiet(apiOf(target, apiPort))
        return { run: { apiPort } }
    },
    reset: (target, run) => quiet(apiOf(target, run.apiPort)),
    deprovision: (target) => target.net.docker.remove(target.container),
}
