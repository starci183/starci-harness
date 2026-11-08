# Changelog

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
