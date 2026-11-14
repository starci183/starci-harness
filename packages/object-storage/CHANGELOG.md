# Changelog

## 0.3.0 - 2026-11-15

- Added: `listKeys(bucket, after, limit)` on the port: every key of the bucket at any depth, in UTF-8 byte order, after `after` (exclusive; null = from the start), at most `limit` (1 to 1000), as `{ keys: ListedKey[], next }` (`next` is the last key of the page, null when the bucket has no more), so a whole-bucket backup can page through it. `ListedKey` is `{ key, size, contentType? }` (the content type only when the store reports it with the listing: S3 does not, the memory double does). A missing bucket answers an empty page. Over S3 it is ListObjectsV2 with `StartAfter` and `MaxKeys` and no delimiter. That S3 lists in UTF-8 binary order is NOT VERIFIED against the AWS documentation (not reachable when written); the memory double sorts by UTF-8 bytes.
- Added: the coded error `OBJECT_STORAGE_LIMIT_INVALID` (kind `invalid`) for a page size that is not a whole number from 1 to 1000; a cursor of 0 or more than 1024 characters is `OBJECT_STORAGE_KEY_INVALID`.
- Added: `S3Transport.listKeys` (a custom transport must implement it); exported types `ListedKey` and `ListedKeysPage`. `list` is unchanged.

## 0.2.0 - 2026-11-08

- Changed: `ObjectStorageError` extends `DomainError` of `@starci/common` (now a dependency): `isDomainError` recognises it, `params` is `{}`; its name, codes, `kind`, `context`, `cause` and message (the code) are unchanged. `ObjectStorageErrorKind` is a subset of `ErrorKind`.
- Changed: requires `@starci/common` 1.0.1 (exact), the one copy an app installs, so `DomainError` stays one class (this version had not reached npm).

## 0.1.0 - 2026-11-03

Object storage for a StarCi back end in one package, lifted from the three apps that each wrote it (the lite starter's presign client, the production lite app's storage integration, the older S3 modules) and generalised: no product names, every setting a typed option, no environment read.

- Added: `ObjectStorageModule.register` / `registerAsync` (with `isGlobal`) providing the `ObjectStorage` port under `OBJECT_STORAGE`, and `createObjectStorage` for plain Node.
- Added: the port: `presignPut` (the content type and, when given, the exact size are part of the signature, so the store refuses an upload that differs), `presignGet` (optional download name), `head`, `confirmUpload`, `get`, `put`, `remove`, `removeMany` (batches of a thousand), `list` (one folder, newest first, paged), `ensureBucket` (anonymous read policy for a public bucket) and `publicUrl`.
- Added: limits (`maxBytes`, `contentTypes` with `image/*` families) as option defaults or per call; a size limit makes `presignPut` require `contentLength`.
- Added: presigned requests signed for a public origin distinct from the internal endpoint, dated by an injectable clock, with a lifetime from one second to seven days.
- Added: coded errors (`OBJECT_STORAGE_NOT_FOUND`, `_UNAVAILABLE`, `_KEY_INVALID`, `_BUCKET_INVALID`, `_EXPIRY_INVALID`, `_SIZE_EXCEEDED`, `_SIZE_REQUIRED`, `_CONTENT_TYPE_NOT_ALLOWED`) with the kind each travels as; every call validates the bucket and key.
- Added: `@starci/object-storage/testing`: `createMemoryObjectStorage` (the real service over an in-memory store, with a `upload` that behaves like the store towards a presigned PUT), `objectStorageTestingModule`, `FakeStorageClock`, `testObjectStorageOptions`.
- The package is the only owner of `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
