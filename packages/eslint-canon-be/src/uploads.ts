/**
 * The mechanically recognisable buffering surfaces of BE-TRANSPORT-1. Browser uploads use storage grants; the API
 * exchanges metadata. An actual byte-stream route remains a separate transport case, so `StreamableFile` stays legal.
 * This rule does not prove a storage policy's principal, key, expiry or byte bound; the integration's behavior specs do.
 */
import { keyName, staticText } from "./lib/ast.ts"
import { importOf, moduleReferences } from "./lib/import-source.ts"
import { resolveVariable } from "./lib/transactions.ts"

/** Libraries that implement API-side multipart uploads instead of a storage grant. */
const UPLOAD_PACKAGES = [
    "multer",
    "express-fileupload",
    "graphql-upload",
    "graphql-upload-minimal",
    "@fastify/multipart",
    "fastify-multipart",
    "busboy",
    "formidable",
    "multiparty",
    "connect-multiparty",
]

/** Selected Nest exports consume multipart files; other exports of these packages remain usable. */
const NEST_UPLOADS = {
    "@nestjs/common": ["UploadedFile", "UploadedFiles"],
    "@nestjs/platform-express": ["MulterModule", "FileInterceptor", "FilesInterceptor", "AnyFilesInterceptor", "FileFieldsInterceptor"],
}

/** The statement block in which this expression is evaluated. */
const statementBlock = (expression) => {
    let statement = expression
    while (statement.parent && !["Program", "BlockStatement"].includes(statement.parent.type)) statement = statement.parent
    return statement.parent
}

/**
 * The namespace source at one read, following completed standalone writes in that statement block.
 * Branches, destructuring assignments and closure execution require dataflow beyond this rule's supported alias shape.
 */
const namespaceSource = (context, expression, seen = new Set()) => {
    if (!expression || seen.has(expression)) return null
    seen.add(expression)
    if (expression?.type === "Identifier") {
        const found = importOf(context, expression)
        if (found?.imported === "*") return found.source
        const variable = resolveVariable(context.sourceCode, expression)
        if (!variable) return null
        const definition = variable.defs[0]
        if (definition?.type !== "Variable" || definition.node.type !== "VariableDeclarator" || definition.node.id.type !== "Identifier") return null
        const writes = variable.references.filter((reference) => reference.isWrite() && !reference.init
            && reference.writeExpr?.range[1] <= expression.range[0])
            .sort((left, right) => right.identifier.range[0] - left.identifier.range[0])
        const write = writes[0]
        if (!write) return namespaceSource(context, definition.node.init, seen)
        const assignment = write.identifier.parent
        if (assignment.type !== "AssignmentExpression" || assignment.operator !== "=" || assignment.left !== write.identifier
            || assignment.parent.type !== "ExpressionStatement" || assignment.parent.parent !== statementBlock(expression)) return null
        return namespaceSource(context, write.writeExpr, seen)
    }
    if (expression?.type === "AwaitExpression") return namespaceSource(context, expression.argument, seen)
    const source = expression?.type === "ImportExpression" ? expression.source
        : expression?.type === "CallExpression" && expression.callee.type === "Identifier" && expression.callee.name === "require" ? expression.arguments[0] : null
    return staticText(source)
}

/** Multipart buffers are never the API's upload contract. */
export const noBufferedUpload = {
    meta: {
        type: "problem",
        docs: { description: "Browser file uploads use presigned storage grants, without Nest/Multer or GraphQL multipart buffering in the API." },
        schema: [],
        messages: {
            buffered: "[BE_UPLOAD_BUFFERED] `{{name}}` accepts multipart files in the API. Return an authenticated, short-lived presigned PUT scoped to the principal and exact object key, signed for the exact content type and length, verify the stored object with a head call after the upload, and send the file directly to storage. An actual streaming REST route needs its own BE-TRANSPORT-1 evidence.",
        },
    },
    create(context) {
        const report = (node, name) => context.report({ node, messageId: "buffered", data: { name } })
        const selected = (source, name) => typeof source === "string" && Object.entries(NEST_UPLOADS)
            .some(([pkg, names]) => (source === pkg || source.startsWith(`${pkg}/`)) && names.includes(name))
        return {
            ...moduleReferences(({ source, value, names }) => {
                if (UPLOAD_PACKAGES.some((pkg) => value === pkg || value.startsWith(`${pkg}/`))) {
                    report(source, value)
                    return
                }
                const forbidden = names.filter((name) => selected(value, name))
                if (forbidden.length > 0) report(source, forbidden.join(", "))
            }),
            MemberExpression(node) {
                const source = namespaceSource(context, node.object)
                const name = node.computed ? staticText(node.property) : keyName(node.property)
                if (selected(source, name)) report(node, name)
            },
            VariableDeclarator(node) {
                if (node.id.type !== "ObjectPattern") return
                const source = namespaceSource(context, node.init)
                for (const property of node.id.properties) {
                    if (property.type !== "Property") continue
                    const name = property.computed ? staticText(property.key) : keyName(property.key)
                    if (selected(source, name)) report(property, name)
                }
            },
        }
    },
}

/** The transport buffering rule's published name. */
export const rules = { "no-buffered-upload": noBufferedUpload }

/** Upload buffering is an error in every backend. */
export const recommended = { "starci-be/no-buffered-upload": "error" }
