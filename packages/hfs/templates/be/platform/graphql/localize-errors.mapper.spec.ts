import type { GraphQLRequestContext, GraphQLRequestContextWillSendResponse, GraphQLResponse } from "@apollo/server"
import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { Request } from "express"
import type { GraphQLFormattedError } from "graphql"
import { ERRORS_SERVICE } from "@modules/platform/errors"
import type { ErrorsService } from "@modules/platform/errors"
import { REQUEST_LOCALE } from "@modules/platform/i18n"
import type { RequestLocale } from "@modules/platform/i18n"
import type { GraphqlContext } from "./graphql.contracts"
import { localizeError, localizeErrorsPlugin } from "./localize-errors.mapper"

const build = async () => {
    const errorsDouble = mock<ErrorsService>()
    const localeDouble = mock<RequestLocale>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            { provide: ERRORS_SERVICE, useValue: errorsDouble },
            { provide: REQUEST_LOCALE, useValue: localeDouble },
        ],
    }).compile()
    return {
        errors: moduleRef.get<typeof errorsDouble>(ERRORS_SERVICE),
        requestLocale: moduleRef.get<typeof localeDouble>(REQUEST_LOCALE),
    }
}

const errorWith = (extensions?: GraphQLFormattedError["extensions"]): GraphQLFormattedError =>
    extensions === undefined ? { message: "syntax error" } : { message: "syntax error", extensions }

const acceptLanguage = (language?: string): Request["headers"] =>
    language === undefined ? {} : { "accept-language": language }

const singleResponse = (errors?: ReadonlyArray<GraphQLFormattedError>): GraphQLResponse =>
    mock<GraphQLResponse>({ body: { kind: "single", singleResult: errors === undefined ? {} : { errors } } })

const requestContext = (
    response: GraphQLResponse,
    headers: Request["headers"],
): GraphQLRequestContextWillSendResponse<GraphqlContext> =>
    mock<GraphQLRequestContextWillSendResponse<GraphqlContext>>({
        contextValue: { req: mock<GraphqlContext["req"]>({ headers, correlationId: "request-1" }), res: mock<GraphqlContext["res"]>() },
        response,
    })

const sendResponse = async (
    errors: ErrorsService,
    requestLocale: RequestLocale,
    context: GraphQLRequestContextWillSendResponse<GraphqlContext>,
): Promise<void> => {
    const listener = await localizeErrorsPlugin(errors, requestLocale).requestDidStart?.(
        mock<GraphQLRequestContext<GraphqlContext>>(),
    )
    await listener?.willSendResponse?.(context)
}

describe("localizeError", () => {
    it.each([undefined, {}, { code: 400 }, { code: null }, { code: false }])(
        "returns an error without a string code unchanged (%p)",
        async (extensions) => {
            const { errors } = await build()
            const error = errorWith(extensions)

            expect(localizeError(errors, "en", error)).toBe(error)
            expect(errors.text).not.toHaveBeenCalled()
        },
    )

    it("replaces a coded error's message with the catalog text and keeps only string and number params", async () => {
        const { errors } = await build()
        errors.text.mockReturnValue("The item was not found")
        const error: GraphQLFormattedError = {
            message: "ITEM_NOT_FOUND",
            locations: [{ line: 1, column: 2 }],
            path: ["items", 0],
            extensions: {
                code: "ITEM_NOT_FOUND",
                params: { id: "i-1", retries: 2, transient: false, missing: null, nested: { id: "i-2" } },
                kind: "missing",
            },
        }

        const localized = localizeError(errors, "en", error)

        expect(localized).toEqual({ ...error, message: "The item was not found" })
        expect(localized).not.toBe(error)
        expect(localized.extensions).toBe(error.extensions)
        expect(error.message).toBe("ITEM_NOT_FOUND")
        expect(errors.text).toHaveBeenCalledWith("ITEM_NOT_FOUND", { id: "i-1", retries: 2 }, "en")
    })

    it.each([undefined, null, ["i-1"], "i-1", 42, false])(
        "interpolates no params when extensions.params is %p",
        async (params) => {
            const { errors } = await build()
            errors.text.mockReturnValue("The item was not found")
            const error: GraphQLFormattedError = {
                message: "ITEM_NOT_FOUND",
                extensions: { code: "ITEM_NOT_FOUND", params },
            }

            expect(localizeError(errors, "en", error).message).toBe("The item was not found")
            expect(errors.text).toHaveBeenCalledWith("ITEM_NOT_FOUND", {}, "en")
        },
    )
})

describe("localizeErrorsPlugin", () => {
    it("forwards the Accept-Language preferences and localizes every coded error in the resolved locale", async () => {
        const { errors, requestLocale } = await build()
        requestLocale.of.mockReturnValue("vi")
        errors.text.mockReturnValueOnce("localized: not found").mockReturnValueOnce("localized: denied")
        const coded: GraphQLFormattedError = { message: "ITEM_NOT_FOUND", extensions: { code: "ITEM_NOT_FOUND" } }
        const uncoded: GraphQLFormattedError = { message: "syntax error" }
        const denied: GraphQLFormattedError = {
            message: "ACCESS_DENIED",
            extensions: { code: "ACCESS_DENIED", params: { id: "i-1" } },
        }
        const response = singleResponse([coded, uncoded, denied])

        const context = requestContext(response, { "accept-language": "vi-VN, en;q=0.8" })

        await sendResponse(errors, requestLocale, context)

        expect(requestLocale.of).toHaveBeenCalledTimes(1)
        expect(requestLocale.of).toHaveBeenCalledWith("vi-VN, en;q=0.8")
        expect(errors.text).toHaveBeenNthCalledWith(1, "ITEM_NOT_FOUND", {}, "vi")
        expect(errors.text).toHaveBeenNthCalledWith(2, "ACCESS_DENIED", { id: "i-1" }, "vi")
        expect(errors.text).toHaveBeenCalledTimes(2)
        expect(response.body.kind === "single" && response.body.singleResult.errors).toEqual([
            { ...coded, message: "localized: not found" },
            uncoded,
            { ...denied, message: "localized: denied" },
        ])
        expect(response.body.kind === "single" && response.body.singleResult.errors?.[1]).toBe(uncoded)
    })

    it.each([undefined, ""])(
        "delegates an absent or empty Accept-Language header to the locale default (%p)",
        async (language) => {
            const { errors, requestLocale } = await build()
            requestLocale.of.mockReturnValue("vi")
            errors.text.mockReturnValue("localized: not found")
            const coded: GraphQLFormattedError = { message: "ITEM_NOT_FOUND", extensions: { code: "ITEM_NOT_FOUND" } }

            const response = singleResponse([coded])

            await sendResponse(errors, requestLocale, requestContext(response, acceptLanguage(language)))

            expect(requestLocale.of).toHaveBeenCalledWith(language)
            expect(errors.text).toHaveBeenCalledWith("ITEM_NOT_FOUND", {}, "vi")
            expect(response.body.kind === "single" && response.body.singleResult.errors).toEqual([
                { ...coded, message: "localized: not found" },
            ])
        },
    )
})

describe("localizeErrorsPlugin on a response with nothing to localize", () => {
    it("leaves a response without errors alone", async () => {
        const { errors, requestLocale } = await build()

        const response = singleResponse()
        const body = response.body

        await sendResponse(errors, requestLocale, requestContext(response, { "accept-language": "en" }))

        expect(response.body).toBe(body)
        expect(response.body.kind === "single" && response.body.singleResult.errors).toBeUndefined()
        expect(requestLocale.of).not.toHaveBeenCalled()
        expect(errors.text).not.toHaveBeenCalled()
    })

    it("leaves an incremental response alone", async () => {
        const { errors, requestLocale } = await build()
        const coded: GraphQLFormattedError = { message: "ITEM_NOT_FOUND", extensions: { code: "ITEM_NOT_FOUND" } }
        const response = mock<GraphQLResponse>({
            body: {
                kind: "incremental",
                initialResult: { errors: [coded], hasNext: true },
                subsequentResults: mock<AsyncIterable<never>>(),
            },
        })
        const body = response.body

        await sendResponse(errors, requestLocale, requestContext(response, { "accept-language": "en" }))

        expect(response.body).toBe(body)
        expect(response.body.kind === "incremental" && response.body.initialResult.errors).toEqual([coded])
        expect(requestLocale.of).not.toHaveBeenCalled()
        expect(errors.text).not.toHaveBeenCalled()
    })
})
