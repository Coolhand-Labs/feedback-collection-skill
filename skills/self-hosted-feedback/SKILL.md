---
name: self-hosted-feedback
description: |
  Use when the user has confirmed they want to host their own
  Coolhand-equivalent backend (rather than using managed coolhandlabs.com).
  Triggers from the feedback-collection planner skill at Phase 5 dispatch when
  the user picks "self-hosted" / "self-host" / "own backend." Also use when
  the user says "I want to host this myself," "no third-party," "data
  residency," or asks how to point Coolhand SDKs at a custom endpoint.
version: 0.1.0
---

# Self-Hosted Feedback (Coolhand-Compatible)

Scaffold endpoints on the user's own backend that mirror the Coolhand v2 API, then point the Coolhand SDKs at the user's host instead of coolhandlabs.com. The user owns the database, owns the data, and owns analysis.

This skill assumes:
- The planner skill has produced an approved feedback strategy.
- The user explicitly chose self-hosted at the planner's Phase 5 dispatch.
- The user's project has a database (Phase B re-checks; if not, route back to managed).

The canonical Coolhand v2 API is documented at https://coolhandlabs.com/docs. A focused summary lives in this skill's `references/api-spec.md`, with the underlying OpenAPI spec snapshotted at `references/coolhand-openapi-v2.json` and metadata (timestamp + hash) at `references/coolhand-openapi-v2.meta.json`.

## Important caveat — read first

This skill assumes the four Coolhand SDKs accept a `base_url` / `baseUrl` configuration option. As of v0.1, that work is in flight upstream:

- https://github.com/Coolhand-Labs/coolhand-node/issues/33
- https://github.com/Coolhand-Labs/coolhand-python/issues/21
- https://github.com/Coolhand-Labs/coolhand-ruby/issues/48
- https://github.com/Coolhand-Labs/coolhand-js/issues/28

If the SDK the user needs has not yet shipped `base_url`, this skill will:
1. Tell the user explicitly which issue is blocking.
2. Offer to scaffold the endpoints anyway (the user can call them directly with `curl`/`fetch` while the SDK catches up).
3. Recommend tracking the upstream issue.

## Rationalizations to resist

These three guardrails bite hardest at implementation time. The full discussion lives in the planner; recap here so they're present at the moment of temptation:

| Excuse | Counter |
|---|---|
| "The user ID is internal-only / non-PII, hashing is overkill — and this is self-hosted anyway." | Hash anyway. Self-hosted does not change the rule. The data still ends up in a DB someone can query. SHA-256 of the internal ID, every time. |
| "We approved the widget once; this next placement is similar." | Every UI change gets its own diff and its own sign-off. Approved one ≠ approved all. |
| "Feedback API key is missing; the user is in a hurry; I'll wire up and they can fill it in later." | Stop. Wait for the key (or generate one and have the user store it). Implementing without it produces silent send failures at runtime. |

If you find yourself constructing a fourth rationalization, surface it to the user instead of acting on it.

## CLI troubleshooting

If any `coolhand` CLI call is not found or behaves unexpectedly, run `npm install -g coolhand-cli` (or `npx coolhand-cli <command>` for a zero-install one-shot) and retry. See https://github.com/Coolhand-Labs/coolhand-cli for full install instructions.

## Phase A: Verify spec freshness

The skill ships a snapshot of the Coolhand v2 OpenAPI spec at `references/coolhand-openapi-v2.json`. The snapshot is the source of truth for scaffolding — deterministic output, works offline, reviewable in PRs. But it can drift as upstream evolves. This phase gives the user the option to check.

**1.** Read `references/coolhand-openapi-v2.meta.json` and capture `snapshot_taken_at`.

**2.** Ask the user:

> "The bundled Coolhand v2 spec snapshot is from {snapshot_taken_at}. Want me to check coolhandlabs.com/docs for a newer version before scaffolding? (y/n)"

**3. If the user says no, OR you have no fetch-capable tool available in this environment:** continue to Phase B with the local snapshot. Tell the user:

> "Using the bundled snapshot from {snapshot_taken_at}. To get a refreshed snapshot, open an issue at https://github.com/Coolhand-Labs/feedback-collection-skill/issues — or, if you're working from a fork, run `bin/refresh-openapi-snapshot` from the repo root."

**4. If the user says yes**, attempt the freshness check using whatever tool you have available — `WebFetch`, Bash + `curl`, an MCP fetcher, anything that can retrieve a URL. The skill is intentionally not proscriptive about how; pick what works.

  a. **Fetch** `https://coolhandlabs.com/docs`. The page is HTML.

  b. **Extract the OpenAPI spec.** It's embedded inside a `__redoc_state` JavaScript variable in the HTML — find the `__redoc_state = {...};` assignment, then the spec lives at `state.spec.data`. To find the matching close brace, walk forward counting `{` and `}` while ignoring those inside string literals.

  c. **Compare structurally** against the local snapshot at `references/coolhand-openapi-v2.json`. Compare:
     - Set of paths in `paths`. New paths added? Old paths removed?
     - For each shared path: methods, request body schema `$ref`, response schema `$ref`s.
     - Set of schema names in `components.schemas`. New / removed?
     - For each shared schema: `required` field set, property names.

  d. **Report**:
     - **No structural differences** → "Spec is current."
     - **Drift detected** → list the specific changes (e.g., "endpoint `/api/v2/exports` is new upstream", "the `like` field has been removed from `create_llm_request_log_feedback_params`"). Offer to draft an issue at https://github.com/Coolhand-Labs/feedback-collection-skill/issues/new asking maintainers to refresh the snapshot. Continue to Phase B with the bundled snapshot for this session — deterministic scaffolding takes priority over freshness when they conflict.
     - **Couldn't fetch / couldn't extract** → tell the user "Couldn't verify upstream right now. The bundled snapshot is from {snapshot_taken_at}." Continue to Phase B.

**Do not block self-hosted setup on freshness check failures.** The check is informational. The snapshot is the contract for scaffolding either way.

## Phase B: Verify a database exists

The planner's Phase 2 already detected the user's DB/ORM. Re-confirm here:

- Postgres + Rails (ActiveRecord) → ActiveRecord migrations.
- Postgres / MySQL / SQLite + Django → Django migrations.
- Postgres / SQLite + SQLAlchemy / Alembic → Alembic.
- Postgres + Prisma → Prisma migrations.
- Postgres + Sequelize / TypeORM / Drizzle → that ORM's migration mechanism.
- No DB at all → **stop and route back to managed**. Tell the user:

> "You don't have a database in this project, and self-hosted feedback needs somewhere to store the data. Recommend starting on managed Coolhand for now — when you add a DB, you can move to self-hosted then.
>
> Caveat: the Coolhand v2 API does not yet expose export endpoints (see https://github.com/Coolhand-Labs/feedback-collection-skill/issues/5), so today 'migrate later' means starting fresh self-hosted with no historical data. If you'd rather wait until export ships, fine — let me know."

If the user does have a DB but it isn't on the list above, ask which migration tooling they use, then proceed.

## Phase C: Generate schema

Two tables, mirroring the Coolhand v2 data model. See `references/api-spec.md` for full field definitions and per-DB SQL examples.

### `llm_request_logs`

```
id                bigint primary key
collector         text
raw_request       jsonb (Postgres) | json (MySQL) | text (SQLite)
created_at        timestamp
updated_at        timestamp
```

### `llm_request_log_feedbacks`

```
id                       bigint primary key
client_id                text         -- your app's namespace; can be a constant
llm_request_log_id       bigint       -- FK → llm_request_logs.id, nullable
sentiment                text         -- 'like' | 'dislike' | 'neutral', nullable
like                     boolean      -- deprecated; only populated if sentiment is null
explanation              text
revised_output           text
llm_provider_unique_id   text
original_output          text
client_unique_id         text
creator_unique_id        text
collector                text
created_at               timestamp
updated_at               timestamp
```

The deferred fields (`workload_hashid`, `parent_feedback_hashid`, `focus_section`, `focus_range`, `coolhand_fingerprint_id`) are intentionally not in v0.1's schema — see [issue #3](https://github.com/Coolhand-Labs/feedback-collection-skill/issues/3) and [issue #4](https://github.com/Coolhand-Labs/feedback-collection-skill/issues/4).

Generate the migration in the user's ORM syntax. Use `references/api-spec.md` to verify field types when in doubt.

## Phase D: Generate endpoints

Three endpoints, in the user's framework. All require API key auth (Phase E). See `references/api-spec.md` for canonical request/response shapes.

### `POST /api/v2/llm_request_logs`

- Accept `{raw_request: <any JSON>, collector?: string}`.
- Insert a new row, return `{id, collector, created_at, updated_at}` with status 201.
- Return 422 with `{errors: ["raw_request is required"]}` if `raw_request` is missing.

### `POST /api/v2/llm_request_log_feedbacks`

- Accept the field set from Phase C's `llm_request_log_feedbacks` table (minus `id`/`client_id`/`created_at`/`updated_at`, which are server-set).
- If both `sentiment` and `like` are sent, `sentiment` wins; persist `sentiment` and ignore `like`.
- Return the inserted row with status 201.

### `PATCH /api/v2/llm_request_log_feedbacks/{id}`

- Accept the same field set as POST.
- Update only the fields present in the request body. Identity fields (`creator_unique_id`, `llm_request_log_id`, `llm_provider_unique_id`) are immutable — return 422 if changed.
- Return the updated row with status 200.
- Return 404 if `{id}` doesn't exist.

## Phase E: Auth middleware

Mirror Coolhand's three auth mechanisms:
- `X-API-Key: <key>` header (preferred)
- `Authorization: Bearer <key>` header
- `?api_key=<key>` query param

Generate or reuse one or more API keys for the user. Store them in `.env` as `FEEDBACK_API_KEYS` (comma-separated for multiple) or in whatever secrets store the project uses. Reject requests without a valid key with status 401 and the canonical Coolhand error shape:

```json
{"errors": ["Unauthorized"]}
```

## Phase F: Install the SDK with base_url pointing at the user's host

Per-language config — adapt to the user's stack. Examples assume the SDK has shipped `base_url`; if not, see "Important caveat" above.

Ruby:
```ruby
Coolhand.configure do |config|
  config.api_key = ENV['FEEDBACK_API_KEY']
  config.base_url = ENV['FEEDBACK_BASE_URL']  # set to your host's https URL
end
```

Python:
```python
from coolhand import Coolhand
client = Coolhand(
    api_key=os.environ['FEEDBACK_API_KEY'],
    base_url=os.environ['FEEDBACK_BASE_URL'],
)
```

Node.js:
```javascript
import { initializeGlobalMonitoring } from 'coolhand-node';
await initializeGlobalMonitoring({
  apiKey: process.env.FEEDBACK_API_KEY,
  baseUrl: process.env.FEEDBACK_BASE_URL,
});
```

coolhand-js (only if active UI was approved):
```html
<script src="https://cdn.jsdelivr.net/npm/coolhand@latest/dist/coolhand.min.js"></script>
<script>
  CoolhandJS.init('YOUR_PUBLIC_FEEDBACK_KEY', {
    baseUrl: 'YOUR_FEEDBACK_BASE_URL',
    clientUniqueId: USER_HASH_HERE,
  });
</script>
```

## Phase G: Implement feedback calls

Same rules as the planner's Phase 3:

- Hashed `creator_unique_id`.
- Best available match field, with `client_unique_id` and/or `original_output` always present as the floor. For `llm_provider_unique_id`: use `response.id` (OpenAI/Anthropic) or `response.messageId` (Copilot/Microsoft), captured before any output transformation. For `original_output`: pass the raw response content, not a summarised or restructured version.
- `sentiment` (string enum), not `like` (boolean).
- `collector: "<your-app-slug>-manual"` to distinguish data sources in your own analytics.

## Phase H: Smoke test

Before reporting completion:

1. Start the user's app server.
2. Send one test request to each endpoint with `curl` (or the equivalent), confirm 201/200/200 with valid JSON.
3. Confirm the auth middleware rejects requests with no key (401) and accepts requests with the configured key.
4. Make one real LLM call from the user's app, confirm a row appears in `llm_request_logs`.
5. Submit one feedback via the SDK, confirm a row appears in `llm_request_log_feedbacks`.

If any of these fail, debug before reporting completion.

## Phase I: Post-implementation checklist

- [ ] All three endpoints respond with the expected status codes and JSON shapes.
- [ ] Auth middleware accepts all three mechanisms (`X-API-Key`, `Authorization: Bearer`, `?api_key=`).
- [ ] At least one of `client_unique_id` or `original_output` is included on every feedback submission; if `original_output`, it is the raw model response (pre-transformation).
- [ ] No PII in `creator_unique_id`.
- [ ] `sentiment` is the field used for binary signals; `like` is only populated when `sentiment` is unavailable.
- [ ] The user understands that historical data captured here lives only in their DB — Coolhand never sees it.
- [ ] If/when the user later wants to switch to managed Coolhand, they have the option (managed Coolhand will accept the same SDK calls with the default `base_url`).
