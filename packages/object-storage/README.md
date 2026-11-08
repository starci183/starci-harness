# @starci/object-storage

Object storage of a StarCi back end over S3-compatible storage (MinIO in lite): one package, two entries.

| entry | holds |
|---|---|
| `@starci/object-storage` | `ObjectStorageModule` (`register` / `registerAsync`), the `ObjectStorage` port under `OBJECT_STORAGE`, `createObjectStorage` for plain Node, the coded `ObjectStorageError` |
| `@starci/object-storage/testing` | `createMemoryObjectStorage` (the real checks over memory), `objectStorageTestingModule`, `FakeStorageClock` |

The package owns `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`; an app imports neither (the lint refuses them) and reaches the package only through `integrations/object-storage`.

```ts
ObjectStorageModule.registerAsync({
    isGlobal: true,
    useFactory: () => parsedOptions, // parsed in the app (BE-CONFIG-2); the package reads no environment
})

const put = await storage.presignPut("media", `users/${id}/avatar.png`, { contentType: "image/png", contentLength: 48_211 })
// put.url, put.headers (Content-Type, Content-Length), put.expiresAt
await storage.confirmUpload("media", key) // head + the limits, after the browser says it is done
```

The app keeps the bucket names, the key layout of each domain and the parsing of its settings. A call validates its bucket and key; a missing object answers `null` from `head` and `get`; every other failure rejects with an `ObjectStorageError` (a `DomainError` of `@starci/common`) whose `code` is stable and whose `kind` is `invalid`, `not-found` or `unavailable`.

`publicEndpoint` is the origin browsers reach; presigned requests are signed for it while the back end calls `endpoint`. `limits` (`maxBytes`, `contentTypes`) apply to every upload unless a call names its own; while a size limit is in force `presignPut` requires `contentLength`, which the signature fixes.

## Tests

`npm test` typechecks, lints and runs the `node:test` specs (a local S3 for the AWS transport, the service over memory) under 90% line coverage.
