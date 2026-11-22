import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ERD_BODY_PAD, ERD_HEAD, ERD_MORE, ERD_ROW, HEAD_PORT, erdHeight, erdPortId, erdPortY, erdStructureKey, resolveErd } from "../src/core/ext/graph/erd/model.ts"
import type { ErdEntity, ErdRelation } from "../src/core/ext/graph/erd/types.ts"

const field = (id: string) => ({ id, label: id })
const books: ErdEntity[] = [
    { id: "book", label: "Sách", fields: ["title", "author", "year", "shelf", "isbn"].map(field) },
    { id: "author", label: "Tác giả", fields: [field("name")] },
    { id: "loan", label: "Mượn", fields: [field("book"), field("day")] },
]
const relations: ErdRelation[] = [
    { source: "book", field: "author", target: "author", label: "1 tác giả · nhiều sách" },
    { source: "loan", field: "book", target: "book" },
]

describe("resolveErd", () => {
    it("resolves the ends, the field each relation starts at and the many and one defaults", () => {
        const model = resolveErd(books, relations)
        assert.equal(model.edges.length, 2)
        const [first, second] = model.edges
        assert.equal(first?.id, "book.author>author")
        assert.equal(first.sourcePort, "author")
        assert.equal(first.fromMany, true)
        assert.equal(first.toMany, false)
        assert.equal(first.fromOptional, false)
        assert.equal(second?.label, undefined)
    })

    it("marks the field a relation starts at with the name of the entity it points at", () => {
        const model = resolveErd(books, relations)
        const rows = model.nodes.find((node) => node.id === "book")?.rows
        assert.ok(rows)
        assert.equal(rows.find((row) => row.field.id === "author")?.links, "Tác giả")
        assert.equal(rows.find((row) => row.field.id === "title")?.links, undefined)
    })

    it("drops an unknown end, a repeat and a self relation with no field; keeps a self relation with one", () => {
        const model = resolveErd(books, [
            ...relations,
            ...relations.slice(0, 1),
            { source: "ghost", target: "book" },
            { source: "book", target: "ghost" },
            { source: "book", target: "book" },
            { source: "book", field: "shelf", target: "book" },
        ])
        assert.deepEqual(model.edges.map((edge) => edge.id), ["book.author>author", "loan.book>book", "book.shelf>book"])
    })

    it("falls back to the head when the field is not in the entity", () => {
        const model = resolveErd(books, [{ source: "loan", field: "nope", target: "book" }])
        assert.equal(model.edges[0]?.sourcePort, HEAD_PORT)
    })

    it("keeps every linked field among the rows and folds the rest into a +N row", () => {
        const model = resolveErd(books, relations, 2)
        const book = model.nodes.find((node) => node.id === "book")
        assert.ok(book)
        assert.deepEqual(book.rows.map((row) => row.field.id), ["title", "author"])
        assert.equal(book.more, 3)
        const tight = resolveErd(books, relations, 1).nodes.find((node) => node.id === "book")
        assert.deepEqual(tight?.rows.map((row) => row.field.id), ["author"])
    })

    it("sizes the boxes from the rows, and puts each port in the middle of its row", () => {
        assert.equal(erdHeight(0, 0), ERD_HEAD)
        assert.equal(erdHeight(3, 0), ERD_HEAD + ERD_BODY_PAD + 3 * ERD_ROW)
        assert.equal(erdHeight(3, 2), ERD_HEAD + ERD_BODY_PAD + 3 * ERD_ROW + ERD_MORE)
        assert.equal(erdPortY(HEAD_PORT), ERD_HEAD / 2)
        assert.equal(erdPortY(0), ERD_HEAD + 5 + ERD_ROW / 2)
        assert.equal(erdPortY(1) - erdPortY(0), ERD_ROW)
        assert.equal(erdPortId("a", "b", "L"), "a::b::L")
    })

    it("changes the structure key with the structure only, never with a word", () => {
        const a = erdStructureKey(resolveErd(books, relations))
        const renamed = books.map((entity) => ({ ...entity, label: `${entity.label}!`, count: 5 }))
        assert.equal(erdStructureKey(resolveErd(renamed, relations)), a)
        assert.notEqual(erdStructureKey(resolveErd(books, relations.slice(0, 1))), a)
    })
})
