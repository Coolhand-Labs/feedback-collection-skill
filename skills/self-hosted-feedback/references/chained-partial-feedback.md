# Chained and Partial Feedback: Matching Semantics

Reference for the self-hosted implementation (`self-hosted-feedback`). The managed Coolhand backend has its own internal semantics for these fields; this document covers only the self-hosted case.

---

## Chained feedback (`parent_feedback_hashid`)

Chained feedback links a new feedback record to an existing one. A typical chain: thumbs-down on first view → text explanation submitted in a second interaction → revised output accepted in a third. Each step is a separate record; successive steps reference the prior one via `parent_feedback_hashid`.

The field stores a string identifier. In the self-hosted schema, `parent_feedback_hashid` is a `text` column with no foreign key constraint — the value is stored as-is from the client, and no database-level relationship is enforced between parent and child rows.

### What happens when a parent record is deleted

**Recommendation: use soft-delete.** Add a `deleted_at` timestamp column (nullable, default null) to `llm_request_log_feedbacks`. Mark records as deleted by setting `deleted_at`; never issue a hard `DELETE`. Soft-deleted parents remain in the table, so `parent_feedback_hashid` on child records continues to resolve. Exclude soft-deleted records from query results by default (`WHERE deleted_at IS NULL`).

**If hard-delete is unavoidable:** child records that reference the deleted parent's hashid become orphaned. The `parent_feedback_hashid` column retains the value, but no row matches it. Treat orphaned chains as valid standalone feedback records — do not cascade-delete children, and do not raise errors when resolving a `parent_feedback_hashid` that no longer exists. Return `null` for the parent when resolving the chain.

### What happens when a parent record is updated

PATCH does not change a record's `id` or hashid (both are immutable), so chains remain structurally valid after content updates to a parent. Identity fields (`creator_unique_id`, `llm_request_log_id`, `llm_provider_unique_id`) are also immutable per Phase D — they cannot be changed via PATCH.

If a parent's `sentiment`, `explanation`, or `revised_output` is updated, the update affects only that record. Children are unaffected.

If a parent's `original_output` is updated via PATCH and the parent has `focus_range_start IS NOT NULL`, the parent's own `focus_range_stale` is set to `true`. This does not cascade — each record in a chain tracks its own `focus_range_stale` independently.

---

## Partial feedback (`focus_section` + `focus_range`)

Partial feedback targets a specific span inside the AI output. The client captures the user's text selection and sends:

- `focus_section` — the verbatim selected substring, copied directly from the selection event.
- `focus_range` — `{start: N, end: N}` character offsets against `original_output`, 0-indexed, inclusive start, exclusive end. Stored as `focus_range_start` and `focus_range_end` columns.

Both values are captured from the same selection event. `focus_section` must equal `original_output[focus_range_start:focus_range_end]` at the moment of capture. If they diverge (e.g., the client computed offsets against a transformed copy of the output), matching will silently produce wrong results.

### How offsets behave when `original_output` is edited

Offsets are captured against `original_output` at the moment of feedback submission. If `original_output` is subsequently updated via PATCH, the stored offsets may no longer point to the originally-selected text.

The schema uses a `focus_range_stale` boolean (not null, default false) to track this. The PATCH endpoint sets `focus_range_stale = true` whenever `original_output` is updated on a row where `focus_range_start IS NOT NULL`. The endpoint does not recompute offsets.

**Display behavior when stale.** `focus_section` stores the verbatim selected text at capture time and is not affected by later `original_output` changes. When `focus_range_stale = true`, use `focus_section` for display (highlight the literal string) rather than re-slicing the updated `original_output` at the stored offsets. If the literal string no longer appears in the updated output, display it as a detached annotation.

**For managed Coolhand:** `original_output` is immutable once written — the PATCH endpoint does not accept updates to it. Offset staleness does not arise for managed records.

### Validation on write

On `POST /api/v2/llm_request_log_feedbacks`:
- If `focus_range` is present, both `start` and `end` must be provided; reject with 422 if only one is sent.
- `start` must be ≥ 0. `end` must be > `start`. Reject with 422 if either constraint fails.
- `focus_section`, `focus_range_start`, and `focus_range_end` should be stored together or not at all — if only some are present, store what was sent and do not infer the missing values.

---

## Summary table

| Scenario | Recommended behavior |
|---|---|
| Parent feedback hard-deleted | Children retained; treat as valid standalone records; resolve parent as null |
| Parent feedback soft-deleted | Children unaffected; soft-deleted parent still resolves via hashid |
| Parent content updated (sentiment, explanation, etc.) | Children unaffected |
| Parent `original_output` updated, parent has range data | Set parent's `focus_range_stale = true`; do not touch children |
| `original_output` PATCHed on a row with range data | Set `focus_range_stale = true` on that row |
| `focus_range_stale = true` on display | Use `focus_section` for annotation; do not re-slice updated output at stored offsets |
| `focus_range` sent without `focus_section` | Store what was sent; do not infer the missing field |
