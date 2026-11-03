/**
 * Twin tests for the storage owner law (R331 `BE_STORAGE_OWNER`, judged by `infra-import-owner`): the AWS S3 client libraries
 * are the dependencies of `@starci/object-storage` and no app file imports them, the package is imported only by
 * `integrations/object-storage`, and `minio` is imported nowhere.
 *
 *   node --test src/object-storage-package.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { at, fixtureHfs } from "../fixtures/typed/tester.ts"
import { infraImportOwner } from "./infra-owner.ts"

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})

const GLUE = at("src/modules/integrations/object-storage/object-storage.module.ts")
const GLUE_SPEC = at("src/modules/integrations/object-storage/object-storage.config.spec.ts")
const DOMAIN = at("src/modules/domain/media/media.service.ts")
const PASSPORT = at("src/modules/integrations/passport/passport.kit.ts")

const PACKAGE = `import { ObjectStorageModule } from "@starci/object-storage"; export const m = ObjectStorageModule`
const TESTING = `import { createMemoryObjectStorage } from "@starci/object-storage/testing"; export const s = createMemoryObjectStorage`

test("the slot manifest gives the package to integrations/object-storage and the AWS S3 libraries to nobody", () => {
    const table = fixtureHfs().ruleParams.infraOwners
    assert.deepEqual(table["@starci/object-storage"], ["integrations/object-storage"])
    assert.deepEqual(table["@aws-sdk/client-s3"], [])
    assert.deepEqual(table["@aws-sdk/s3-request-presigner"], [])
    assert.deepEqual(table.minio, [])
})

test("infra-import-owner: the package belongs to integrations/object-storage and the S3 libraries to nobody", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [
            { filename: GLUE, code: PACKAGE },
            { filename: GLUE, code: `import type { ObjectStorage } from "@starci/object-storage"; export type S = ObjectStorage` },
            { filename: GLUE_SPEC, code: TESTING },
        ],
        invalid: [
            { filename: DOMAIN, code: PACKAGE, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: TESTING, errors: [{ messageId: "foreign" }] },
            { filename: PASSPORT, code: PACKAGE, errors: [{ messageId: "foreign" }] },
            { filename: GLUE, code: `import { S3Client } from "@aws-sdk/client-s3"; export const s = S3Client`, errors: [{ messageId: "nowhere" }] },
            { filename: GLUE, code: `import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; export const s = getSignedUrl`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `import { S3Client } from "@aws-sdk/client-s3"; export const s = S3Client`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `import { PutObjectCommand } from "@aws-sdk/client-s3/dist-types/commands"; export const s = PutObjectCommand`, errors: [{ messageId: "nowhere" }] },
            { filename: GLUE, code: `import { Client } from "minio"; export const c = Client`, errors: [{ messageId: "nowhere" }] },
        ],
    })
})
