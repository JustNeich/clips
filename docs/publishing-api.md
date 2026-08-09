# Machine Publishing API v1

This is the supported server-to-server contract for Oracle to place an already
finished MP4 into the existing Clips YouTube publication queue. The browser
route `POST /api/channels/{id}/publications/ready-upload` is not a machine API.

## Authority and security boundary

- Oracle chooses the exact `publishAt`. Clips does not choose a slot, call
  `next_available`, or require approval.
- The destination is a Clips channel id. A channel is usable only when Clips has
  a connected YouTube destination and a stored server-side refresh credential.
- Google OAuth access/refresh tokens, connector cookies, browser sessions, and
  YouTube upload-session URLs are never accepted or returned by this API.
- Every request uses a dedicated bearer credential. Its only allowed scopes are
  `publication:create` and `publication:read`, and it has a mandatory allowlist
  of Clips channel ids.

Base URL in production:

```text
https://clips-vy11.onrender.com/api/publishing/v1
```

## Provisioning (owner only)

An owner provisions a credential through the existing owner-session endpoint:

```http
POST /api/admin/mcp-machines
Content-Type: application/json

{
  "machineId": "oracle-macbook-publisher",
  "scopes": ["publication:create", "publication:read"],
  "allowedChannelIds": ["<clips-channel-id>"],
  "replaceExisting": true,
  "rotatesInDays": 180
}
```

The response returns a non-secret credential record (`id`, `machineId`, scopes,
allowlist, hint, timestamps) and the raw `secret` once. Store the secret outside
the repository and pass only its handle to Oracle runtime configuration. Revoke
with `DELETE /api/admin/mcp-machines/{credentialId}`. Publishing scopes cannot be
mixed with `control:write`, `flow:read`, or any other machine scope.

Recommended non-secret runtime configuration:

```json
{
  "credentialHandle": "oracle-macbook-publisher",
  "baseUrl": "https://clips-vy11.onrender.com/api/publishing/v1",
  "allowedClipsChannelIds": ["<clips-channel-id>"]
}
```

## Lifecycle

### 1. Create an upload

```http
POST /api/publishing/v1/uploads
Authorization: Bearer <publishing-machine-secret>
Idempotency-Key: oracle-video-2026-07-29-001
Content-Type: application/json

{
  "channelId": "<clips-channel-id>",
  "fileName": "final.mp4",
  "contentType": "video/mp4",
  "contentLength": 18423871,
  "contentSha256": "<64-hex-sha256>",
  "publishAt": "2026-07-30T18:07:00.000Z",
  "title": "Exact YouTube title",
  "description": "Optional description",
  "tags": ["optional", "tags"],
  "notifySubscribers": false
}
```

Required fields are `channelId`, `fileName`, `contentType`, `contentLength`,
`contentSha256`, `publishAt`, and `title`. `publishAt` must be a future RFC3339
timestamp with `Z` or an explicit numeric offset.

New requests return `201`; a replay with the same key and canonical payload
returns `200` and the same `upload.id`. A key bound to different metadata or
hash returns `409 IDEMPOTENCY_KEY_CONFLICT`.

```json
{
  "replayed": false,
  "upload": {
    "id": "<upload-id>",
    "channelId": "<clips-channel-id>",
    "status": "created",
    "contentType": "video/mp4",
    "contentLength": 18423871,
    "contentSha256": "<64-hex-sha256>",
    "publishAt": "2026-07-30T18:07:00.000Z",
    "expiresAt": "<RFC3339>",
    "uploadUrl": "/api/publishing/v1/uploads/<upload-id>/content",
    "commitUrl": "/api/publishing/v1/uploads/<upload-id>/commit"
  },
  "receipt": null,
  "limits": {
    "maxUploadBytes": 536870912,
    "uploadTtlSeconds": 86400,
    "idempotencyKeyMaxBytes": 200
  }
}
```

### 2. Upload the bounded MP4

```http
PUT /api/publishing/v1/uploads/{uploadId}/content
Authorization: Bearer <publishing-machine-secret>
Idempotency-Key: oracle-video-2026-07-29-001
Content-SHA256: <64-hex-sha256>
Content-Type: video/mp4
Content-Length: 18423871

<raw mp4 bytes>
```

Before consuming the one-shot body, the server reserves persistent-storage
headroom and prunes stale inactive media. It then streams the body to storage,
enforces byte length and the 512 MiB limit, calculates SHA-256, checks the MP4
signature, and runs `ffprobe` to require a playable MP4 container with a video
stream. An `ENOSPC` write triggers emergency cleanup before the retryable `503`
is returned, so the client can replay the same idempotent upload. No multipart
encoding is used. Repeating an already completed upload with the same binding
is safe. Success returns `200` with the same upload object and an `uploaded`
status.

### 3. Commit to the existing publication queue

```http
POST /api/publishing/v1/uploads/{uploadId}/commit
Authorization: Bearer <publishing-machine-secret>
Idempotency-Key: oracle-video-2026-07-29-001
Content-SHA256: <64-hex-sha256>
```

Commit rechecks the staged file binding and destination readiness, creates the
existing durable render export and YouTube publication queue job, applies the
exact `publishAt`, and returns a receipt. The machine publication is eligible
for YouTube upload immediately; `publishAt` remains the public release time.
After YouTube returns a durable video id, the server removes its local source
and render-export MP4s so future scheduled batches cannot fill persistent
storage:

```json
{
  "replayed": false,
  "receipt": {
    "receiptId": "<upload-id>",
    "uploadId": "<upload-id>",
    "publicationId": "<publication-id>",
    "channelId": "<clips-channel-id>",
    "contentSha256": "<64-hex-sha256>",
    "publishAt": "2026-07-30T18:07:00.000Z",
    "status": "queued",
    "youtubeVideoUrl": null,
    "lastError": null,
    "statusUrl": "/api/publishing/v1/publications/<publication-id>"
  }
}
```

New commit returns `201`. Repeating it with the same key and hash returns `200`
and the same receipt/publication id. The server never returns stored YouTube
credentials.

### 4. Poll status

```http
GET /api/publishing/v1/publications/{publicationId}
Authorization: Bearer <publishing-machine-secret>
```

This requires `publication:read` and rechecks the credential's channel allowlist.
Receipt status follows the existing queue: `queued`, `uploading`, `scheduled`,
`published`, `failed`, `paused`, or `canceled`. `youtubeVideoUrl` appears only
after Clips has a safe provider result. The response is `{ "receipt": { ... } }`.
Upload state can also be read with
`GET /api/publishing/v1/uploads/{uploadId}`.

## Limits and retry rules

- Maximum MP4: 536,870,912 bytes (512 MiB).
- Upload reservation TTL: 24 hours.
- `Idempotency-Key`: 1-200 bytes; letters, digits, `.`, `_`, `:`, `-`.
- Title: required, maximum 100 characters.
- Description: maximum 5,000 characters.
- Tags: maximum 30, each maximum 100 characters, 500 characters total.
- One active/committed content SHA-256 per Clips channel. A different key cannot
  create a second publication for the same bytes.
- Retry only responses with `retryable: true`, respecting `Retry-After`.
  `UPLOAD_IN_PROGRESS` and `COMMIT_IN_PROGRESS` are bounded concurrency waits;
  transient storage/commit errors use `503`.

## Typed errors

Errors use one stable JSON shape:

```json
{
  "error": "Human-readable message",
  "code": "IDEMPOTENCY_KEY_CONFLICT",
  "retryable": false,
  "field": "Idempotency-Key"
}
```

Important codes include:

- `AUTHENTICATION_REQUIRED`, `AUTHENTICATION_FAILED`, `SCOPE_FORBIDDEN`
- `CHANNEL_NOT_ALLOWED`, `CHANNEL_NOT_FOUND`, `DESTINATION_NOT_READY`
- `INVALID_REQUEST`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_KEY_CONFLICT`
- `DUPLICATE_CONTENT`, `DUPLICATE_PUBLICATION`, `PUBLISH_AT_CONFLICT`
- `CONTENT_LENGTH_REQUIRED`, `CONTENT_LENGTH_MISMATCH`, `CONTENT_TOO_LARGE`
- `CONTENT_HASH_MISMATCH`, `INVALID_MP4`
- `UPLOAD_NOT_FOUND`, `UPLOAD_EXPIRED`, `UPLOAD_NOT_READY`, `UPLOAD_TERMINAL`
- `UPLOAD_IN_PROGRESS`, `COMMIT_IN_PROGRESS`
- `TRANSIENT_STORAGE_ERROR`, `TRANSIENT_COMMIT_ERROR`

Status classes are stable: authentication `401`, scope/allowlist `403`, missing
records `404`, missing `Content-Length` `411`, oversized content `413`, binding,
duplicate, readiness, and concurrency conflicts `409`, byte/container validation
`422`, and retryable server/storage failures `503`. Only responses with
`retryable: true` are automatically retryable.

## Minimal Oracle sequence

Oracle needs no scheduling fields other than its authoritative `publishAt`:

```text
sha256 + byte length of final.mp4
  -> POST uploads (exact Clips channelId + publishAt)
  -> PUT raw bytes
  -> POST commit
  -> persist publicationId
  -> GET status until published or failed
```

On a lost response, repeat the same operation with the same
`Idempotency-Key`, payload, and content SHA-256. Never generate a new key merely
because a response timed out.
