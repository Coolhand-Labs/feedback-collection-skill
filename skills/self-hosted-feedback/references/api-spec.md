# Coolhand v2 API — focused reference for self-hosted-feedback

This document captures what self-hosted-feedback needs to implement to be wire-compatible with the Coolhand v2 API. The authoritative spec lives in this directory at `coolhand-openapi-v2.json` (extracted from https://coolhandlabs.com/docs); use it as the tiebreaker if anything below conflicts.

## Endpoints (3 critical, 1 deferred)

### `POST /api/v2/llm_request_logs`

Create a log entry for an LLM call.

**Request body:**
```json
{
  "raw_request": { /* any JSON object */ },
  "collector": "my-app-nodejs-v1.2.0"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `raw_request` | object | yes | Opaque JSON. The full request/response payload. No schema enforcement. |
| `collector` | string | no | SDK or integration identifier. Free-form. |

**Response 201:**
```json
{
  "id": 123,
  "collector": "my-app-nodejs-v1.2.0",
  "created_at": "2026-05-07T12:00:00Z",
  "updated_at": "2026-05-07T12:00:00Z"
}
```

`id` is the integer the SDK reads back and uses as `llm_request_log_id` on subsequent feedback submissions.

**Errors:**
- 401 — missing/invalid auth → `{"errors": ["Unauthorized"]}`
- 422 — missing `raw_request` → `{"errors": ["raw_request is required"]}`

### `POST /api/v2/llm_request_log_feedbacks`

Create a feedback entry.

**Request body** — all fields optional except the floor rule (at least one of `client_unique_id` or `original_output`):

| Field | Type | v0.1 | Notes |
|---|---|---|---|
| `llm_request_log_id` | integer | use | Exact match to a log row. The strongest match. |
| `llm_provider_unique_id` | string | use | The `x-request-id` from the LLM provider's response. |
| `client_unique_id` | string | use | Your system's unique ID for this run. **Floor field.** |
| `original_output` | string | use | Verbatim LLM output. **Floor field.** |
| `creator_unique_id` | string | use | SHA-256 hash of an internal user ID. Never PII. |
| `sentiment` | string | use | Enum: `"like"` / `"dislike"` / `"neutral"`. Preferred over `like`. |
| `like` | boolean | accept legacy | Deprecated. If `sentiment` is also sent, `sentiment` wins. |
| `explanation` | string | use | Free-form text explaining the rating. |
| `revised_output` | string | use | The user's edited version of the AI output. Highest signal. |
| `collector` | string | use | Same semantics as on logs. |
| `parent_feedback_hashid` | string | use | Chained feedback: hashid of the prior feedback call in the same interaction flow. See `references/chained-partial-feedback.md`. |
| `focus_section` | string | use | Partial feedback: verbatim selected substring of `original_output`. |
| `focus_range` | object | use | Partial feedback: `{start: int, end: int}` character offsets (0-indexed, inclusive start, exclusive end) against `original_output`. |
| `workload_hashid` | string | **defer** | Workload grouping. See issue #4. |
| `coolhand_fingerprint_id` | string | **never** | Set by coolhand-js widget only. Server code must not populate. |

**Response 201:** Returns the inserted feedback row, including server-assigned fields: `id` (a hashid string), `client_id`, `focus_range_stale` (boolean, always `false` on create), `created_at`, `updated_at`.

### `PATCH /api/v2/llm_request_log_feedbacks/{id}`

Update an existing feedback entry.

- Body accepts the same client-settable fields as POST (`focus_range_stale` is server-set; ignore if a client sends it).
- Identity fields (`creator_unique_id`, `llm_request_log_id`, `llm_provider_unique_id`) are immutable. Reject changes with 422.
- If `original_output` is present in the body and the existing row has `focus_range_start IS NOT NULL`, set `focus_range_stale = true` as part of the same update.
- Return the updated row with 200.
- Return 404 if `{id}` doesn't exist.

### `GET /api/v2/inference_apis` *(deferred for v0.1)*

Pricing metadata for LLM providers. Out of scope for self-hosted v0.1; see [issue #2](https://github.com/Coolhand-Labs/feedback-collection-skill/issues/2). Self-hosted users who need pricing data can call the upstream Coolhand version of this endpoint directly (it does not require auth).

## Auth (3 mechanisms)

The middleware must accept any of:

1. `X-API-Key: <key>` header (preferred)
2. `Authorization: Bearer <key>` header
3. `?api_key=<key>` query parameter

Reject with 401 and `{"errors": ["Unauthorized"]}` if none is valid.

## Error response shapes

All errors return JSON with an `errors` array of strings:

```json
{"errors": ["Unauthorized"]}
{"errors": ["raw_request is required"]}
{"errors": ["llm_request_log_feedback not found"]}
{"errors": ["creator_unique_id is immutable"]}
```

## SQL schemas

### Postgres

```sql
CREATE TABLE llm_request_logs (
  id           BIGSERIAL PRIMARY KEY,
  collector    TEXT,
  raw_request  JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE llm_request_log_feedbacks (
  id                      BIGSERIAL PRIMARY KEY,
  client_id               TEXT,
  llm_request_log_id      BIGINT REFERENCES llm_request_logs(id),
  sentiment               TEXT CHECK (sentiment IN ('like','dislike','neutral')),
  "like"                  BOOLEAN,
  explanation             TEXT,
  revised_output          TEXT,
  llm_provider_unique_id  TEXT,
  original_output         TEXT,
  client_unique_id        TEXT,
  creator_unique_id       TEXT,
  collector               TEXT,
  parent_feedback_hashid  TEXT,
  focus_section           TEXT,
  focus_range_start       INTEGER,
  focus_range_end         INTEGER,
  focus_range_stale       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT feedback_floor CHECK (client_unique_id IS NOT NULL OR original_output IS NOT NULL)
);

CREATE INDEX idx_feedbacks_log_id ON llm_request_log_feedbacks(llm_request_log_id);
CREATE INDEX idx_feedbacks_creator ON llm_request_log_feedbacks(creator_unique_id);
```

### MySQL

```sql
CREATE TABLE llm_request_logs (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  collector    VARCHAR(255),
  raw_request  JSON NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE llm_request_log_feedbacks (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id               VARCHAR(255),
  llm_request_log_id      BIGINT UNSIGNED,
  sentiment               ENUM('like','dislike','neutral'),
  `like`                  BOOLEAN,
  explanation             TEXT,
  revised_output          TEXT,
  llm_provider_unique_id  VARCHAR(255),
  original_output         TEXT,
  client_unique_id        VARCHAR(255),
  creator_unique_id       VARCHAR(255),
  collector               VARCHAR(255),
  parent_feedback_hashid  VARCHAR(255),
  focus_section           TEXT,
  focus_range_start       INT,
  focus_range_end         INT,
  focus_range_stale       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (llm_request_log_id) REFERENCES llm_request_logs(id),
  INDEX idx_feedbacks_creator (creator_unique_id)
);
```

MySQL CHECK constraints are advisory pre-8.0.16; enforce the floor rule in application code if the user is on an older version.

### SQLite

```sql
CREATE TABLE llm_request_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  collector    TEXT,
  raw_request  TEXT NOT NULL,                 -- JSON encoded as text
  created_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE llm_request_log_feedbacks (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id               TEXT,
  llm_request_log_id      INTEGER REFERENCES llm_request_logs(id),
  sentiment               TEXT CHECK (sentiment IN ('like','dislike','neutral')),
  "like"                  INTEGER,             -- 0/1
  explanation             TEXT,
  revised_output          TEXT,
  llm_provider_unique_id  TEXT,
  original_output         TEXT,
  client_unique_id        TEXT,
  creator_unique_id       TEXT,
  collector               TEXT,
  parent_feedback_hashid  TEXT,
  focus_section           TEXT,
  focus_range_start       INTEGER,
  focus_range_end         INTEGER,
  focus_range_stale       INTEGER NOT NULL DEFAULT 0,   -- 0/1 boolean
  created_at              TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at              TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  CHECK (client_unique_id IS NOT NULL OR original_output IS NOT NULL)
);

CREATE INDEX idx_feedbacks_log_id ON llm_request_log_feedbacks(llm_request_log_id);
CREATE INDEX idx_feedbacks_creator ON llm_request_log_feedbacks(creator_unique_id);
```

`raw_request` is stored as TEXT in SQLite because there's no native JSON type. Use `json_extract()` for ad-hoc queries.

## Field naming notes

- `like` is a SQL reserved word in many engines. Quote it (Postgres / SQLite: `"like"`; MySQL: backticks).
- `client_id` in the feedback row is **not** the same as `client_unique_id`. `client_id` is the API-key namespace owner (a constant for self-hosted users); `client_unique_id` is the user-supplied identifier for matching feedback to LLM runs.
