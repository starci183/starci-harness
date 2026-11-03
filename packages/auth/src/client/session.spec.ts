import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createSessionStore, createSingleFlight } from "./session.ts"
import type { SessionEvent, SessionPerson, SessionSource } from "./session.ts"

const ANA: SessionPerson = { id: "u1", email: "ana@example.com" }

/** A deferred promise the spec settles by hand, so the order of a race is the spec's. */
const deferred = <T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: Error): void } => {
    let resolve: (value: T) => void = () => undefined
    let reject: (reason: Error) => void = () => undefined
    const promise = new Promise<T>((done, fail) => {
        resolve = done
        reject = fail
    })
    return { promise, resolve, reject }
}

/** The facts of a client the store reads, with the calls it made recorded. */
const source = (over: Partial<{ announced: boolean; held: boolean; user: string | null; refreshing: boolean }> = {}) => {
    const state = { announced: false, held: false, user: null as string | null, refreshing: false, ...over, renews: 0, announces: 0 }
    const facts: SessionSource = {
        announced: () => state.announced,
        announce: () => {
            state.announced = true
            state.announces += 1
        },
        held: () => state.held,
        userId: () => state.user,
        renew: () => {
            state.renews += 1
            return Promise.resolve(undefined)
        },
        refreshing: () => state.refreshing,
    }
    return { state, facts }
}

describe("createSingleFlight", () => {
    it("shares one run between the callers that arrive while it runs (many requests answered 401 together)", async () => {
        const gate = deferred<string>()
        let runs = 0
        const flight = createSingleFlight(() => {
            runs += 1
            return gate.promise
        })
        const first = flight.run()
        const second = flight.run()
        const third = flight.run()
        assert.equal(runs, 1)
        assert.equal(flight.running(), true)
        gate.resolve("token")
        assert.deepEqual(await Promise.all([first, second, third]), ["token", "token", "token"])
    })

    it("frees the slot when the run succeeds, so the next caller starts a new run", async () => {
        let runs = 0
        const flight = createSingleFlight(() => Promise.resolve(++runs))
        assert.equal(await flight.run(), 1)
        assert.equal(flight.running(), false)
        assert.equal(await flight.run(), 2)
    })

    it("frees the slot when the run fails, and every joined caller sees the failure", async () => {
        const gate = deferred<string>()
        let runs = 0
        const flight = createSingleFlight(() => {
            runs += 1
            return runs === 1 ? gate.promise : Promise.resolve("again")
        })
        const first = flight.run()
        const second = flight.run()
        gate.reject(new Error("provider down"))
        await assert.rejects(first, /provider down/u)
        await assert.rejects(second, /provider down/u)
        assert.equal(flight.running(), false)
        assert.equal(await flight.run(), "again")
    })

    it("does not start a second run for a caller that arrives after the first settles but before others have read it", async () => {
        const gate = deferred<string>()
        let runs = 0
        const flight = createSingleFlight(() => {
            runs += 1
            return gate.promise
        })
        const early = flight.run()
        gate.resolve("one")
        assert.equal(flight.run(), early, "the settled-but-unobserved run is still the one in flight until its finally runs")
        await early
        assert.equal(runs, 1)
    })
})

describe("createSessionStore", () => {
    it("starts loading, for the server too, and publishes sign-in and sign-out", () => {
        const store = createSessionStore<SessionPerson>(source().facts)
        assert.deepEqual(store.getSnapshot(), { status: "loading", user: null })
        assert.equal(store.getServerSnapshot(), store.getServerSnapshot(), "the server snapshot is one stable object")
        store.signedIn(ANA)
        assert.deepEqual(store.getSnapshot(), { status: "signed-in", user: ANA })
        assert.deepEqual(store.getServerSnapshot(), { status: "loading", user: null }, "the server never sees a session")
        store.signedOut()
        assert.deepEqual(store.getSnapshot(), { status: "signed-out", user: null })
    })

    it("calls the watchers only when the status, the id, the email or the name changed, and keeps the object stable otherwise", () => {
        const store = createSessionStore<SessionPerson>(source({ announced: true }).facts)
        let calls = 0
        store.watch(() => {
            calls += 1
        })
        store.signedIn(ANA)
        const held = store.getSnapshot()
        store.signedIn({ ...ANA })
        assert.equal(store.getSnapshot(), held, "the same person is the same snapshot")
        assert.equal(calls, 1)
        store.signedIn({ id: "u1", email: "new@example.com" })
        assert.equal(calls, 2, "a new email is a change")
        store.signedIn({ id: "u2", email: "new@example.com" })
        assert.equal(calls, 3, "a new id is a change")
        store.signedIn({ id: "u2", email: "new@example.com", name: "Ada Lovelace" })
        assert.equal(calls, 4, "a new full name is a change")
        store.signedOut()
        store.signedOut()
        assert.equal(calls, 5, "signing out twice is one change")
        store.signedIn(null)
        assert.equal(calls, 6, "signed in with no person is another status")
    })

    it("tells every listener the event with the id of the person it concerns", () => {
        const heard: [SessionEvent, string | null][] = []
        const store = createSessionStore<SessionPerson>(source({ announced: true, user: "u1" }).facts)
        const stop = store.subscribe((event, id) => heard.push([event, id]))
        store.emit("TOKEN_REFRESHED", "u1")
        store.emit("SIGNED_OUT", null)
        stop()
        store.emit("SIGNED_IN", "u2")
        assert.deepEqual(heard, [["INITIAL_SESSION", "u1"], ["TOKEN_REFRESHED", "u1"], ["SIGNED_OUT", null]])
    })

    it("answers a late subscriber its first answer at once when the client has answered already", () => {
        const { state, facts } = source({ announced: true, user: null })
        const heard: [SessionEvent, string | null][] = []
        createSessionStore<SessionPerson>(facts).subscribe((event, id) => heard.push([event, id]))
        assert.deepEqual(heard, [["INITIAL_SESSION", null]])
        assert.equal(state.renews, 0, "no refresh for a client that has answered")
    })

    it("asks a refresh for the first answer; when no token is held it announces and signs out", async () => {
        const { state, facts } = source({ announced: false, held: false })
        const store = createSessionStore<SessionPerson>(facts)
        const heard: [SessionEvent, string | null][] = []
        store.subscribe((event, id) => heard.push([event, id]))
        await Promise.resolve()
        await Promise.resolve()
        assert.equal(state.renews, 1)
        assert.equal(state.announces, 1)
        assert.deepEqual(heard, [["INITIAL_SESSION", null]])
        assert.deepEqual(store.getSnapshot(), { status: "signed-out", user: null })
    })

    it("leaves the answer to the client when the refresh found a session (it announced itself)", async () => {
        const { state, facts } = source({ announced: false, held: true })
        const store = createSessionStore<SessionPerson>(facts)
        const heard: SessionEvent[] = []
        store.subscribe((event) => heard.push(event))
        state.announced = true
        await Promise.resolve()
        await Promise.resolve()
        assert.equal(state.announces, 0, "the client had announced already")
        assert.deepEqual(heard, [], "the listener hears the client's own SIGNED_IN or TOKEN_REFRESHED, not a signed-out answer")
        assert.deepEqual(store.getSnapshot(), { status: "loading", user: null })
    })

    it("stops a watcher and a listener when they unsubscribe", () => {
        const store = createSessionStore<SessionPerson>(source({ announced: true }).facts)
        let calls = 0
        const stop = store.watch(() => {
            calls += 1
        })
        stop()
        store.signedIn(ANA)
        assert.equal(calls, 0)
    })

    it("starts the first refresh from a watcher only when the client has not answered and none runs", () => {
        const idle = source({ announced: false, refreshing: false })
        createSessionStore<SessionPerson>(idle.facts).watch(() => undefined)
        assert.equal(idle.state.renews, 1)
        const busy = source({ announced: false, refreshing: true })
        createSessionStore<SessionPerson>(busy.facts).watch(() => undefined)
        assert.equal(busy.state.renews, 0, "a running refresh is joined, not started again")
        const answered = source({ announced: true })
        createSessionStore<SessionPerson>(answered.facts).watch(() => undefined)
        assert.equal(answered.state.renews, 0)
    })
})
