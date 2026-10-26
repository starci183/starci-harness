// proves: BE_UPLOAD_BUFFERED@lite
// proves: BE_UPLOAD_BUFFERED@full
import assert from "node:assert/strict"
import test from "node:test"
import { appDeclaration } from "./fixtures/app.mjs"
import { at, BE_DECLARATION, ruleTester, TYPED_ROOT } from "./fixtures/typed/tester.mjs"
import { hfsFromDeclaration } from "./lib/hfs.mjs"
import { noBufferedUpload, recommended, rules } from "./uploads.mjs"

const FILE = at("src/features/api/assets/transport/graphql/mint-upload.resolver.ts")
const ERROR = [{ messageId: "buffered" }]

for (const edition of ["lite", "full"]) {
    test(`${edition} accepts actual streams and storage metadata and rejects buffered multipart uploads`, () => {
        const hfs = hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT)
        ruleTester({ root: TYPED_ROOT, hfs }).run("no-buffered-upload", noBufferedUpload, {
            valid: [
                { filename: FILE, code: 'import { StreamableFile, Get, Body } from "@nestjs/common"\nexport { StreamableFile, Get, Body }' },
                { filename: FILE, code: 'import { ExpressAdapter } from "@nestjs/platform-express"\nexport { ExpressAdapter }' },
                { filename: FILE, code: 'import { NoFilesInterceptor } from "@nestjs/platform-express"\nexport { NoFilesInterceptor }' },
                { filename: FILE, code: 'import { NoFilesInterceptor } from "@nestjs/platform-express/multer/interceptors/no-files.interceptor"\nexport { NoFilesInterceptor }' },
                { filename: FILE, code: 'import * as Nest from "@nestjs/common"\nexport const bytes = Nest.StreamableFile' },
                { filename: FILE, code: 'import { createPresignedPost } from "@aws-sdk/s3-presigned-post"\nexport { createPresignedPost }' },
                { filename: FILE, code: 'const UploadedFile = () => "local"\nUploadedFile()' },
                { filename: FILE, code: 'const Nest = { UploadedFile: () => "local" }\nNest.UploadedFile()' },
                { filename: FILE, code: 'let Nest = await import("@nestjs/common"); Nest = { UploadedFile: () => "local" }; Nest.UploadedFile()' },
                { filename: FILE, code: 'import * as Nest from "@nestjs/common"\nlet alias = Nest; alias = { UploadedFile: () => "local" }; alias.UploadedFile()' },
                { filename: FILE, code: 'import type { File } from "./multer-like.contracts"\nexport type { File }' },
                { filename: FILE, code: 'import { x } from "constructor"\nexport { x }' },
            ],
            invalid: [
                ...["UploadedFile", "UploadedFiles"].map((name) => ({ filename: FILE, code: `import { ${name} as FilePayload } from "@nestjs/common"`, errors: ERROR })),
                ...["MulterModule", "FileInterceptor", "FilesInterceptor", "AnyFilesInterceptor", "FileFieldsInterceptor"].map((name) => ({ filename: FILE, code: `import { ${name} as Upload } from "@nestjs/platform-express"`, errors: ERROR })),
                { filename: FILE, code: 'export { UploadedFile as FilePayload } from "@nestjs/common"', errors: ERROR },
                { filename: FILE, code: 'import * as Nest from "@nestjs/common"\nNest.UploadedFile()', errors: ERROR },
                { filename: FILE, code: 'import * as Nest from "@nestjs/common"\nNest["UploadedFiles"]()', errors: ERROR },
                { filename: FILE, code: 'import * as Nest from "@nestjs/common"\nconst alias = Nest\nalias.UploadedFile()', errors: ERROR },
                { filename: FILE, code: 'const Nest = await import("@nestjs/common")\nNest.UploadedFile()', errors: ERROR },
                { filename: FILE, code: 'let Nest = await import("@nestjs/common")\nNest.UploadedFile()', errors: ERROR },
                { filename: FILE, code: 'let Nest = await import("@nestjs/common"); Nest.UploadedFile(); Nest = { UploadedFile: () => "local" }', errors: ERROR },
                { filename: FILE, code: 'let Nest = { UploadedFile: () => "local" }; Nest = await import("@nestjs/common"); Nest.UploadedFile()', errors: ERROR },
                { filename: FILE, code: 'let Nest = await import("@nestjs/common"); Nest = Nest; Nest.UploadedFile()', errors: ERROR },
                { filename: FILE, code: 'import * as Nest from "@nestjs/common"\nlet alias = Nest\nalias.UploadedFile()', errors: ERROR },
                { filename: FILE, code: 'const Nest = require("@nestjs/common")\nNest.UploadedFile()', errors: ERROR },
                { filename: FILE, code: 'import * as Nest from "@nestjs/common"\nconst { UploadedFile: file } = Nest', errors: ERROR },
                { filename: FILE, code: 'import * as Nest from "@nestjs/common"\nNest[`UploadedFile`]()', errors: ERROR },
                { filename: FILE, code: 'import * as Nest from "@nestjs/common"\nconst { [`UploadedFile`]: file } = Nest', errors: ERROR },
                { filename: FILE, code: 'const { FileInterceptor } = await import("@nestjs/platform-express")', errors: ERROR },
                { filename: FILE, code: 'const { FileInterceptor } = await import(`@nestjs/platform-express`)', errors: ERROR },
                { filename: FILE, code: '(await import("@nestjs/common")).UploadedFile()', errors: ERROR },
                { filename: FILE, code: 'const { UploadedFile: file } = require("@nestjs/common")', errors: ERROR },
                { filename: FILE, code: 'import type { Options } from "multer"', errors: ERROR },
                { filename: FILE, code: 'import upload from "express-fileupload"', errors: ERROR },
                { filename: FILE, code: 'export * from "graphql-upload"', errors: ERROR },
                { filename: FILE, code: 'export { default } from "graphql-upload/GraphQLUpload.mjs"', errors: ERROR },
                { filename: FILE, code: 'await import("graphql-upload-minimal")', errors: ERROR },
                ...["@fastify/multipart", "fastify-multipart", "busboy", "formidable", "multiparty", "connect-multiparty"].map((name) => ({ filename: FILE, code: `import parser from "${name}"`, errors: ERROR })),
                { filename: FILE, code: 'await import("@fastify/multipart/index.js")', errors: ERROR },
                { filename: FILE, code: 'require("multer")', errors: ERROR },
                { filename: FILE, code: 'import upload = require("multer")', errors: ERROR },
                { filename: FILE, code: 'import { FileInterceptor } from "@nestjs/platform-express/multer/interceptors/file.interceptor"', errors: ERROR },
                { filename: FILE, code: 'import { FileInterceptor } from "@nestjs/platform-express/multer"', errors: ERROR },
                { filename: FILE, code: 'import { UploadedFile } from "@nestjs/common/decorators/http/route-params.decorator"', errors: ERROR },
            ],
        })
    })

}

test("the upload rule is published at error", () => {
    assert.equal(rules["no-buffered-upload"], noBufferedUpload)
    assert.equal(recommended["starci-be/no-buffered-upload"], "error")
})
