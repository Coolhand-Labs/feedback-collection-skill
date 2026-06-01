## Shared detection references

Two files in the `feedback-collection` skill are the canonical source for
provider-specific details. All three skills in this plugin reference them:

- **`skills/feedback-collection/source_apis.yml`**: the response-ID field name
  and an example value for each LLM provider. Use it to capture
  `llm_provider_unique_id` from the raw response object, before any output
  transformation.
- **`skills/feedback-collection/detection-patterns/providers.yml`**: provider
  and SDK detection patterns plus per-language extraction snippets. Use
  `request_id_extraction` for `llm_provider_unique_id` and
  `server_sdk_log_id_extraction` for `llm_request_log_id`.

When a phase below needs a provider's field name or an extraction snippet, read
these files rather than guessing.
