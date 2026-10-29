import { Test } from "@nestjs/testing"
import { buildSchema, parse, validate } from "graphql"
import { depthLimitRule } from "./graphql-depth.policy"

const schema = buildSchema(`
    type Query {
        item: Item
    }

    type Item {
        value: String
        child: Item
    }
`)

const DEPTH_LIMIT = Symbol("spec.depth-limit")

const build = async () => {
    const moduleRef = await Test.createTestingModule({ providers: [{ provide: DEPTH_LIMIT, useValue: 2 }] }).compile()
    const maxDepth = moduleRef.get<number>(DEPTH_LIMIT)
    return (source: string) => validate(schema, parse(source), [depthLimitRule(maxDepth)])
}

describe("depthLimitRule", () => {
    it("accepts an operation nested exactly to the depth limit", async () => {
        const validateDepth = await build()
        const errors = validateDepth(`
            query {
                item {
                    value
                }
            }
        `)

        expect(errors).toEqual([])
    })

    it("rejects the first selection set deeper than the limit", async () => {
        const validateDepth = await build()
        const errors = validateDepth(`
            query {
                item {
                    child {
                        value
                    }
                }
            }
        `)

        expect(errors.map((error) => error.message)).toEqual(["Selection depth exceeds 2."])
    })
})
