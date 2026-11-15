import { Inject, Module } from "@nestjs/common"
import type { BeforeApplicationShutdown, DynamicModule, OnApplicationBootstrap } from "@nestjs/common"
import { defineCapabilityModule } from "@starci/nest-kit"
import type { OutboxOptions } from "./contracts.ts"
import { Outbox } from "./outbox.ts"

/** The registration of the outbox capability: the engine's options, and whether the worker loop runs in this process. */
export interface OutboxModuleOptions extends OutboxOptions {
    /** Whether the worker loop starts with the application (`onApplicationBootstrap`); a process that only enqueues, or a spec that drains, leaves it off. */
    readonly autoStart?: boolean
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = defineCapabilityModule<OutboxModuleOptions>()

/** Token of the `Outbox`. */
export const OUTBOX: unique symbol = Symbol.for("@starci/outbox/outbox")

/** Injects the `Outbox`. Parameter type: Outbox. */
export const InjectOutbox = (): PropertyDecorator & ParameterDecorator => Inject(OUTBOX)

/**
 * Starts the worker loop after every module registered its handlers (their `onModuleInit`), and stops it before the connections close:
 * running jobs get their grace, then go back to the queue. The app enables Nest's shutdown hooks.
 */
export class OutboxLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown {
    private readonly outbox: Outbox
    private readonly autoStart: boolean

    constructor(outbox: Outbox, autoStart: boolean) {
        this.outbox = outbox
        this.autoStart = autoStart
    }

    /** Starts the loop when the registration asks for it. */
    onApplicationBootstrap(): void {
        if (this.autoStart) this.outbox.start()
    }

    /** Stops the loop and hands back what is still running after the grace. */
    async beforeApplicationShutdown(): Promise<void> {
        await this.outbox.stop()
    }
}

const withOutbox = (base: DynamicModule): DynamicModule => ({
    ...base,
    providers: [
        ...(base.providers ?? []),
        { provide: OUTBOX, inject: [MODULE_OPTIONS_TOKEN], useFactory: (options: OutboxModuleOptions): Outbox => new Outbox(options) },
        {
            provide: OutboxLifecycle,
            inject: [OUTBOX, MODULE_OPTIONS_TOKEN],
            useFactory: (outbox: Outbox, options: OutboxModuleOptions): OutboxLifecycle => new OutboxLifecycle(outbox, options.autoStart === true),
        },
    ],
    exports: [...(base.exports ?? []), OUTBOX],
})

/**
 * The outbox as one Nest capability: the `Outbox` under `OUTBOX` and its worker's lifecycle. The module reads no environment; the app hands
 * the database (a TypeORM `DataSource`, or `pgDatabase(pool)`) and its settings, usually through `registerAsync`. A handler is a provider of
 * its own feature that registers itself with `outbox.handle(this)` in its `onModuleInit`.
 */
export class OutboxModule extends ConfigurableModuleClass {
    /** Registers the capability from options known now. */
    static override register(options: typeof OPTIONS_TYPE): DynamicModule {
        return withOutbox(super.register(options))
    }

    /** Registers the capability from options a factory, class or existing provider supplies. */
    static override registerAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
        return withOutbox(super.registerAsync(options))
    }
}

Module({})(OutboxModule)
