import { readFileSync } from "node:fs"
import type TS from "typescript"

const METADATA_SOURCE = require.resolve("./unit-metadata.generated.js")
const METADATA_TEXT = readFileSync(METADATA_SOURCE, "utf8")

type TypeScript = typeof TS

/** What the transformer reads of the ts-jest compiler: the TypeScript module the project compiles with. */
interface MetadataCompiler {
  readonly configSet: { readonly compilerModule: TypeScript }
}

/** The part of a ts-jest transform result the after-transformer rewrites. */
interface CodeResult {
  readonly code: string
}

/** `getEmitFlags` is in every TypeScript the transformer runs on but not in its public typings. */
interface EmitFlagsApi {
  getEmitFlags(node: TS.Node): TS.EmitFlags
}

const hasEmitFlags = (ts: TypeScript): ts is TypeScript & EmitFlagsApi => "getEmitFlags" in ts && typeof ts.getEmitFlags === "function"

function emitFlagsOf(ts: TypeScript, node: TS.Node): TS.EmitFlags {
  if (!hasEmitFlags(ts)) throw new TypeError("ts.getEmitFlags is not a function")
  return ts.getEmitFlags(node)
}

/** Only synthetic conditional guards inside compiler-emitted parameter metadata map to the generated-metadata anchor: a zero-width position at its end, which no line covers, so they are measured nowhere and source metadata calls stay measured. */
function factory(compiler: MetadataCompiler): TS.TransformerFactory<TS.SourceFile> {
  const ts = compiler.configSet.compilerModule
  const source = ts.createSourceMapSource(METADATA_SOURCE, METADATA_TEXT)
  return (context) => {
    const visit = (node: TS.Node): TS.Node => {
      if (isGeneratedMetadata(ts, node)) {
        const guard = (child: TS.Node): TS.Node => {
          if (isGeneratedGuard(ts, child)) {
            ts.setSourceMapRange(child, { pos: METADATA_TEXT.length, end: METADATA_TEXT.length, source })
            ts.setEmitFlags(child, emitFlagsOf(ts, child) | ts.EmitFlags.NoNestedSourceMaps)
            return child
          }
          return ts.visitEachChild(child, guard, context)
        }
        return ts.visitEachChild(node, guard, context)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return (file) => ts.visitNode(file, visit, ts.isSourceFile)
  }
}

/** Only TypeScript's synthetic __metadata("design:paramtypes", ...) call is eligible; source calls remain measured. */
function isGeneratedMetadata(ts: TypeScript, node: TS.Node): boolean {
  if (node.pos >= 0 || !ts.isCallExpression(node)) return false
  const key = node.arguments[0]
  return ts.isIdentifier(node.expression) && node.expression.text === "__metadata" && node.arguments.length === 2 && key !== undefined && ts.isStringLiteral(key) && key.text === "design:paramtypes"
}

/** A metadata exclusion requires TypeScript's synthetic `typeof value === "function" ? value : Object` guard shape. */
function isGeneratedGuard(ts: TypeScript, node: TS.Node): boolean {
  if (node.pos >= 0 || !ts.isConditionalExpression(node)) return false
  const condition = node.condition
  return ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ts.isTypeOfExpression(condition.left) && ts.isStringLiteral(condition.right) && condition.right.text === "function" && ts.isIdentifier(node.whenFalse) && node.whenFalse.text === "Object"
}

/** ts-jest normalizes map sources to the input file; restore the generated metadata anchor before Jest reads the map. */
function restoreMetadataSource<R extends CodeResult>(result: R): R {
  const prefix = "sourceMappingURL=data:application/json;charset=utf-8;base64,"
  const offset = result.code.lastIndexOf(prefix)
  if (offset < 0) return result
  const start = offset + prefix.length
  const map: { sources: string[]; sourcesContent?: string[] } = JSON.parse(Buffer.from(result.code.slice(start), "base64").toString("utf8"))
  if (map.sourcesContent?.length !== 2 || map.sourcesContent[1] !== METADATA_TEXT) return result
  map.sources = [map.sources[0] ?? "", METADATA_SOURCE]
  return { ...result, code: result.code.slice(0, start) + Buffer.from(JSON.stringify(map)).toString("base64") }
}

/** Unit transforms delegate compilation and caching to ts-jest; the after-transformer changes metadata mappings only. */
function createTransformer(options?: Parameters<typeof import("ts-jest").default.createTransformer>[0]) {
  const tsJest: typeof import("ts-jest") = require("ts-jest")
  const delegate = tsJest.default.createTransformer(options)
  return {
    getCacheKey: (...args: Parameters<typeof delegate.getCacheKey>) => delegate.getCacheKey(...args) + ":starci-unit-metadata-6",
    process: (...args: Parameters<typeof delegate.process>) => restoreMetadataSource(delegate.process(...args)),
    processAsync: async (...args: Parameters<typeof delegate.processAsync>) => restoreMetadataSource(await delegate.processAsync(...args)),
  }
}

const unitMetadata = { name: "starci-unit-metadata", version: 6, factory, createTransformer }

export = unitMetadata
